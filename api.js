import {PREFIX, getConfig, readJSON, writeJSON, withLock} from './config.js';
import {googleFetch, authState, AuthRequired} from './auth.js';
import {assertHeaders, safeRows, rowToInvoice} from './schema.js';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const DRIVE = 'https://www.googleapis.com/drive/v3/';
const fields = 'id,name,webViewLink,parents,appProperties,trashed';
let flushing = false, lastRequest = 0, retryTimer = null;
export const notifyQueue = () => window.dispatchEvent(new Event('queuechange'));
const jobKey = id => PREFIX + 'job:' + id;
const cacheKey = id => PREFIX + 'catalog:' + id;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class ApiError extends Error {
  constructor(message, status, retryable = false) { super(message); this.status = status; this.retryable = retryable; }
}
export async function request(url, options = {}) {
  await sleep(Math.max(0, 1200 - (Date.now() - lastRequest)));
  lastRequest = Date.now();
  const response = await googleFetch(url, options);
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw new ApiError('Unreadable Google API response; write outcome may be uncertain.', response.status); }
  if (!response.ok) {
    const reasons = (body.error?.errors || []).map(x => x.reason).join(' ');
    throw new ApiError(body.error?.message || `Google API HTTP ${response.status}`, response.status,
      response.status === 429 || response.status >= 500 || /rateLimit|userRateLimit/i.test(reasons));
  }
  return body;
}
export function loadCatalog() { return readJSON(cacheKey(getConfig().spreadsheetId), null); }
export async function syncCatalog() {
  const c = getConfig();
  const ranges = ['Products!A:K','Customers!A:N','Settings!A:C','Invoices!A:AC','InvoiceItems!A1:P1'];
  const query = new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE', dateTimeRenderOption:'SERIAL_NUMBER'});
  ranges.forEach(range => query.append('ranges', range));
  const data = await request(SHEETS + encodeURIComponent(c.spreadsheetId) + '/values:batchGet?' + query);
  if (data.valueRanges?.length !== ranges.length) throw new Error('Incomplete catalog response. Previous cache retained.');
  const tables = {};
  ranges.forEach((range,i) => { const name = range.split('!')[0]; const values = data.valueRanges[i].values || []; assertHeaders(name, values); tables[name] = values.slice(1); });
  const ids = new Set(), skus = new Set();
  const products = tables.Products.filter(r => r[0]).map(r => {
    const id = String(r[0]), sku = String(r[1] || '');
    if (ids.has(id) || (sku && skus.has(sku.toLowerCase()))) throw new Error('Duplicate ProductID or SKU in Products: ' + id);
    ids.add(id); if (sku) skus.add(sku.toLowerCase());
    let sizes; try { sizes = JSON.parse(r[4]); } catch { throw new Error('Invalid SizesJSON for ' + id); }
    if (!sizes || Array.isArray(sizes) || typeof sizes !== 'object' || !Object.keys(sizes).length || Object.values(sizes).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw new Error('Invalid size prices for ' + id);
    let colors;try {colors=JSON.parse(r[10] || '[]');}catch {throw new Error('Invalid ColorsJSON for '+id);}
    if(!Array.isArray(colors) || colors.some(c=>typeof c!=='string'))throw new Error('ColorsJSON must be a list of color names for '+id);
    return {raw:r,material:String(r[7] || ''),productType:String(r[8] || 'DTF'),gsm:r[9] ?? '',colors,id,sku,name:String(r[2] || ''),category:String(r[3] || ''),sizes,active:r[5] !== false && String(r[5]).toUpperCase() !== 'FALSE'};
  });
  const settings = Object.fromEntries(tables.Settings.filter(r => r[0]).map(r => [String(r[0]),r[1] ?? '']));
  const customers = tables.Customers.filter(r=>r[0]).map(r=>({raw:r,id:String(r[0]),name:String(r[1] || ''),phone:String(r[2] || ''),address:String(r[3] || ''),orders:Number(r[4] || 0),deliveryAddress:{country:r[7] || 'India',pin:String(r[8] || '625020'),line1:r[9] || '',line2:r[10] || '',landmark:r[11] || '',city:r[12] || 'Madurai',state:r[13] || 'Tamil Nadu'}}));
  const allInvoices = tables.Invoices.filter(r=>r[1]).map(rowToInvoice);
  // New billing contacts are derived from immutable invoice snapshots, avoiding competing customer upserts.
  const byPhone = new Map(customers.map(c=>[c.phone.replace(/\D/g,''),c]));
  for (const inv of allInvoices) byPhone.set(inv.customerPhone.replace(/\D/g,''), {id:inv.customerId,name:inv.customerName,phone:inv.customerPhone,address:inv.customerAddress,deliveryAddress:inv.deliveryAddress,orders:null});
  const cache = {products,directoryCustomers:customers,customers:[...byPhone.values()],settings,invoices:allInvoices.slice(-200).reverse(),syncedAt:new Date().toISOString(),email:authState().email,spreadsheetId:c.spreadsheetId};
  writeJSON(cacheKey(c.spreadsheetId), cache);
  return cache;
}
export async function checkFolder() {
  const c = getConfig();
  const folder = await request(DRIVE + 'files/' + encodeURIComponent(c.folderId) + '?supportsAllDrives=true&fields=id,mimeType,trashed,capabilities(canAddChildren)');
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.capabilities?.canAddChildren) throw new Error('This account cannot upload into the selected Drive folder. Ask the admin to share it with write access.');
  return true;
}
export function listJobs() {
  const jobs = [];
  for (let i=0;i<localStorage.length;i++) { const key=localStorage.key(i); if (key?.startsWith(PREFIX+'job:')) jobs.push(readJSON(key,null)); }
  if (jobs.some(j=>!j || !j.invoiceId || !j.sheetRows || !j.snapshot)) throw new Error('Damaged queue data. Export recovery data and contact the admin.');
  return jobs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
export function enqueue(job) {
  if (localStorage.getItem(jobKey(job.invoiceId))) throw new Error('This bill is already queued.');
  writeJSON(jobKey(job.invoiceId), job);
  notifyQueue();
}
function persist(job) { writeJSON(jobKey(job.invoiceId), job); notifyQueue(); }
export function localHistory() { return readJSON(PREFIX+'history:'+getConfig().spreadsheetId, []); }
function finish(job) {
  const key = PREFIX+'history:'+job.spreadsheetId;
  const history = readJSON(key,[]).filter(x=>x.id!==job.invoiceId);
  history.unshift({...job.snapshot,pdfFileId:job.driveFileId,pdfUrl:job.pdfUrl,settings:job.settings});
  writeJSON(key,history.slice(0,100));
  localStorage.removeItem(jobKey(job.invoiceId));
  window.dispatchEvent(new CustomEvent('invoicesynced',{detail:{invoiceNumber:job.snapshot.invoiceNumber,pdfUrl:job.pdfUrl}}));
  notifyQueue();
}
async function ensureUpload(job) {
  if (!job.driveFileId) {
    const data = await request(DRIVE+'files/generateIds?count=1&space=drive&type=files',{expectedEmail:job.expectedEmail});
    if (!data.ids?.[0]) throw new Error('Drive did not allocate a file ID.');
    job.driveFileId=data.ids[0]; persist(job);
  }
  const boundary = 'lordlook_' + job.invoiceId.replace(/[^a-zA-Z0-9]/g,'');
  const metadata = {id:job.driveFileId,name:job.fileName,mimeType:'application/pdf',parents:[job.folderId],appProperties:{invoiceKey:job.invoiceId}};
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${job.pdfBase64}\r\n--${boundary}--\r\n`;
  let result;
  try {
    result = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields='+encodeURIComponent(fields), {method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body,expectedEmail:job.expectedEmail});
  } catch(error) {
    if (error.status !== 409) throw error;
    result = await request(DRIVE+'files/'+encodeURIComponent(job.driveFileId)+'?supportsAllDrives=true&fields='+encodeURIComponent(fields),{expectedEmail:job.expectedEmail});
  }
  if (result.trashed || result.id !== job.driveFileId || result.appProperties?.invoiceKey !== job.invoiceId || !result.parents?.includes(job.folderId) || !result.webViewLink) throw new Error('Drive file verification failed. Queue retained.');
  job.pdfUrl=result.webViewLink;
  job.sheetRows.Invoices[0][15]=result.id; job.sheetRows.Invoices[0][16]=result.webViewLink;
  job.uploaded=true; persist(job);
}
const endColumn = {Invoices:'AC',InvoiceItems:'P'};
async function getRows(job, table) {
  const range = table+'!A:'+endColumn[table];
  const data = await request(SHEETS+encodeURIComponent(job.spreadsheetId)+'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE',{expectedEmail:job.expectedEmail});
  assertHeaders(table,data.values || []);
  return data.values.slice(1);
}
function rowsEqual(actual, expected) { return expected.every((v,i)=>String(actual[i] ?? '')===String(v ?? '')); }
async function reconcile(job, table) {
  const rows = await getRows(job,table), expected = job.sheetRows[table];
  const matching = rows.filter(r => table==='Invoices' ? r[0]===job.invoiceId || r[1]===job.snapshot.invoiceNumber : r[1]===job.invoiceId);
  if (!matching.length) return 'absent';
  if (matching.length===expected.length && expected.every(e=>matching.filter(r=>r[0]===e[0] && rowsEqual(r,e)).length===1)) return 'complete';
  return 'conflict';
}
async function appendStage(job, table) {
  const stage=job.stages[table];
  if (stage==='done') return;
  if (stage==='inflight' || stage==='uncertain') {
    const result=await reconcile(job,table);
    if (result==='complete') { job.stages[table]='done'; job.status='pending'; job.error=''; persist(job); return; }
    job.stages[table]='uncertain'; job.status='review';
    job.error=result==='conflict' ? `${table}: conflicting or partial rows. Administrator reconciliation required.` : `${table}: previous write outcome is unknown. Check the Sheet before authorizing a retry.`;
    persist(job); return;
  }
  // Preflight detects existing invoice numbers and recoverable exact duplicate jobs.
  const previous=await reconcile(job,table);
  if (previous==='complete') { job.stages[table]='done'; persist(job); return; }
  if (previous==='conflict') { job.status='review'; job.error=`${table}: conflicting rows or invoice number. Do not resend.`; persist(job); return; }
  job.stages[table]='inflight'; job.lastWriteAt=Date.now(); persist(job);
  try {
    const query='?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false';
    const response=await request(SHEETS+encodeURIComponent(job.spreadsheetId)+'/values/'+encodeURIComponent(table+'!A:'+endColumn[table])+':append'+query,
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({majorDimension:'ROWS',values:safeRows(job.sheetRows[table])}),expectedEmail:job.expectedEmail});
    if (response.updates?.updatedRows!==job.sheetRows[table].length) throw new Error('Append receipt row count did not match.');
    job.stages[table]='done'; persist(job);
  } catch(error) {
    const rejected = error instanceof AuthRequired || (error.status>=400 && error.status<500 && error.status!==408);
    job.stages[table]=rejected?'pending':'uncertain';
    if (!rejected) { job.status='review'; job.error=`${table}: response lost or unreadable; reconciliation required. ${error.message}`; }
    persist(job); throw error;
  }
}
async function processJob(job) {
  if (job.expectedEmail !== authState().email) throw new AuthRequired('Sign in as '+job.expectedEmail+' to sync this bill.');
  if (!job.uploaded) await ensureUpload(job);
  for (const table of ['Invoices','InvoiceItems']) {
    await appendStage(job,table);
    if (job.stages[table]!=='done') return;
  }
  finish(job);
}
export async function flushQueue(manual = false) {
  if (flushing || !navigator.onLine) return;
  flushing=true;
  let nextDelay = Infinity;
  try {
    await withLock('queue-worker', async lock => {
      if (!lock) return;
      for (const item of listJobs()) {
        const job=readJSON(jobKey(item.invoiceId),null);
        if (!job || job.expectedEmail!==authState().email) continue;
        if (!manual && job.status==='blocked') continue;
        if (!manual && (job.nextAttempt || 0)>Date.now()) { nextDelay=Math.min(nextDelay,job.nextAttempt-Date.now()); continue; }
        try { await processJob(job); }
        catch(error) {
          job.attempts=(job.attempts || 0)+1;
          if (error instanceof AuthRequired) { job.status='auth'; job.error=error.message; persist(job); break; }
          if (job.status!=='review') {
            job.status=error instanceof ApiError && !error.retryable ? 'blocked':'pending';
            job.error=error.message;
          }
          const delay=Math.min(60000,1000*2**Math.min(job.attempts,6))+Math.floor(Math.random()*1000);
          job.nextAttempt=Date.now()+delay; persist(job);
          if (job.status==='pending') nextDelay=Math.min(nextDelay,delay);
        }
      }
    },{ifAvailable:true});
  } finally {
    flushing=false; clearTimeout(retryTimer);
    if (Number.isFinite(nextDelay)) retryTimer=setTimeout(()=>flushQueue().catch(reportQueueError),nextDelay);
  }
}
export async function authorizeRetry(id) {
  return withLock('queue-worker',async()=>{
    const job=readJSON(jobKey(id),null); if (!job) return;
    if (Date.now()-(job.lastWriteAt || 0)<180000) throw new Error('Wait at least 3 minutes after the uncertain write before reconciliation.');
    for (const table of ['Invoices','InvoiceItems']) if (['uncertain','inflight'].includes(job.stages[table])) {
      const result=await reconcile(job,table);
      if (result==='conflict') throw new Error('Conflicting rows exist. Administrator reconciliation is required.');
      job.stages[table]=result==='complete'?'done':'pending';
    }
    job.status='pending'; job.error=''; job.nextAttempt=0; persist(job);
  });
}
function reportQueueError(error) { window.dispatchEvent(new CustomEvent('queueerror',{detail:error.message})); }
window.addEventListener('online',()=>flushQueue(true).catch(reportQueueError));
window.addEventListener('storage',event=>{if(event.key?.startsWith(PREFIX+'job:')) notifyQueue();});
export function exportRecovery() {
  const data={format:'LordLook recovery v1',exportedAt:new Date().toISOString(),records:{}};
  for(let i=0;i<localStorage.length;i++) {const key=localStorage.key(i);if(key?.startsWith(PREFIX)) data.records[key]=localStorage.getItem(key);}
  return new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
}
