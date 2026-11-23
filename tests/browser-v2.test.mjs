import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {HEADERS} from '../schema.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.LORDLOOK_PLAYWRIGHT || 'playwright');
const root=path.resolve('.'),server=http.createServer((req,res)=>{
 let f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(f===root)f=path.join(root,'index.html');
 if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(f)]||'text/plain'});res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome'});let count=0;const pass=s=>{count++;console.log('PASS '+s);};
let email='cashier@example.test',deny=false,revision='1';const errors=[],writes=[],files=new Map();
const tables=Object.fromEntries(Object.entries(HEADERS).map(([k,v])=>[k,[[...v]]]));
tables.Products.push(['P1','SKU1','Dream Reality','Tee','{"XS":499,"L":799}',true,'','Cotton','DTF',250,'["Black","White"]']);tables.Settings.push(['TaxMode','INCLUSIVE',''],['TaxRate',5,'']);
const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true});
const recorder=fs.readFileSync('tests/pdf-recorder.mjs','utf8').replace('export class PdfRecorder','class PdfRecorder')+'\nwindow.jspdf={jsPDF:PdfRecorder};';
await ctx.route('**/deployment.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({clientId:'123456789-testonly.apps.googleusercontent.com',configurationSpreadsheetId:'TEST_ONLY_CONFIG'})}));
await ctx.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:recorder}));
await ctx.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:o=>({requestAccessToken:()=>queueMicrotask(()=>o.callback({access_token:'SIMULATED',expires_in:3600}))})}}};`}));
await ctx.route('https://*.googleapis.com/**',async route=>{
 const req=route.request(),url=new URL(req.url()),p=decodeURIComponent(url.pathname),data=req.postData(),body=data?.startsWith('{')?JSON.parse(data):null;
 const reply=(v,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
 if(p.endsWith('/about'))return reply({user:{emailAddress:email}});
 if(p.includes('generateIds'))return reply({ids:['TEST_FILE_'+files.size]});
 if(p.includes('/upload/')){const m=JSON.parse(data.split('\r\n\r\n')[1].split('\r\n--')[0]),file={...m,webViewLink:'https://drive.google.com/file/d/'+m.id+'/view'};files.set(m.id,file);return reply(file);}
 if(p.includes('/drive/v3/files/'))return reply(files.get(p.split('/').at(-1))||{mimeType:p.includes('FOLDER')?'application/vnd.google-apps.folder':'application/vnd.google-apps.spreadsheet',owners:[{emailAddress:'mylordlook@gmail.com'}],capabilities:{canAddChildren:true}});
 if(p.includes('/values/Configuration')){
  if(deny)return reply({error:{message:'Permission denied'}},403);
  if(req.method()==='PUT'){revision=body.values.find(r=>r[0]==='Revision')[1];writes.push(body);return reply({updatedRows:5});}
  return reply({values:[['Key','Value'],['OwnerEmail','mylordlook@gmail.com'],['SpreadsheetID','TEST_ONLY_SHEET'],['FolderID','TEST_ONLY_FOLDER'],['Revision',revision]]});
 }
 if(p.endsWith('/values:batchGet'))return reply({valueRanges:url.searchParams.getAll('ranges').map(r=>({values:tables[r.split('!')[0]]}))});
 if(p.endsWith('/values:batchUpdate')){for(const c of body.data)tables[c.range.split('!')[0]][0]=c.values[0];writes.push(body);return reply({});}
 if(p.endsWith(':batchUpdate')){writes.push(body);return reply({replies:body.requests.map(()=>({}))});}
 if(p.includes('/values/')){
  const range=p.split('/values/')[1],tab=range.split('!')[0];
  if(req.method()==='GET')return reply({values:range.endsWith('1:1')?[tables[tab][0]]:tables[tab]});
  const rows=body.values.map(r=>r.map(v=>typeof v==='string'&&v.startsWith("'")?v.slice(1):v));writes.push(body);
  if(p.endsWith(':append'))tables[tab].push(...rows);else tables[tab][Number(range.match(/A(\d+)/)[1])-1]=rows[0];
  return reply({updates:{updatedRows:rows.length},updatedRows:rows.length});
 }
 return reply({sheets:[...Object.keys(HEADERS),'Configuration'].map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{columnCount:30}},protectedRanges:[]}))});
});
try{
 const page=await ctx.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('#login-button').waitFor();
 assert.equal(await page.locator('#signed-shell').isVisible(),false);pass('No billing or settings visible before login');
 await page.click('#login-button');await page.locator('#terminal-modal').waitFor({state:'visible'});await page.selectOption('#terminal-counter','C04');await page.check('#terminal-confirm');await page.locator('#terminal-form button').click();
 assert.equal(await page.locator('#setup-open').isVisible(),false);await page.click('[data-tab=catalog]');assert.equal(await page.locator('#add-product').isVisible(),false);await page.click('#catalog-customers');assert(await page.locator('#customers-panel').isVisible());pass('Cashier receives shared settings and read-only catalog sub-tabs');
 await page.click('[data-tab=billing]');await page.click('[data-add=P1]');await page.selectOption('[data-field=color]','White');await page.fill('#customer-name','Test Customer');await page.fill('#customer-phone','9876543210');await page.fill('#discount','100');await page.fill('#delivery-charges','40');
 assert.equal(await page.inputValue('#address-pin'),'625020');assert.equal(await page.inputValue('#address-state'),'Tamil Nadu');assert.equal(await page.locator('#address-state option').count(),37);assert.equal(await page.locator('#grand-total').textContent(),'₹739.00');pass('Defaults, 36 states and delivery total: 799 - 100 + 40 = 739');
 await page.click('[data-order=ONLINE]');await page.waitForFunction(()=>document.querySelector('#address-line1').required);assert.equal(await page.locator('#invoice-form').evaluate(e=>e.checkValidity()),false);await page.fill('#address-line1','12 Test House');await page.fill('#address-line2','Test Street');assert(await page.locator('#invoice-form').evaluate(e=>e.checkValidity()));pass('Online orders require both address lines');
 await page.click('#generate');await page.waitForFunction(()=>document.querySelector('#sync-toast').textContent.includes('confirmed saved'),null,{timeout:60000});assert.equal(tables.Invoices.length,2);assert.equal(tables.InvoiceItems.length,2);assert.equal(tables.Invoices[1][20],'ONLINE');assert.equal(tables.Invoices[1][21],40);assert.equal(tables.InvoiceItems[1][15],'White');assert.equal(files.size,1);pass('Confirmed save notification follows both row appends and PDF upload');
 await page.click('#sign-out');assert.equal(await page.locator('#signed-shell').isVisible(),false);email='outsider@example.test';deny=true;await page.click('#login-button');await page.waitForFunction(()=>document.querySelector('#login-error').textContent.includes('Permission denied'));assert.equal(await page.locator('#signed-shell').isVisible(),false);pass('Account denied configuration access never sees billing');
 await page.evaluate(async()=>{(await import('./auth.js')).clearAuth();});email='mylordlook@gmail.com';deny=false;await page.click('#login-button');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Catalog synced'));await page.click('[data-tab=catalog]');await page.click('#catalog-products');await page.click('#add-product');await page.fill('#edit-name','Embroidered Shirt');await page.fill('#edit-sku','EMB-TEST');await page.fill('#edit-material','Cotton');await page.selectOption('#edit-type','EMB');await page.fill('#edit-gsm','240');await page.fill('#edit-colors','Navy, Gold');await page.fill('#edit-sizes','S=900\nL=950');await page.click('#editor-save');await page.locator('#editor').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#catalog-list').textContent.includes('Embroidered Shirt'));assert.equal(tables.Products[2][9],240);pass('Owner adds EMB product with custom GSM, colors and size prices');
 await page.click('#catalog-customers');await page.click('#add-customer');await page.fill('#edit-name','Directory Customer');await page.fill('#edit-phone','9876543211');await page.click('#editor-save');await page.locator('#editor').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#customer-list').textContent.includes('Directory Customer'));assert.equal(tables.Customers[1][8],'625020');pass('Owner adds structured customer with mandatory defaults');
 await page.click('[data-edit-tab=Customers]');await page.fill('#edit-name','Updated Customer');await page.click('#editor-save');await page.locator('#editor').waitFor({state:'hidden'});assert.equal(tables.Customers.length,2);assert.equal(tables.Customers[1][1],'Updated Customer');pass('Owner edit updates existing row without duplicate');
 await page.click('#setup-open');await page.fill('#setup-sheet','TEST_ONLY_SHEET');await page.fill('#setup-folder','TEST_ONLY_FOLDER');await page.click('#save-settings');await page.waitForFunction(()=>document.querySelector('#setup-error').textContent.includes('Destinations saved'));assert(writes.some(w=>w.requests?.some(r=>r.addProtectedRange?.protectedRange.warningOnly===false)));pass('Shared destination update writes revision and enforces configuration protection');
 await page.click('#migrate-schema');await page.locator('#setup-modal').waitFor({state:'hidden',timeout:60000});assert(writes.some(w=>w.requests?.filter(r=>r.addProtectedRange).length===3));assert.equal(tables.Invoices.length,2);pass('Schema migration preserves invoice rows and protects catalog/settings');
 await page.click('[data-tab=billing]');await page.click('[data-add=P1]');await page.fill('#customer-name','Retained Draft');await page.click('#sign-in');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Catalog synced'));assert.equal(await page.inputValue('#customer-name'),'Retained Draft');assert.equal(await page.locator('.cart-item').count(),1);pass('Reauthorization retains active cart');
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));pass('390px mobile layout without page overflow');assert.deepEqual(errors,[]);pass('No uncaught browser errors');
 console.log(`RESULT ${count} passed. Chrome real; GIS, Google APIs and PDF engine simulated. Live permissions and actual PDF rendering not tested.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
