import {PREFIX,DEFAULT_CONFIG,getConfig,saveConfig,validateConfig,today,readJSON,writeJSON,allocateNumber,withLock} from './config.js';
import {authorize,authState,clearAuth} from './auth.js';
import {loadCatalog,syncCatalog,checkFolder,listJobs,enqueue,flushQueue,localHistory,exportRecovery,authorizeRetry} from './api.js';
import {calculate,makeRows} from './schema.js';
import {generatePDF,dateDisplay,invoiceTimestamp} from './pdf-generator.js';
import {ASSETS} from './assets.js';
import {DEFAULT_SETTINGS} from './defaults.js';
import {loadDeployment,readShared,applyShared,isOwner,requireOwner,initializeShared,migrateSchema,schemaBackup,saveTerminal,INITIAL_DESTINATION} from './shared.js';
import {ADDRESS_DEFAULTS,addressText,validateAddress,validateContact} from './delivery.js';
import {addressFields,readAddress,fillAddress,initEditor,openEditor,catalogLists} from './catalog-editor.js';
let accessGranted=false,sessionReady=false,signingIn=false,polling=false;
function gate(){
  const connected=authState().connected && ((accessGranted && sessionReady) || isOwner());
  $('login-screen').hidden=connected;$('signed-shell').hidden=!connected;document.body.classList.toggle('locked',!connected);
  if(isOwner() && config?.spreadsheetId)$('sheet-link').href='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(config.spreadsheetId)+'/edit';
  else $('sheet-link').removeAttribute('href');
  document.querySelectorAll('[data-owner]').forEach(el=>{el.hidden=!isOwner();});
  $('generate').disabled=!connected || !sessionReady || !activeTab || busy;
  if(!connected)document.querySelectorAll('dialog[open]').forEach(d=>d.close());
}

