export const PREFIX = 'lordlook:v1:';
export const DEFAULT_CONFIG = Object.freeze({clientId: '', spreadsheetId: '', folderId: '', counter: 'C01', counterConfirmed: false});
export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
export const PDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
export function readJSON(key, fallback) {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  try { return JSON.parse(value); } catch { throw new Error(`Stored data is damaged (${key}). Export recovery data before changing browser storage.`); }
}
export function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (error) { throw new Error(`Browser storage could not save data. Keep this tab open, export recovery data and free space. ${error.name}`); }
}
let runtimeConfig=null;
export function getConfig() { return runtimeConfig || {...DEFAULT_CONFIG, ...readJSON(PREFIX + 'config', {})}; }
export function setRuntimeConfig(c) {runtimeConfig={...DEFAULT_CONFIG,...c};}
export function validateConfig(c) {
  if (!/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.clientId)) throw new Error('Enter the Web application OAuth Client ID.');
  for (const k of ['spreadsheetId', 'folderId']) if (!/^[A-Za-z0-9_-]{10,}$/.test(c[k])) throw new Error(`Enter a valid ${k}; use the ID, not the URL.`);
  if (!/^C(0[1-9]|1[0-9]|20)$/.test(c.counter) || !c.counterConfirmed) throw new Error('Confirm this counter is assigned exclusively to this browser/device.');
  return c;
}
export function saveConfig(c) { validateConfig(c); writeJSON(PREFIX + 'config', c); }
export function today() { return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date()); }
export async function withLock(name, action, options = {}) {
  if (!navigator.locks) throw new Error('This browser lacks Web Locks. Use current Chrome or Edge over HTTPS. Billing is disabled to protect numbering.');
  return navigator.locks.request(PREFIX + name, options, action);
}
export async function allocateNumber(c, date = today()) {
  validateConfig(c);
  return withLock('sequence:' + c.spreadsheetId + ':' + c.counter, () => {
    const key = PREFIX + 'seq:' + c.spreadsheetId + ':' + c.counter + ':' + date.slice(0,4);
    const previous = readJSON(key, 0);
    if (!Number.isSafeInteger(previous) || previous < 0 || previous >= 9999) throw new Error('Invalid or exhausted counter sequence. Contact the administrator.');
    writeJSON(key, previous + 1);
    return `LL${date.slice(0,4)}-${c.counter}-${String(previous + 1).padStart(4, '0')}`;
  });
}
