import assert from 'node:assert/strict';
import {PdfRecorder} from './pdf-recorder.mjs';
class MemoryStorage {
  constructor(){this.data=new Map();this.fail=false;}
  get length(){return this.data.size;}key(i){return [...this.data.keys()][i] ?? null;}getItem(k){return this.data.get(k) ?? null;}
  setItem(k,v){if(this.fail)throw new DOMException('Full','QuotaExceededError');this.data.set(k,String(v));}removeItem(k){this.data.delete(k);}
}
const storage=new MemoryStorage();globalThis.localStorage=storage;globalThis.window=new EventTarget();
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({font:'',measureText:s=>({width:s.length*24}),fillText(){}}),toDataURL:()=> 'data:image/png;base64,AA=='})};
const locks=new Map();const lockAPI={async request(name,options,fn){if(typeof options==='function'){fn=options;options={};}if(options.ifAvailable && locks.has(name))return fn(null);const previous=locks.get(name) || Promise.resolve();let release;const mine=new Promise(r=>release=r);locks.set(name,mine);await previous;try{return await fn({name});}finally{release();if(locks.get(name)===mine)locks.delete(name);}}};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true,locks:lockAPI},configurable:true});
// Skip only the per-request throttle in simulated network tests. Retry timers are left intact.
const realTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>realTimeout(fn,ms<=1200?0:ms,...args);
let authCalls=0,grantScopes=true;
window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>grantScopes,initTokenClient:options=>({requestAccessToken:()=>{authCalls++;queueMicrotask(()=>options.callback({access_token:'SIMULATED_TOKEN',expires_in:3600}));}})}}};
const config=await import('../config.js');const schema=await import('../schema.js');const auth=await import('../auth.js');const api=await import('../api.js');const pdf=await import('../pdf-generator.js');
const c={clientId:'123456789-testonly.apps.googleusercontent.com',spreadsheetId:'TEST_ONLY_SHEET',folderId:'TEST_ONLY_FOLDER',counter:'C04',counterConfirmed:true};config.saveConfig(c);
const remote={Invoices:[schema.HEADERS.Invoices],InvoiceItems:[schema.HEADERS.InvoiceItems]};const files=new Map();let lostTable='',loseBeforeCommit=false,appendCalls=0,uploadCalls=0;const requests=[];
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(url,options={})=>{
  requests.push({url,options});
  if(url.includes('/about?'))return response({user:{emailAddress:'cashier@example.test'}});
  if(url.includes('generateIds'))return response({ids:['SIMULATED_DRIVE_'+(files.size+1)]});
  if(url.includes('/upload/')){uploadCalls++;const meta=JSON.parse(options.body.split('\r\n\r\n')[1].split('\r\n--')[0]);if(files.has(meta.id))return response({error:{message:'Exists'}},409);const file={...meta,webViewLink:'https://drive.google.com/file/d/'+meta.id+'/view'};files.set(meta.id,file);return response(file);}
  if(url.includes('/drive/v3/files/')){const id=decodeURIComponent(url.split('/files/')[1].split('?')[0]);return response(files.get(id) || {id,mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});}
  if(url.includes(':batchGet'))return response({valueRanges:[
    {values:[schema.HEADERS.Products,['P1','SKU1','Tee','Tee','{"XS":499,"L":799}',true,'']]},
    {values:[schema.HEADERS.Customers]}, {values:[schema.HEADERS.Settings,['TaxMode','INCLUSIVE',''],['TaxRate',5,'']]},
    {values:remote.Invoices},{values:[schema.HEADERS.InvoiceItems]}]});
  const table=decodeURIComponent(url.split('/values/')[1] || '').split('!')[0];
  if(table in remote){if(options.method==='POST'){appendCalls++;const values=JSON.parse(options.body).values.map(r=>r.map(v=>typeof v==='string' && v.startsWith("'")?v.slice(1):v));if(lostTable===table){lostTable='';if(!loseBeforeCommit)remote[table].push(...values);throw new TypeError('Simulated lost response');}remote[table].push(...values);return response({updates:{updatedRows:values.length}});}return response({values:remote[table]});}
  throw new Error('Unexpected simulated URL '+url);
};
let passed=0;function test(name,fn){return Promise.resolve().then(fn).then(()=>{passed++;console.log('PASS '+name);});}
const item={productId:'P1',description:'Dream Reality Terry 250 GSM',size:'L',qty:1,unitPrice:799};
function invoice(id){return {id,invoiceNumber:'INV-C04-261122-'+id.slice(-3),invoiceDate:'2026-11-22',customerId:'CUSTOMER_TEST',customerName:'Test Customer',customerPhone:'9876543210',customerAddress:'',paymentMethod:'Bank Transfer / UPI',paymentStatus:'PAID',...schema.calculate([item],100,'FLAT',{TaxMode:'INCLUSIVE',TaxRate:5}),idempotencyKey:id,createdBy:'cashier@example.test',createdAt:new Date().toISOString()};}
function job(id){const inv=invoice(id);return {invoiceId:id,sheetRows:schema.makeRows(inv),pdfBase64:btoa('%PDF-simulated'),fileName:inv.invoiceNumber+'.pdf',folderId:c.folderId,spreadsheetId:c.spreadsheetId,status:'pending',stages:{Invoices:'pending',InvoiceItems:'pending'},snapshot:inv,settings:{},createdAt:inv.createdAt,expectedEmail:inv.createdBy};}
await test('Inclusive reference: 799 - 100 = 699, no extra tax',()=>{const x=schema.calculate([item],100,'FLAT',{TaxMode:'INCLUSIVE',TaxRate:5});assert.equal(x.grandTotal,699);assert.equal(x.taxAmount,0);assert.equal(x.includedTax,33.29);});
await test('Exclusive GST after percentage discount uses integer paise',()=>{const x=schema.calculate([item],10,'PCT',{TaxMode:'EXCLUSIVE',TaxRate:5});assert.equal(x.discount,79.9);assert.equal(x.taxAmount,35.96);assert.equal(x.grandTotal,755.06);});
await test('Reject NaN, negative prices, fractional qty, excessive discounts',()=>{for(const value of [NaN,Infinity,-1])assert.throws(()=>schema.calculate([{...item,unitPrice:value}],0,'FLAT',{}));assert.throws(()=>schema.calculate([{...item,qty:1.5}],0,'FLAT',{}));assert.throws(()=>schema.calculate([item],800,'FLAT',{}));assert.throws(()=>schema.calculate([item],101,'PCT',{}));});
await test('Zero price retained and schema widths 29 / 16 match',()=>{assert.equal(schema.calculate([{...item,unitPrice:0}],0,'FLAT',{}).grandTotal,0);const rows=schema.makeRows(invoice('I001'));assert.equal(rows.Invoices[0].length,29);assert.equal(rows.InvoiceItems[0].length,16);});
await test('USER_ENTERED escapes formulas and preserves phone/date text',()=>{assert.deepEqual(schema.safeRows([['=IMPORTXML("x")','00123','2026-11-22',799]])[0],["'=IMPORTXML(\"x\")","'00123","'2026-11-22",799]);});
await test('50 concurrent allocations are unique under the storage lock',async()=>{const ids=await Promise.all(Array.from({length:50},()=>config.allocateNumber(c,'2026-11-22')));assert.equal(new Set(ids).size,50);assert.equal(ids[0],'INV-C04-261122-001');assert.equal(ids[49],'INV-C04-261122-050');});
await test('QuotaExceededError prevents enqueue without deleting prior jobs',()=>{const before=storage.length;storage.fail=true;assert.throws(()=>api.enqueue(job('I101')),/storage/);storage.fail=false;assert.equal(storage.length,before);});
await test('GIS sign-in verifies account without storing token',async()=>{await auth.authorize(true);assert.equal(auth.authState().email,'cashier@example.test');assert(![...storage.data.values()].join('').includes('SIMULATED_TOKEN'));});
await test('Catalog single batch validates five exact headers and XS pricing',async()=>{const before=requests.length,x=await api.syncCatalog();assert.equal(requests.length-before,1);assert.equal(x.products[0].sizes.XS,499);});
await test('Offline flush retains pending job and performs zero requests',async()=>{api.enqueue(job('I102'));navigator.onLine=false;const n=requests.length;await api.flushQueue();assert.equal(requests.length,n);assert.equal(api.listJobs().length,1);navigator.onLine=true;});
await test('Successful sync uploads once then appends both exact schemas',async()=>{await api.flushQueue(true);assert.equal(api.listJobs().length,0);assert.equal(remote.Invoices[1][16],'https://drive.google.com/file/d/SIMULATED_DRIVE_1/view');assert.equal(remote.InvoiceItems.length,2);assert.equal(uploadCalls,1);});
await test('Committed append with lost response is reconciled without duplicate',async()=>{api.enqueue(job('I103'));lostTable='Invoices';await api.flushQueue(true);assert.equal(api.listJobs()[0].stages.Invoices,'uncertain');const writes=appendCalls;await api.flushQueue(true);assert.equal(api.listJobs().length,0);assert.equal(appendCalls,writes+1);assert.equal(remote.Invoices.filter(r=>r[0]==='I103').length,1);});
await test('Lost item append response resumes item-stage reconciliation',async()=>{api.enqueue(job('I104'));lostTable='InvoiceItems';await api.flushQueue(true);assert.equal(api.listJobs()[0].stages.InvoiceItems,'uncertain');const writes=appendCalls;await api.flushQueue(true);assert.equal(api.listJobs().length,0);assert.equal(appendCalls,writes);});
await test('Uncommitted ambiguous append is held for review, never blindly resent',async()=>{api.enqueue(job('I105'));lostTable='Invoices';loseBeforeCommit=true;await api.flushQueue(true);const writes=appendCalls;await api.flushQueue(true);assert.equal(api.listJobs()[0].status,'review');assert.equal(appendCalls,writes);loseBeforeCommit=false;});
await test('Same Drive ID makes a repeated upload resolve 409 without a duplicate',async()=>{const j=job('I106');j.driveFileId='PREALLOCATED_TEST';files.set(j.driveFileId,{id:j.driveFileId,name:j.fileName,parents:[j.folderId],appProperties:{invoiceKey:j.invoiceId},webViewLink:'https://drive.google.com/file/d/PREALLOCATED_TEST/view'});api.enqueue(j);const count=files.size;await api.flushQueue(true);assert.equal(files.size,count);assert(!api.listJobs().some(x=>x.invoiceId===j.invoiceId));});
await test('PDF recorder: 1 / 6 / 60 lines stay inside A4 bounds',()=>{for(const count of [1,6,60]){const inv=invoice('I201');Object.assign(inv,schema.calculate(Array.from({length:count},()=>({...item,description:count===60?'Long description '.repeat(12):item.description})),0,'FLAT',{}));const result=pdf.generatePDF(inv,{},PdfRecorder);assert(count<=6?result.pages===1:result.pages>1);for(const cmd of PdfRecorder.last.commands){assert(cmd.x>=0 && cmd.x<=210,JSON.stringify(cmd));assert(cmd.y>=0 && cmd.y<=297,JSON.stringify(cmd));if(cmd.w){assert(cmd.x+cmd.w<=210);assert(cmd.y+cmd.h<=297);}}}});
await test('UNPAID PDF excludes the paid stamp',()=>{const inv=invoice('I202');inv.paymentStatus='UNPAID';pdf.generatePDF(inv,{},PdfRecorder);assert(!PdfRecorder.last.commands.some(c=>c.type==='image' && c.w===48));});
await test('Recovery export contains queue and sequence ledger, no bearer token',async()=>{const text=await api.exportRecovery().text();assert(text.includes('seq:'));assert(text.includes('I105'));assert(!text.includes('SIMULATED_TOKEN'));});
await test('401 causes one token renewal and one request retry',async()=>{
  const priorFetch=globalThis.fetch;let attempts=0;const before=authCalls;
  globalThis.fetch=(url,options)=>url.includes('/auth-test')?Promise.resolve(response({},++attempts===1?401:200)):priorFetch(url,options);
  await auth.googleFetch('https://www.googleapis.com/auth-test');assert.equal(attempts,2);assert.equal(authCalls,before+1);globalThis.fetch=priorFetch;
});
await test('Under five minutes remaining renews once for concurrent callers',async()=>{
  const priorNow=Date.now;Date.now=()=>priorNow()+3400*1000;const before=authCalls;
  try{await Promise.all([auth.token(),auth.token(),auth.token()]);assert.equal(authCalls,before+1);}finally{Date.now=priorNow;}
});
await test('Wrong-account queue request is blocked before a write',async()=>{
  const before=requests.length;await assert.rejects(auth.googleFetch('https://www.googleapis.com/auth-test',{expectedEmail:'different@example.test'}),/Sign in as/);assert.equal(requests.length,before);
});
await test('Denied scope fails authorization without modifying stored cart',async()=>{
  config.writeJSON(config.PREFIX+'draft:test',{items:[item]});grantScopes=false;
  await assert.rejects(auth.authorize(true),/Both Sheets and Drive/);assert.equal(config.readJSON(config.PREFIX+'draft:test',null).items.length,1);grantScopes=true;
});
await test('Sign out cancels an in-flight authorization and ignores its late response',async()=>{
  let callback;const original=window.google.accounts.oauth2.initTokenClient;
  window.google.accounts.oauth2.initTokenClient=options=>({requestAccessToken:()=>{callback=options.callback;}});
  const pending=auth.authorize(true);auth.clearAuth();await assert.rejects(pending,/Signed out/);
  await callback({access_token:'LATE_TOKEN',expires_in:3600});assert.equal(auth.authState().connected,false);
  window.google.accounts.oauth2.initTokenClient=original;
});
navigator.onLine=false;
console.log(`RESULT ${passed} passed, 0 failed. Network, GIS, Web Locks and PDF engine were simulated in this suite.`);
process.exit(0);

