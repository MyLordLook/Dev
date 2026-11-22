import {getConfig, SCOPES} from './config.js';
let accessToken = '', expiresAt = 0, email = '', pending = null, client = null, lastAutomaticAttempt = 0;
export class AuthRequired extends Error { constructor(message = 'Sign in / Reauthorize Google to resume sync. Your cart is safe.') { super(message); this.name = 'AuthRequired'; } }
const emit = () => window.dispatchEvent(new CustomEvent('authchange', {detail: authState()}));
export function authState() { return {email, expiresAt, connected: !!accessToken && expiresAt > Date.now()}; }
export function clearAuth() { accessToken = ''; expiresAt = 0; email = ''; client = null; emit(); }
export function authorize(interactive = true) {
  if (pending) return pending;
  if (!navigator.onLine) return Promise.reject(new AuthRequired('Offline. Bills remain queued until Google can be reached.'));
  if (!window.google?.accounts?.oauth2) return Promise.reject(new AuthRequired('Google sign-in has not loaded. Reconnect and reload this page; the cart is saved.'));
  const clientId = getConfig().clientId;
  if (!clientId) return Promise.reject(new AuthRequired('Complete Setup first.'));
  pending = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (error) { accessToken = ''; expiresAt = 0; emit(); reject(error); } else { emit(); resolve(accessToken); }
    };
    const timeout = setTimeout(() => finish(new AuthRequired('Google authorization timed out. Click Sign in / Reauthorize.')), 60000);
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPES.join(' '), include_granted_scopes: true,
      callback: async response => {
        if (settled) return;
        if (response.error || !response.access_token) return finish(new AuthRequired(response.error_description || response.error || 'No access token received.'));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, ...SCOPES)) return finish(new AuthRequired('Both Sheets and Drive permissions are required.'));
        accessToken = response.access_token;
        expiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
        try {
          const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {headers: {Authorization: 'Bearer ' + accessToken}, signal: AbortSignal.timeout(20000)});
          if (!r.ok) throw new Error('Could not verify the signed-in Google account.');
          const data = await r.json();
          if (!data.user?.emailAddress) throw new Error('Google did not return an account email.');
          if (settled) return;
          email = data.user.emailAddress;
          finish();
        } catch (error) { finish(new AuthRequired(error.message)); }
      },
      error_callback: error => finish(new AuthRequired('Google authorization needs a click: ' + (error.type || 'popup unavailable')))
    });
    client.requestAccessToken({prompt: interactive && !email ? 'select_account' : '', ...(email ? {hint: email} : {})});
  }).finally(() => { pending = null; });
  return pending;
}
export async function token(force = false) {
  if (pending) return pending;
  if (!force && accessToken && expiresAt - Date.now() >= 300000) return accessToken;
  if (!email || Date.now() - lastAutomaticAttempt < 60000) throw new AuthRequired();
  lastAutomaticAttempt = Date.now();
  return authorize(false);
}
export async function googleFetch(url, options = {}) {
  const {expectedEmail, ...fetchOptions} = options;
  for (let attempt = 0; attempt < 2; attempt++) {
    const bearer = await token(attempt > 0);
    if (expectedEmail && email !== expectedEmail) throw new AuthRequired('Sign in as ' + expectedEmail + ' to sync this bill.');
    const response = await fetch(url, {...fetchOptions, headers: {...fetchOptions.headers, Authorization: 'Bearer ' + bearer}, signal: AbortSignal.timeout(25000)});
    if (response.status !== 401) return response;
    accessToken = ''; expiresAt = 0;
    if (attempt === 1) throw new AuthRequired();
  }
  throw new AuthRequired();
}
