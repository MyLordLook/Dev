import {PREFIX,readJSON,writeJSON,getConfig,setRuntimeConfig} from './config.js';
import {authState} from './auth.js';
import {request} from './api.js';
import {HEADERS,safeRows} from './schema.js';
export const OWNER='mylordlook@gmail.com';
export const INITIAL_DESTINATION={spreadsheetId:'1stsgYC4lAl0EnAeJ8iYMA3CX23EhJUkqtrdYLAXVuYk',folderId:'11pOWe8MX1zpvpSwxfvV2iJsdQtOkynUY'};
const BASE='https://sheets.googleapis.com/v4/spreadsheets/';
export let deployment=null;
export function isOwner(){return authState().connected && authState().email===OWNER;}
export function requireOwner(){if(!isOwner())throw new Error('Only the owner can perform this action.');}
export async function loadDeployment(){
  const response=await fetch('./deployment.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Website configuration unavailable. Contact the owner.');
  const value=await response.json();
  if(!/^[0-9]+-[\w-]+\.apps\.googleusercontent\.com$/.test(value.clientId) || !/^[\w-]{10,}$/.test(value.configurationSpreadsheetId))throw new Error('Owner: configure deployment.json before signing in.');
  deployment=value;
  setRuntimeConfig({...getConfig(),clientId:value.clientId});
  return value;
}
const jsonOptions=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),expectedEmail:OWNER});
export async function readShared(){
  const data=await request(BASE+deployment.configurationSpreadsheetId+'/values/Configuration!A1:B10?valueRenderOption=UNFORMATTED_VALUE');
  const rows=data.values || [];
  if(rows[0]?.[0]!=='Key' || rows[0]?.[1]!=='Value')throw new Error('Owner must initialize shared configuration.');
  const value=Object.fromEntries(rows.slice(1));
  if(value.OwnerEmail!==OWNER || !/^[\w-]{10,}$/.test(value.SpreadsheetID || '') || !/^[\w-]{10,}$/.test(value.FolderID || ''))throw new Error('Invalid shared configuration. Contact the owner.');
  return {spreadsheetId:value.SpreadsheetID,folderId:value.FolderID,revision:String(value.Revision || '')};
}
export function applyShared(value){
  const terminal=readJSON(PREFIX+'terminal',null) || getConfig();
  const next={clientId:deployment.clientId,...value,counter:terminal.counter || 'C01',counterConfirmed:terminal.counterConfirmed===true};
  setRuntimeConfig(next);return next;
}
export function saveTerminal(counter,confirmed){
  if(!/^C(0[1-9]|1[0-9]|20)$/.test(counter) || !confirmed)throw new Error('Confirm a uniquely assigned counter.');
  writeJSON(PREFIX+'terminal',{counter,counterConfirmed:true});
  setRuntimeConfig({...getConfig(),counter,counterConfirmed:true});
}
async function ownedSpreadsheet(id){
  requireOwner();
  const data=await request('https://www.googleapis.com/drive/v3/files/'+id+'?fields=id,mimeType,owners(emailAddress)',{expectedEmail:OWNER});
  if(data.mimeType!=='application/vnd.google-apps.spreadsheet' || !data.owners?.some(o=>o.emailAddress?.toLowerCase()===OWNER))throw new Error('The owner account must own this native Google spreadsheet. Transfer ownership to '+OWNER+' before migration.');
}
async function metadata(id){return request(BASE+id+'?fields=sheets(properties,protectedRanges)');}
function protection(sheetId,description){return {addProtectedRange:{protectedRange:{range:{sheetId},description,warningOnly:false,editors:{users:[OWNER],domainUsersCanEdit:false}}}};}
export async function initializeShared(spreadsheetId,folderId){
  requireOwner();
  if(!/^[\w-]{10,}$/.test(spreadsheetId) || !/^[\w-]{10,}$/.test(folderId))throw new Error('Enter valid Sheet and folder IDs.');
  await ownedSpreadsheet(deployment.configurationSpreadsheetId);
  await ownedSpreadsheet(spreadsheetId);
  const folder=await request('https://www.googleapis.com/drive/v3/files/'+folderId+'?fields=mimeType,trashed,capabilities(canAddChildren)',{expectedEmail:OWNER});
  if(folder.trashed || folder.mimeType!=='application/vnd.google-apps.folder' || !folder.capabilities?.canAddChildren)throw new Error('Owner cannot upload into this folder.');
  const id=deployment.configurationSpreadsheetId,meta=await metadata(id);
  let sheet=meta.sheets.find(s=>s.properties.title==='Configuration');
  if(!sheet){const out=await request(BASE+id+':batchUpdate',jsonOptions({requests:[{addSheet:{properties:{title:'Configuration'}}}]}));sheet={properties:out.replies[0].addSheet.properties,protectedRanges:[]};}
  const operations=(sheet.protectedRanges || []).map(p=>({deleteProtectedRange:{protectedRangeId:p.protectedRangeId}}));
  operations.push(protection(sheet.properties.sheetId,'Lord Look owner configuration'));
  await request(BASE+id+':batchUpdate',jsonOptions({requests:operations}));
  const values=[['Key','Value'],['OwnerEmail',OWNER],['SpreadsheetID',spreadsheetId],['FolderID',folderId],['Revision',crypto.randomUUID()]];
  await request(BASE+id+'/values/Configuration!A1:B5?valueInputOption=RAW',{...jsonOptions({values}),method:'PUT'});
  return readShared();
}
export async function schemaBackup(id){
  requireOwner();await ownedSpreadsheet(id);
  const ranges=Object.keys(HEADERS).map(tab=>'ranges='+encodeURIComponent(tab+'!A:AZ')).join('&');
  return request(BASE+id+'/values:batchGet?valueRenderOption=FORMULA&'+ranges,{expectedEmail:OWNER});
}
export async function migrateSchema(id){
  requireOwner();await ownedSpreadsheet(id);
  const meta=await metadata(id),requests=[],updates=[];
  for(const [tab,headers] of Object.entries(HEADERS)){
    const sheet=meta.sheets.find(s=>s.properties.title===tab);
    if(!sheet)throw new Error('Missing tab: '+tab+'. Create it with the matching schema CSV first.');
    const data=await request(BASE+id+'/values/'+tab+'!1:1',{expectedEmail:OWNER});
    const old=data.values?.[0] || [];
    if(!old.length || old.length>headers.length || old.some((v,i)=>v!==headers[i]))throw new Error('Unexpected headers in '+tab+'. Migration stopped; do not overwrite the existing data.');
    if(sheet.properties.gridProperties.columnCount<headers.length)requests.push({appendDimension:{sheetId:sheet.properties.sheetId,dimension:'COLUMNS',length:headers.length-sheet.properties.gridProperties.columnCount}});
    updates.push({range:tab+'!A1',values:[headers]});
    if(['Products','Customers','Settings'].includes(tab)){
      for(const protectedRange of sheet.protectedRanges || [])requests.push({deleteProtectedRange:{protectedRangeId:protectedRange.protectedRangeId}});
      requests.push(protection(sheet.properties.sheetId,'Lord Look owner catalog'));
    }
  }
  if(requests.length)await request(BASE+id+':batchUpdate',jsonOptions({requests}));
  await request(BASE+id+'/values:batchUpdate',jsonOptions({valueInputOption:'RAW',data:updates}));
  return true;
}
export async function saveCatalogRecord(tab,row,original){
  requireOwner();if(!['Products','Customers'].includes(tab))throw new Error('Unsupported catalog table.');
  const id=getConfig().spreadsheetId;
  const data=await request(BASE+id+'/values/'+tab+'!A:Z?valueRenderOption=UNFORMATTED_VALUE',{expectedEmail:OWNER});
  const rows=data.values || [];
  if(HEADERS[tab].some((v,i)=>rows[0]?.[i]!==v))throw new Error('Migrate the catalog schema before editing.');
  const matches=rows.map((r,i)=>({r,i})).filter(x=>x.r[0]===row[0]);
  if(matches.length>1)throw new Error('Duplicate record ID in Sheet. Resolve it before editing.');
  if(tab==='Products' && rows.slice(1).some(r=>r[0]!==row[0] && String(r[1]).toLowerCase()===String(row[1]).toLowerCase()))throw new Error('SKU already exists.');
  if(tab==='Customers' && rows.slice(1).some(r=>r[0]!==row[0] && String(r[2]).replace(/\D/g,'').slice(-10)===row[2]))throw new Error('A customer with this mobile number already exists.');
  if(original && (!matches.length || HEADERS[tab].some((_,i)=>String(matches[0].r[i] ?? '')!==String(original[i] ?? ''))))throw new Error('This record changed since you opened it. Sync Catalog, reopen and try again.');
  if(!original && matches.length){if(row.every((v,i)=>String(v)===String(matches[0].r[i] ?? '')))return;throw new Error('Record already exists. Sync Catalog before continuing.');}
  const range=tab+'!A'+(matches.length?matches[0].i+1:'1');
  const suffix=matches.length?'?valueInputOption=USER_ENTERED':':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
  try {await request(BASE+id+'/values/'+range+suffix,{...jsonOptions({values:safeRows([row])}),method:matches.length?'PUT':'POST'});}
  catch(error){throw new Error('Save outcome may be unknown. Sync Catalog and check record '+row[0]+' before retrying. '+error.message);}
}
