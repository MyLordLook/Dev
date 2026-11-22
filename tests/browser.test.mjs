import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {HEADERS} from '../schema.js';
const require=createRequire(import.meta.url);
const {chromium}=process.env.LORDLOOK_PLAYWRIGHT ? require(process.env.LORDLOOK_PLAYWRIGHT) : require('playwright');
const root=path.resolve('.'), mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer((req,res)=>{
  let target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!target.startsWith(root+path.sep) && target!==root){res.writeHead(403);res.end();return;}
  if(target===root)target=path.join(root,'index.html');
  if(!fs.existsSync(target) || !fs.statSync(target).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(target)] || 'application/octet-stream'});res.end(fs.readFileSync(target));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome'});
let passed=0;
function pass(name){passed++;console.log('PASS '+name);}
try{
const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'allow',acceptDownloads:true});
const errors=[];let apiCalls=0;
const recorder=fs.readFileSync('tests/pdf-recorder.mjs','utf8').replace('export class PdfRecorder','class PdfRecorder')+'\nwindow.jspdf={jsPDF:PdfRecorder};';
await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:recorder}));
await context.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:options=>({requestAccessToken:()=>queueMicrotask(()=>options.callback({access_token:'SIMULATED_BROWSER_TOKEN',expires_in:3600}))})}}};`}));
await context.route('https://*.googleapis.com/**',route=>{
  apiCalls++;const url=route.request().url();let body;
  if(url.includes('/about?'))body={user:{emailAddress:'cashier@example.test'}};
  else if(url.includes('/drive/v3/files/'))body={id:'TEST_ONLY_FOLDER',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}};
  else if(url.includes(':batchGet'))body={valueRanges:[
    {values:[HEADERS.Products,['P1','SKU1','Dream Reality Terry 250 GSM','Tee','{"XS":499,"L":799}',true,'']]},
    {values:[HEADERS.Customers]}, {values:[HEADERS.Settings,['TaxMode','INCLUSIVE',''],['TaxRate',5,'']]},
    {values:[HEADERS.Invoices]},{values:[HEADERS.InvoiceItems]}]};
  else return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Simulated unavailable API'}})});
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.goto(origin);await page.locator('#setup-modal').waitFor({state:'visible'});
await page.fill('#setup-client','123456789-testonly.apps.googleusercontent.com');await page.fill('#setup-sheet','TEST_ONLY_SHEET');await page.fill('#setup-folder','TEST_ONLY_FOLDER');await page.selectOption('#setup-counter','C04');await page.check('#setup-confirm');await page.locator('#setup-form button[type=submit]').click();await page.locator('#setup-modal').waitFor({state:'hidden'});pass('First-run Setup Modal validates and persists configuration');
await page.click('#sign-in');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Catalog synced'));
assert.equal(await page.locator('#account-status').textContent(),'cashier@example.test · Connected');pass('Simulated GIS login, folder permission check and catalog batch render');
await page.fill('#product-search','SKU1');await page.press('#product-search','Enter');await page.waitForFunction(()=>document.querySelectorAll('.cart-item').length===1);
await page.selectOption('[data-field=size]','XS');assert.equal(await page.inputValue('[data-field=unitPrice]'),'499');await page.selectOption('[data-field=size]','L');assert.equal(await page.inputValue('[data-field=unitPrice]'),'799');pass('SKU Enter adds a single line without submitting; XS/L selects correct price');
await page.fill('#customer-name','Test Customer');await page.fill('#customer-phone','9876543210');await page.fill('#discount','100');await page.waitForFunction(()=>document.querySelector('#grand-total').textContent==='₹699.00');pass('Form / live invoice preview shows reference total ₹699.00');
await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(root,'../../work/ui-desktop.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await page.screenshot({path:path.join(root,'../../work/ui-mobile.png'),fullPage:true});pass('390px mobile layout has no horizontal page overflow');
await page.setViewportSize({width:1440,height:1100});
const second=await context.newPage();await second.goto(origin);await second.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Another tab'));assert(await second.locator('#generate').isDisabled());assert(await second.locator('#customer-name').isDisabled());assert.equal(await second.locator('#invoice-form input:enabled, #invoice-form select:enabled, #invoice-form button:enabled').count(),0);await second.close();pass('Real Web Locks prevent a second tab from editing or billing, including dynamically rendered controls');
const numbers=await page.evaluate(async()=>{const m=await import('./config.js');return Promise.all(Array.from({length:50},()=>m.allocateNumber(m.getConfig(),'2026-11-22')));});assert.equal(new Set(numbers).size,50);pass('Real Web Locks serialize 50 concurrent sequence allocations');
await context.setOffline(true);await page.waitForTimeout(100);const before=apiCalls;
await page.click('#generate');await page.locator('#last-bill').waitFor({state:'visible'});assert.equal(apiCalls,before);
const stored=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':job:')).map(k=>JSON.parse(localStorage.getItem(k))));assert.equal(stored.length,1);assert.equal(stored[0].snapshot.grandTotal,699);assert(stored[0].pdfBase64);assert.equal(await page.locator('.cart-item').count(),0);pass('Offline save persists atomic PDF/job snapshot, clears cart only after saving, makes zero API requests');
await page.reload();await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.includes('1 Bills'));assert.equal(await page.locator('#setup-modal').isVisible(),false);pass('Service-worker offline reload restores cached app, catalog and queued bill');
await context.setOffline(false);
await page.fill('#customer-name','Next Customer');await page.fill('#customer-phone','9876543210');await page.click('[data-add=P1]');await page.click('#sign-in');await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('Connected'));assert.equal(await page.inputValue('#customer-name'),'Next Customer');assert.equal(await page.locator('.cart-item').count(),1);pass('Reauthorization retains the active customer and cart');
assert.deepEqual(errors,[]);pass('Zero uncaught browser page errors in exercised UI paths');
await context.close();
const ids=[];
for(let n=1;n<=17;n++){
  const ctx=await browser.newContext();const p=await ctx.newPage();await p.goto(origin+'/config.js');
  const generated=await p.evaluate(async({origin,n})=>{const m=await import(origin+'/config.js');const c={clientId:'123456789-testonly.apps.googleusercontent.com',spreadsheetId:'TEST_ONLY_SHEET',folderId:'TEST_ONLY_FOLDER',counter:'C'+String(n).padStart(2,'0'),counterConfirmed:true};return Promise.all(Array.from({length:5},()=>m.allocateNumber(c,'2026-11-22')));},{origin,n});
  ids.push(...generated);await ctx.close();
}
assert.equal(new Set(ids).size,85);pass('17 isolated browser profiles with assigned counters issue 85 unique invoice numbers');
console.log(`RESULT ${passed} browser checks passed. Chrome and Web Locks real; Google APIs/GIS and jsPDF engine simulated. No live OAuth or actual PDF rendering was claimed.`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
