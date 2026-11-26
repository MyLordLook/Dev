const CACHE='lordlook-shell-v3-1';
const PDF='https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
const SHELL=['./','./index.html','./styles.css','./config.js','./auth.js','./api.js','./schema.js','./pdf-generator.js','./app.js','./assets.js','./defaults.js','./delivery.js','./shared.js','./catalog-editor.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lordlook-shell-') && k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function cachePdf(){const cache=await caches.open(CACHE);try{const r=await fetch(PDF,{mode:'cors'});if(r.ok)await cache.put(PDF,r);}catch{/* A later online navigation retries the pinned library download. */}}
self.addEventListener('message',event=>{if(event.data==='CACHE_PDF')event.waitUntil(cachePdf());});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),base=new URL(self.registration.scope);
  const shellURLs=SHELL.map(p=>new URL(p,base).href);
  if(event.request.method!=='GET' || !(shellURLs.includes(url.href) || url.href===PDF))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const saved=await cache.match(event.request);if(saved)return saved;
    const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;
  }));
});
