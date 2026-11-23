import {saveCatalogRecord,requireOwner,isOwner} from './shared.js';
import {STATES,ADDRESS_DEFAULTS,validateAddress,validateContact,addressText} from './delivery.js';
export const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function addressFields(prefix,a=ADDRESS_DEFAULTS){
  const input=(key,label,max,required=false)=>`<label>${label}<input id="${prefix}-${key}" value="${esc(a[key])}" maxlength="${max}" ${required?'required':''}></label>`;
  return input('country','Country/Region *',60,true)+input('pin','PIN code *',12,true)+input('line1','Flat, House no., Building, Company, Apartment',120)+input('line2','Area, Street, Sector, Village',120)+input('landmark','Landmark (optional)',80)+input('city','Town/City *',60,true)+`<label>State *<select id="${prefix}-state" required><option value="">Choose a state</option>${STATES.map(s=>`<option ${a.state===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label>`;
}
export const readAddress=prefix=>Object.fromEntries(Object.keys(ADDRESS_DEFAULTS).map(k=>[k,document.getElementById(prefix+'-'+k).value.trim()]));
export function fillAddress(prefix,a){for(const k of Object.keys(ADDRESS_DEFAULTS))document.getElementById(prefix+'-'+k).value=a?.[k] ?? ADDRESS_DEFAULTS[k];}
let selected=null,editingTab='',saving=false,onSaved=null;
export function initEditor(callback){
  onSaved=callback;
  document.getElementById('editor-close').onclick=()=>document.getElementById('editor').close();
  document.getElementById('catalog-form').onsubmit=async event=>{
    event.preventDefault();if(saving)return;
    const $=id=>document.getElementById(id),v=id=>$(id).value.trim();
    try{
      requireOwner();let row;
      if(editingTab==='Products'){
        const gsm=Number(v('edit-gsm'));if(!Number.isFinite(gsm) || gsm<=0)throw new Error('GSM must be a positive number.');
        const sizes={};for(const entry of v('edit-sizes').split('\n').filter(x=>x.trim())){const [size,price,...extra]=entry.split('=');if(extra.length || !size?.trim() || size.trim().length>20 || !price?.trim() || !Number.isFinite(Number(price)) || Number(price)<0 || Number(price)>10000000 || Object.hasOwn(sizes,size.trim()))throw new Error('Use one unique size and price per line, such as M=799.');sizes[size.trim()]=Number(price);}
        if(!Object.keys(sizes).length)throw new Error('Enter at least one size and price.');
        const colors=[...new Set(v('edit-colors').split(',').map(c=>c.trim()).filter(Boolean))];if(!colors.length || colors.some(c=>c.length>40))throw new Error('Enter color names, up to 40 characters each.');
        if(!['DTF','EMB'].includes(v('edit-type')))throw new Error('Choose DTF or EMB.');
        row=[selected.id,v('edit-sku'),v('edit-name'),v('edit-category'),JSON.stringify(sizes),$('edit-active').checked,new Date().toISOString(),v('edit-material'),v('edit-type'),gsm,JSON.stringify(colors)];
      }else{
        const a=validateAddress(readAddress('edit-address'),'OFFLINE'),phone=validateContact(v('edit-name'),v('edit-phone'));
        row=[selected.id,v('edit-name'),phone,addressText(a),selected.raw?.[4] || 0,selected.raw?.[5] || '',new Date().toISOString(),...['country','pin','line1','line2','landmark','city','state'].map(k=>a[k])];
      }
      saving=true;$('editor-save').disabled=true;
      await saveCatalogRecord(editingTab,row,selected.raw || null);
      $('editor').close();await onSaved();
    }catch(error){$('editor-error').textContent=error.message;}
    finally{saving=false;$('editor-save').disabled=false;}
  };
}
export function openEditor(tab,record=null){
  requireOwner();selected=record || {id:(tab==='Products'?'PRO-':'CUS-')+crypto.randomUUID()};editingTab=tab;
  const r=selected,field=(id,label,value,max=100,required=true)=>`<label>${label}<input id="edit-${id}" value="${esc(value)}" maxlength="${max}" ${required?'required':''}></label>`;
  let html=`<p>Record ID: ${esc(r.id)}</p>`+field('name',tab==='Products'?'Product name *':'Full name (First and Last name) *',r.name || '');
  if(tab==='Products') html+=field('sku','SKU *',r.sku || '',60)+field('category','Category',r.category || '',60,false)+field('material','Cloth material *',r.material || '',80)+`<label>Product type<select id="edit-type"><option ${r.productType!=='EMB'?'selected':''}>DTF</option><option ${r.productType==='EMB'?'selected':''}>EMB</option></select></label><label>GSM *<input id="edit-gsm" type="number" min="1" step="any" list="gsm-options" value="${esc(r.gsm || 250)}" required><datalist id="gsm-options"><option value="250"><option value="230"><option value="190"></datalist><small>Choose a suggested GSM or enter a custom number.</small></label>`+field('colors','Available colors, separated by commas *',(r.colors || []).join(', '),500)+`<label>Size prices (one per line: size=price) *<textarea id="edit-sizes" rows="6" required maxlength="2000">${esc(Object.entries(r.sizes || {}).map(([k,v])=>k+'='+v).join('\n'))}</textarea></label><label class="check"><input id="edit-active" type="checkbox" ${r.active!==false?'checked':''}>Active product</label>`;
  else html+=field('phone','Mobile number *',r.phone || '',15)+`<small class="phone-help">May be used to assist delivery</small>`+addressFields('edit-address',r.deliveryAddress || ADDRESS_DEFAULTS);
  document.getElementById('editor-title').textContent=(record?'Edit ':'Add ')+(tab==='Products'?'product':'customer');
  document.getElementById('editor-fields').innerHTML=html;document.getElementById('editor-error').textContent='';document.getElementById('editor').showModal();
}
export function catalogLists(catalog){
  const edit=(tab,id)=>isOwner()?`<button data-edit-tab="${tab}" data-edit-id="${esc(id)}">Edit</button>`:'';
  document.getElementById('catalog-list').innerHTML=(catalog?.products || []).map(p=>`<div class="list-row"><div><b>${esc(p.name)}</b><small>${esc([p.sku,p.material,p.productType,p.gsm?p.gsm+' GSM':''].filter(Boolean).join(' / '))}</small><p>${p.colors.map(c=>`<span class="color-tag">${esc(c)}</span>`).join(' ')}</p><small>${Object.entries(p.sizes).map(([s,v])=>esc(s)+' ₹'+Number(v).toFixed(2)).join(' · ')}</small></div>${edit('Products',p.id)}</div>`).join('') || '<p>No products. The owner can add products here.</p>';
  document.getElementById('customer-list').innerHTML=(catalog?.directoryCustomers || []).map(c=>`<div class="list-row"><div><b>${esc(c.name)}</b><small>${esc(c.phone)}</small><p>${esc(c.address)}</p></div>${edit('Customers',c.id)}</div>`).join('') || '<p>No saved customers. The owner can add customers here.</p>';
}