const $=id=>document.getElementById(id), esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currency=n=>'₹'+Number(n).toFixed(2);
let config;
try { config=getConfig(); } catch { config={...DEFAULT_CONFIG}; }
let catalog=null, draft=null, busy=false, activeTab=false, releaseTab=null, tabTask=null, lastBill=null, lastPdf=null;
let productsById=new Map(), customersByPhone=new Map(), catalogSearch=[];
function sessionId() {
  const key=PREFIX+'session:'+authState().email;
  if(!window.sessionStorage.getItem(key))window.sessionStorage.setItem(key,crypto.randomUUID());
  return window.sessionStorage.getItem(key);
}
const draftKey=()=>PREFIX+'draft:'+config.spreadsheetId;
function notice(message,error=false) { $('notice').textContent=message;if(!authState().connected || (!accessGranted && !isOwner()))$('login-error').textContent=message;$('notice').classList.toggle('error',error); }
function safe(action) { return (...args)=>Promise.resolve().then(()=>action(...args)).catch(error=>notice(error.message,true)); }
function freshDraft() {return {id:'INV-'+crypto.randomUUID(),date:invoiceTimestamp(),name:'',phone:'',address:'',method:'Bank Transfer / UPI',status:'PAID',orderType:'OFFLINE',deliveryCharges:'0',deliveryAddress:{...ADDRESS_DEFAULTS},discount:'0',discountMode:'FLAT',items:[],settings:catalog?{...DEFAULT_SETTINGS,...catalog.settings}:null};}
function saveDraft() {if(!activeTab)throw new Error('Another tab owns billing. This tab cannot change the cart.');writeJSON(draftKey(),draft);}
async function claimTab() {
  if(releaseTab){releaseTab();releaseTab=null;await tabTask;}
  activeTab=false;
  await new Promise((resolve,reject)=>{
    tabTask=withLock('active-billing',async lock=>{
      if(!lock){resolve();return;}
      activeTab=true;resolve();await new Promise(done=>{releaseTab=done;});
    },{ifAvailable:true}).catch(reject);
  });
  if(!activeTab) notice('Another tab is billing for this Sheet in this browser. Close it, then reload this tab.',true);
  $('invoice-form').querySelectorAll('input,select,button').forEach(el=>{el.disabled=!activeTab;});
}
function setDraftFields() {
  draft.date=draft.issuedDate || invoiceTimestamp();$('invoice-date').value=draft.date;$('customer-name').value=draft.name;$('customer-phone').value=draft.phone;fillAddress('address',draft.deliveryAddress);
  $('payment-method').value=draft.method;$('order-type').value=draft.orderType;$('delivery-charges').value=draft.deliveryCharges;addressRequired();$('discount').value=draft.discount;$('discount-mode').value=draft.discountMode;
  renderCart();renderPreview();
}
function readDraftFields() {
  Object.assign(draft,{name:$('customer-name').value,phone:$('customer-phone').value,deliveryAddress:readAddress('address'),orderType:$('order-type').value,deliveryCharges:$('delivery-charges').value,method:$('payment-method').value,status:'PAID',discount:$('discount').value,discountMode:$('discount-mode').value});
  addressRequired();saveDraft();renderPreview();
}
function model() {
  return {...calculate(draft.items,draft.discount,draft.discountMode,draft.settings || DEFAULT_SETTINGS,draft.deliveryCharges),invoiceNumber:draft.number || 'Allocated on save',invoiceDate:draft.date,customerName:draft.name,customerPhone:draft.phone,customerAddress:addressText(draft.deliveryAddress),deliveryAddress:{...draft.deliveryAddress},orderType:draft.orderType,paymentMethod:draft.method,paymentStatus:draft.status};
}
function indexCatalog() {
  productsById=new Map((catalog?.products || []).map(p=>[p.id,p]));
  catalogSearch=(catalog?.products || []).filter(p=>p.active).map(p=>({p,hay:[p.sku,p.name,p.category,p.material,p.productType,...p.colors].join(' ').toLowerCase()}));
  customersByPhone=new Map((catalog?.customers || []).map(c=>[c.phone.replace(/\D/g,'').slice(-10),c]));
  $('customer-options').innerHTML=(catalog?.customers || []).map(c=>`<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join('');
  catalogLists(catalog);
  renderSearch();
}
function renderSearch() {
  const q=$('product-search').value.trim().toLowerCase();
  const found=catalogSearch.filter(x=>!q || x.hay.includes(q)).slice(0,12);
  $('product-results').innerHTML=found.map(({p})=>`<button type="button" data-add="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.sku)} · from ${currency(Math.min(...Object.values(p.sizes)))}</small></button>`).join('') || '<p class="muted">No matching products. Sync Catalog or add a custom item.</p>';
  if(!activeTab)$('product-results').querySelectorAll('button').forEach(el=>{el.disabled=true;});
}
function addItem(id) {
  if(!activeTab)throw new Error('Another tab owns billing.');
  if(draft.items.length>=100) throw new Error('Maximum 100 lines per invoice. Start a separate bill.');
  const p=productsById.get(id),size=p?(Object.hasOwn(p.sizes,'L')?'L':Object.keys(p.sizes)[0]):'';
  draft.items.push({productId:p?.id || '',sku:p?.sku || '',material:p?.material || '',productType:p?.productType || 'DTF',gsm:p?.gsm || '',color:p?.colors?.[0] || '',description:p?.name || '',size,qty:1,mrp:p?.mrps?.[size] ?? null,unitPrice:p?p.sizes[size]:0});
  saveDraft();renderCart();renderPreview();
}
function renderCart() {
  $('cart').innerHTML=draft.items.map((it,i)=>{
    const p=productsById.get(it.productId), sizes=p?Object.keys(p.sizes):[];
    if(!sizes.includes(it.size)) sizes.push(it.size);
    return `<div class="cart-item"><div class="section-title"><b>Item ${i+1}</b><button type="button" class="secondary" data-remove="${i}">Remove</button></div><label>Description<input data-index="${i}" data-field="description" value="${esc(it.description)}" maxlength="300" required></label><div class="item-fields"><label>Size${p?`<select data-index="${i}" data-field="size">${sizes.map(s=>`<option ${s===it.size?'selected':''}>${esc(s)}</option>`).join('')}</select>`:`<input data-index="${i}" data-field="size" maxlength="20" value="${esc(it.size)}">`}</label><label>Color${p && p.colors.length?`<select data-index="${i}" data-field="color">${[...new Set([...p.colors,it.color].filter(Boolean))].map(c=>`<option ${c===it.color?'selected':''}>${esc(c)}</option>`).join('')}</select>`:`<input data-index="${i}" data-field="color" maxlength="40" value="${esc(it.color)}">`}</label><label>Qty<input data-index="${i}" data-field="qty" type="number" min="1" max="9999" step="1" value="${esc(it.qty)}" required></label><label>MRP<input type="number" data-index="${i}" data-field="mrp" value="${esc(it.mrp ?? '')}" min="0" step="0.01"></label><label>Selling price<input data-index="${i}" data-field="unitPrice" type="number" min="0" step="0.01" value="${esc(it.unitPrice)}" required></label></div></div>`;
  }).join('');
  if(!activeTab)$('cart').querySelectorAll('input,select,button').forEach(el=>{el.disabled=true;});
}
function renderPreview() {
  let inv;
  try{inv=model();}catch(error){$('generate').disabled=true;notice(error.message,true);return;}
  $('generate').disabled=busy || !activeTab || !catalog || !sessionReady || !authState().connected;
  const s=draft.settings || DEFAULT_SETTINGS;
  $('number-preview').textContent=draft.number || `LL${today().slice(0,4)}-${config.counter} · allocated on save`;
  $('subtotal').textContent=currency(inv.subtotal);$('discount-total').textContent=currency(inv.discount);$('delivery-total').textContent=currency(inv.deliveryCharges);$('tax-label').textContent=inv.taxLabel;$('tax-total').textContent=inv.taxAmount?currency(inv.taxAmount):'Included';$('grand-total').textContent=currency(inv.grandTotal);
  const rows=Array.from({length:inv.items.length},(_,i)=>{const it=inv.items[i];return `<tr><td>${i+1}</td><td>${esc(it ? [it.description,it.color,it.mrp==null?'':'MRP '+currency(it.mrp)].filter(Boolean).join(' / ') : '')}</td><td>${esc(it?.size || '')}</td><td>${it?.qty || ''}</td><td>${it?it.unitPrice.toFixed(2):''}</td><td>${it?it.amount.toFixed(2):''}</td></tr>`;}).join('');
  $('preview').innerHTML=`<div class="paper-header"><img src="${ASSETS.logo.data}" alt="Lord Look"><div><h2>${esc(s.BusinessName)}</h2><i>${esc(s.Tagline)}</i><p>${esc(s.AddressLine1)}<br>${esc(s.AddressLine2)}<br>${esc(s.ContactLine)}<br>${esc(s.Website)}</p></div></div><div class="paper-meta"><h2>INVOICE</h2><div>Invoice #: ${esc(inv.invoiceNumber)}<br>Invoice Date: ${esc(dateDisplay(inv.invoiceDate))}</div></div><div class="paper-customer"><div><b class="gold">BILL TO</b><h3>${esc(inv.customerName || 'Customer name')}</h3>${esc(inv.customerPhone)}<p class="address-preview">${esc(inv.customerAddress)}</p></div><div><b class="gold">PAYMENT METHOD</b><p>${esc(inv.paymentMethod)}</p><small>${esc(inv.orderType)} ORDER</small></div></div><table class="paper-table"><thead><tr><th>#</th><th>ITEM DESCRIPTION</th><th>SIZE</th><th>QTY</th><th>UNIT PRICE</th><th>AMOUNT</th></tr></thead><tbody>${rows}</tbody></table><dl class="paper-totals"><div><dt>Subtotal</dt><dd>${inv.subtotal.toFixed(2)}</dd></div><div><dt>Discount</dt><dd>${inv.discount.toFixed(2)}</dd></div><div><dt>Delivery charges</dt><dd>${inv.deliveryCharges.toFixed(2)}</dd></div><div><dt>${esc(inv.taxLabel)}</dt><dd>${inv.taxAmount?inv.taxAmount.toFixed(2):''}</dd></div><div class="grand"><dt>TOTAL DUE</dt><dd>${currency(inv.grandTotal)}</dd></div></dl><p class="gold"><b>${esc(s.ThankYouNote)}</b></p><div class="paper-footer"><div>${'<img src="'+ASSETS.paidStamp.data+'" alt="Paid">'}</div><div><img src="${ASSETS.signature.data}" alt="Authorized signature"><hr><small>${esc(s.SignatureCaption)}</small></div></div><p class="paper-brand gold">${esc(s.BottomBrandText)}</p>`;
}
function history() {
  const map=new Map();for(const inv of catalog?.invoices || [])map.set(inv.id,inv);
  for(const inv of localHistory())map.set(inv.id,inv);
  for(const job of listJobs())if(job.spreadsheetId===config.spreadsheetId)map.set(job.invoiceId,{...job.snapshot,settings:job.settings,pdfUrl:job.pdfUrl || '',pending:true});
  return [...map.values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
function renderHistory() {
  const entries=authState().connected ? readJSON(PREFIX+'sessionBills:'+sessionId(),[]) : [];
  $('session-list').innerHTML=entries.map(i=>'<div class="list-row"><b>'+esc(i.number)+'</b><span>'+esc(i.counter)+' · '+esc(new Date(i.time).toLocaleTimeString())+' · '+currency(i.total)+'</span><span>Drive: '+esc(i.drive)+' · Sheets: '+esc(i.sheets)+'</span></div>').join('') || '<p>No invoices generated in this session.</p>';
  const q=$('history-search').value.toLowerCase();
  $('history-list').innerHTML=history().filter(i=>[i.invoiceNumber,i.customerName,i.customerPhone].join(' ').toLowerCase().includes(q)).map(inv=>`<div class="list-row"><div><b>${esc(inv.invoiceNumber)}</b><small>${esc(inv.customerName)} · ${esc(inv.invoiceDate)} · ${esc(inv.orderType || inv.paymentStatus)}${inv.pending?' · Pending sync':''}</small></div><div class="actions"><b>${currency(inv.grandTotal)}</b><button data-pdf="${esc(inv.id)}">PDF</button>${/^https:\/\/(drive|docs)\.google\.com\//.test(inv.pdfUrl || '')?`<a href="${esc(inv.pdfUrl)}" target="_blank" rel="noopener">Drive PDF</a>`:''}</div></div>`).join('') || '<p>No invoices to display.</p>';
}
function renderStatus() {
  const auth=authState(),jobs=listJobs();
  $('account-status').textContent=auth.email?`${auth.email} · ${auth.connected?'Connected':'Reauthorize'}`:catalog?.email?`${catalog.email} · Offline session`:'Not signed in';
  $('counter-status').textContent='Counter '+config.counter;
  $('catalog-status').textContent=catalog?`Catalog ${navigator.onLine?'cached':'offline'} · ${new Date(catalog.syncedAt).toLocaleTimeString()}`:'Catalog not loaded';
  $('queue-status').textContent=`${jobs.length} Bills Pending Sync`;$('queue-status').classList.toggle('warning',jobs.length>0);
  $('queue-list').innerHTML=jobs.map(job=>`<div class="queue-row"><b>${esc(job.snapshot.invoiceNumber)}</b><span class="pill warning">${esc(job.status)}</span><p>${esc(job.error || 'Waiting for background sync')}</p><small>PDF: ${job.uploaded?'uploaded':'pending'} · Invoices: ${esc(job.stages.Invoices)} · InvoiceItems: ${esc(job.stages.InvoiceItems)}</small><div class="actions"><button data-queue-pdf="${esc(job.invoiceId)}">Download local PDF</button>${job.status==='review' && isOwner()?`<button data-review="${esc(job.invoiceId)}">Review / authorize retry</button>`:''}</div></div>`).join('') || '<p>All bills synced.</p>';
  renderHistory();gate();
}
function download(blob,name) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function base64Blob(value) {return new Blob([Uint8Array.from(atob(value),c=>c.charCodeAt(0))],{type:'application/pdf'});}
async function saveInvoice(event) {
  event.preventDefault();if(busy)return;
  let popup=null;
  try {
    if(!activeTab)throw new Error('This tab is not the active billing tab.');validateConfig(config);
    if(!sessionReady || !authState().connected)throw new Error('Sign in again before saving. Your cart is retained.');
    if(!catalog?.email)throw new Error('Sign in and sync the catalog before issuing bills.');
    readDraftFields();validateAddress(draft.deliveryAddress,draft.orderType);validateContact(draft.name,draft.phone);const calculated=model();
    if(!calculated.items.length)throw new Error('Add at least one item.');
    if(!draft.name.trim())throw new Error('Enter a customer name.');
    const digits=draft.phone.replace(/\D/g,'');
    if(!/^(?:91)?[6-9]\d{9}$/.test(digits))throw new Error('Enter a valid Indian mobile number, optionally prefixed with +91.');

    if(!window.jspdf?.jsPDF)throw new Error('PDF library unavailable. Connect and reload before billing.');
    if(history().some(i=>i.id===draft.id))throw new Error('This bill was already saved. Start a new invoice.');
    busy=true;$('generate').disabled=true;
    popup=window.open('about:blank','_blank');if(popup){popup.document.title='Preparing invoice';popup.document.body.textContent='Preparing your PDF. Please keep this window open.';}
    if(!draft.issuedDate){draft.issuedDate=invoiceTimestamp();saveDraft();}
    calculated.invoiceDate=draft.issuedDate;
    if(!draft.number){draft.number=await allocateNumber(config);saveDraft();}
    const phone=validateContact(draft.name,draft.phone),customer=customersByPhone.get(phone.slice(-10));
    const snapshot={session:sessionId(),counter:config.counter,...calculated,id:draft.id,idempotencyKey:draft.id,invoiceNumber:draft.number,customerName:draft.name.trim(),customerPhone:phone,customerId:customer?.id || 'CUS-'+crypto.randomUUID(),createdBy:authState().email || catalog.email,createdAt:new Date().toISOString()};
    const settings=structuredClone(draft.settings || DEFAULT_SETTINGS),pdf=generatePDF(snapshot,settings);
    const job={invoiceId:snapshot.id,sheetRows:makeRows(snapshot),pdfBase64:pdf.pdfBase64,fileName:pdf.fileName,folderId:config.folderId,spreadsheetId:config.spreadsheetId,status:'pending',stages:{Invoices:'pending',InvoiceItems:'pending'},createdAt:snapshot.createdAt,expectedEmail:snapshot.createdBy,snapshot,settings};
    enqueue(job);
    lastBill={...snapshot,settings};lastPdf=pdf;
    $('last-bill').hidden=false;$('last-bill-label').textContent=snapshot.invoiceNumber+' saved locally';
    // Durable job precedes handing the invoice to the customer; storage failure never reports success.
    if(popup){const url=URL.createObjectURL(pdf.blob);popup.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),300000);}else download(pdf.blob,pdf.fileName);
    draft=freshDraft();saveDraft();setDraftFields();renderStatus();
    notice(`${snapshot.invoiceNumber} saved locally. PDF generated in ${pdf.elapsedMs.toFixed(1)} ms. ${navigator.onLine?'Syncing in background.':'Offline: keep this browser storage intact.'}`);
    flushQueue().catch(error=>notice(error.message,true));
  } catch(error) {if(popup)popup.close();notice(error.message,true);}
  finally {busy=false;renderPreview();}
}
function addressRequired(){document.querySelectorAll('[data-order]').forEach(b=>{const selected=b.dataset.order===$('order-type').value;b.setAttribute('aria-pressed',String(selected));b.classList.toggle('secondary',!selected);});const online=$('order-type').value==='ONLINE';for(const k of ['line1','line2'])$('address-'+k).required=online;}
function openSetup(){
  requireOwner();$('setup-sheet').value=config.spreadsheetId || INITIAL_DESTINATION.spreadsheetId;$('setup-folder').value=config.folderId || INITIAL_DESTINATION.folderId;$('setup-error').textContent='';$('setup-modal').showModal();
}
async function saveSetup(event){
  event.preventDefault();$('save-settings').disabled=true;
  try{requireOwner();if(draft.items.length)throw new Error('Save or clear the current cart first.');
    const value=await initializeShared($('setup-sheet').value.trim(),$('setup-folder').value.trim());
    config=applyShared(value);sessionReady=false;
    notice('Shared destinations saved. Back up and migrate the target Sheet before billing.');
    $('setup-error').textContent='Destinations saved. Click Back up and migrate schema next.';
  }catch(error){$('setup-error').textContent=error.message;}finally{$('save-settings').disabled=false;}
}
async function loadSession(){
  const shared=await readShared();accessGranted=true;config=applyShared(shared);catalog=null;
  draft=readJSON(draftKey(),null) || freshDraft();normalizeDraft();
  await checkFolder();await sync();sessionReady=true;$('counter').value=config.counter;setDraftFields();gate();
  if(!config.counterConfirmed){$('terminal-confirm').checked=false;$('terminal-counter').value=config.counter;$('terminal-modal').showModal();}
}
function normalizeDraft(){draft.deliveryAddress={...ADDRESS_DEFAULTS,...draft.deliveryAddress};if(draft.address && !draft.deliveryAddress.line1)draft.deliveryAddress.line1=draft.address;draft.orderType ||= 'OFFLINE';draft.deliveryCharges ??= '0';draft.status='PAID';}
async function pollShared(){
  if(polling || busy || !authState().connected || !navigator.onLine || !sessionReady || !activeTab)return;
  polling=true;
  try{const value=await readShared();if(value.revision!==config.revision){
    if(draft.items.length){notice('Owner settings changed. Save or clear this cart to receive the new destinations.');return;}
    sessionReady=false;config=applyShared(value);catalog=null;draft=readJSON(draftKey(),null) || freshDraft();normalizeDraft();
    await checkFolder();await sync();sessionReady=true;setDraftFields();notice('Shared settings updated from the owner.');
  }}catch(error){notice('Shared settings could not refresh: '+error.message,true);}finally{polling=false;gate();}
}

async function sync() {
  $('sync-catalog').disabled=true;
  try {const next=await syncCatalog();catalog=next;if(!draft.settings || !draft.items.length)draft.settings={...DEFAULT_SETTINGS,...catalog.settings};saveDraft();indexCatalog();renderStatus();renderPreview();notice('Catalog synced. Existing cart prices were preserved.');}
  finally {$('sync-catalog').disabled=false;}
}
async function signIn(){
  if(signingIn)return;signingIn=true;
  try{
    accessGranted=false;sessionReady=false;await authorize(true);gate();
    await loadSession();await flushQueue(true);
  }catch(error){notice(error.message,true);if(isOwner())openSetup();}
  finally{signingIn=false;gate();}
}

function bind() {
  document.querySelectorAll('[data-order]').forEach(b=>b.addEventListener('click',safe(()=>{$('order-type').value=b.dataset.order;readDraftFields();}))); 
  $('invoice-form').addEventListener('submit',saveInvoice);
  $('invoice-form').addEventListener('input',safe(event=>{if(event.target.dataset.field){const it=draft.items[Number(event.target.dataset.index)];it[event.target.dataset.field]=event.target.dataset.field==='mrp' && !event.target.value ? null : event.target.value;saveDraft();renderPreview();}else if(!['product-search','customer-search'].includes(event.target.id))readDraftFields();}));
  $('cart').addEventListener('change',safe(event=>{if(event.target.dataset.field==='size'){const it=draft.items[Number(event.target.dataset.index)],p=productsById.get(it.productId);if(p && Object.hasOwn(p.sizes,event.target.value)){it.unitPrice=p.sizes[event.target.value];it.mrp=p.mrps?.[event.target.value] ?? null;}saveDraft();renderCart();renderPreview();}}));
  $('cart').addEventListener('click',safe(event=>{const button=event.target.closest('[data-remove]');if(button){draft.items.splice(Number(button.dataset.remove),1);saveDraft();renderCart();renderPreview();}}));
  $('product-search').addEventListener('input',renderSearch);
  $('product-search').addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();try{const q=event.target.value.trim().toLowerCase(),match=catalogSearch.find(x=>x.p.sku.toLowerCase()===q);if(match){addItem(match.p.id);event.target.value='';renderSearch();}}catch(error){notice(error.message,true);}});
  $('product-results').addEventListener('click',safe(event=>{const button=event.target.closest('[data-add]');if(button)addItem(button.dataset.add);}));
  $('add-custom').addEventListener('click',safe(()=>addItem('')));
  $('customer-search').addEventListener('change',safe(()=>{const q=$('customer-search').value.trim(),c=customersByPhone.get(q.replace(/\D/g,'').slice(-10)) || catalog?.customers.find(c=>c.name.toLowerCase()===q.toLowerCase());if(c){draft.name=c.name;draft.phone=c.phone;draft.deliveryAddress={...ADDRESS_DEFAULTS,...c.deliveryAddress};saveDraft();setDraftFields();}}));
  $('customer-phone').addEventListener('change',safe(()=>{const c=customersByPhone.get($('customer-phone').value.replace(/\D/g,'').slice(-10));if(c && !$('customer-name').value){draft.name=c.name;draft.deliveryAddress={...ADDRESS_DEFAULTS,...c.deliveryAddress};saveDraft();setDraftFields();}}));
  $('new-invoice').addEventListener('click',safe(()=>{if(draft.items.length && !confirm('Clear this unsaved cart?'))return;draft=freshDraft();saveDraft();setDraftFields();}));
  $('counter').addEventListener('change',()=>{$('counter').value=config.counter;$('terminal-counter').value=config.counter;$('terminal-confirm').checked=false;$('terminal-modal').showModal();});
  $('setup-open').addEventListener('click',openSetup);$('setup-close').addEventListener('click',()=>$('setup-modal').close());$('setup-form').addEventListener('submit',saveSetup);
  $('sign-in').addEventListener('click',()=>{signIn().catch(error=>notice(error.message,true));});
  $('login-button').addEventListener('click',()=>{signIn().catch(error=>notice(error.message,true));});
  $('sign-out').addEventListener('click',()=>{window.sessionStorage.removeItem(PREFIX+'session:'+authState().email);accessGranted=false;sessionReady=false;clearAuth();gate();});
  $('terminal-form').addEventListener('submit',event=>{event.preventDefault();try{if(!activeTab)throw new Error('Use the active billing tab.');if(draft.items.length)throw new Error('Save or clear the cart before changing counter.');saveTerminal($('terminal-counter').value,$('terminal-confirm').checked);config=getConfig();$('counter').value=config.counter;$('terminal-modal').close();renderStatus();renderPreview();}catch(error){$('terminal-error').textContent=error.message;}});
  $('catalog-products').onclick=()=>{$('products-panel').hidden=false;$('customers-panel').hidden=true;};
  $('catalog-customers').onclick=()=>{$('products-panel').hidden=true;$('customers-panel').hidden=false;};
  $('add-product').onclick=safe(()=>openEditor('Products'));$('add-customer').onclick=safe(()=>openEditor('Customers'));
  $('tab-catalog').addEventListener('click',safe(event=>{const b=event.target.closest('[data-edit-id]');if(!b)return;const records=b.dataset.editTab==='Products'?catalog.products:catalog.directoryCustomers;openEditor(b.dataset.editTab,records.find(r=>r.id===b.dataset.editId));}));
  initEditor(async()=>{await sync();notice('Catalog record saved to Google Sheets.');});
  $('migrate-schema').onclick=async()=>{const button=$('migrate-schema');button.disabled=true;try{
    requireOwner();if(listJobs().length || draft.items.length)throw new Error('Sync pending bills and clear the current cart before migration.');
    const id=$('setup-sheet').value.trim();const backup=await schemaBackup(id);download(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),'LordLook-before-v2-'+today()+'.json');
    await migrateSchema(id);await loadSession();$('setup-modal').close();notice('Schema migrated. Products, Customers and Settings are restricted to the owner.');
  }catch(error){$('setup-error').textContent=error.message;}finally{button.disabled=false;}};
  window.addEventListener('driveconfirmed',event=>{
    $('sync-toast').textContent=event.detail+' · PDF saved to Drive';
    $('sync-toast').hidden=false;
    setTimeout(()=>{$('sync-toast').hidden=true;},10000);
  });
  window.addEventListener('invoicesynced',event=>{if(!authState().connected)return;const message=event.detail.invoiceNumber+' confirmed saved to Google Sheets. PDF uploaded.';notice(message);$('sync-toast').textContent=message;$('sync-toast').hidden=false;setTimeout(()=>{$('sync-toast').hidden=true;},10000);});

  $('sync-catalog').addEventListener('click',safe(sync));$('retry-sync').addEventListener('click',safe(()=>flushQueue(true)));
  $('export-recovery').addEventListener('click',safe(()=>download(exportRecovery(),'LordLook-Recovery-'+today()+'.json')));
  document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{for(const section of document.querySelectorAll('main > section'))section.hidden=section.id!=='tab-'+button.dataset.tab;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===button));}));
  $('history-search').addEventListener('input',safe(renderHistory));
  $('history-list').addEventListener('click',safe(event=>{const button=event.target.closest('[data-pdf]');if(!button)return;const inv=history().find(i=>i.id===button.dataset.pdf),job=listJobs().find(j=>j.invoiceId===inv.id);if(job)download(base64Blob(job.pdfBase64),job.fileName);else{const pdf=generatePDF(inv,inv.settings || {...DEFAULT_SETTINGS,...catalog?.settings});download(pdf.blob,pdf.fileName);if(!inv.settings)notice('Historical PDF reconstructed with current branding. Use Drive PDF for the original.');}}));
  $('queue-list').addEventListener('click',safe(async event=>{const downloadButton=event.target.closest('[data-queue-pdf]');if(downloadButton){const job=listJobs().find(j=>j.invoiceId===downloadButton.dataset.queuePdf);download(base64Blob(job.pdfBase64),job.fileName);}const review=event.target.closest('[data-review]');if(review && isOwner() && confirm('Administrator: check the destination Sheet for this invoice and all its item rows. Only proceed after confirming an absent write may be safely retried. Delayed commits can still cause duplicates. Authorize retry?')){await authorizeRetry(review.dataset.review);await flushQueue(true);}}));
  $('download-last').addEventListener('click',safe(()=>{if(lastPdf)download(lastPdf.blob,lastPdf.fileName);}));
  $('preview-last').addEventListener('click',()=>{if(!lastPdf)return;const url=URL.createObjectURL(lastPdf.blob);window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),300000);});
  $('share-last').addEventListener('click',()=>{if(!lastPdf || !lastBill)return;const file=new File([lastPdf.blob],lastPdf.fileName,{type:'application/pdf'});if(navigator.canShare?.({files:[file]})){navigator.share({files:[file],title:lastBill.invoiceNumber,text:`Thank you for shopping with LORD LOOK. Invoice ${lastBill.invoiceNumber}: ${currency(lastBill.grandTotal)} (${lastBill.orderType} order).`}).catch(error=>{if(error.name!=='AbortError')notice(error.message,true);});}else{download(lastPdf.blob,lastPdf.fileName);notice('PDF downloaded. Attach it in WhatsApp to share with the customer.');}});
  $('export-csv').addEventListener('click',safe(()=>{const rows=[['InvoiceNumber','InvoiceDate','CustomerName','CustomerPhone','OrderType','Subtotal','Discount','DeliveryCharges','TaxAmount','GrandTotal','PdfUrl'],...history().map(i=>[i.invoiceNumber,i.invoiceDate,i.customerName,i.customerPhone,i.orderType || i.paymentStatus,i.subtotal,i.discount,i.deliveryCharges || 0,i.taxAmount,i.grandTotal,i.pdfUrl || ''])];const csv=rows.map(r=>r.map(v=>'"'+String(typeof v==='string' && /^[=+@\-\t\r]/.test(v)?"'"+v:v).replaceAll('"','""')+'"').join(',')).join('\r\n');download(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}),'LordLook-Invoices.csv');}));
  window.addEventListener('authchange',safe(renderStatus));window.addEventListener('queuechange',safe(renderStatus));window.addEventListener('queueerror',event=>notice(event.detail,true));window.addEventListener('offline',()=>{renderStatus();notice('Offline. New bills will remain in this browser until sync is available.');});window.addEventListener('online',safe(renderStatus));
}
async function start(){
  const options=Array.from({length:20},(_,i)=>`<option>C${String(i+1).padStart(2,'0')}</option>`).join('');
  $('counter').innerHTML=options;$('terminal-counter').innerHTML=options;
  $('billing-address').innerHTML=addressFields('address');
  draft=freshDraft();bind();gate();await claimTab();
  await loadDeployment();config=getConfig();setDraftFields();
  setInterval(gate,1000);setInterval(()=>{pollShared().catch(error=>notice(error.message,true));},60000);
  window.addEventListener('online',()=>{pollShared().catch(error=>notice(error.message,true));});
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').then(async()=>{const reg=await navigator.serviceWorker.ready;reg.active?.postMessage('CACHE_PDF');}).catch(error=>notice('Offline shell unavailable: '+error.message,true));
}

start().catch(error=>{notice(error.message,true);$('generate').disabled=true;});
