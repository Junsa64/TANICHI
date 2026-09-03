/* ============================================================================
   TANICHI · TRABAJADOR DE SERVICIO
   Guarda la aplicación en el equipo para que abra sin internet. En una tienda
   esto no es un lujo: si se cae la conexión a media venta, la caja tiene que
   seguir cobrando.

   Los datos (ventas, inventario, fiados) nunca pasan por aquí: viven en el
   almacenamiento del navegador. Esto sólo guarda el programa.
   ========================================================================== */

const CACHE = 'tanichi-v29';

/* Todo lo que hace falta para arrancar a oscuras. */
const ARCHIVOS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icono-192.jpg',
  './icono-512.jpg',
  './icono-mask.jpg',
  './js/core.js',
  './js/iconos.js',
  './js/turno.js',
  './js/pos.js',
  './js/inventario.js',
  './js/corte.js',
  './js/historial.js',
  './js/reportes.js',
  './js/fotos.js',
  './js/fiados.js',
  './js/app.js',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Uno por uno: si un archivo falta, no se cae la instalación entera
    await Promise.all(ARCHIVOS.map(a => cache.add(a).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const viejas = (await caches.keys()).filter(k => k !== CACHE);
    await Promise.all(viejas.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);

    /* Siempre la red primero. El servidor es esta misma computadora, así que
       responde al instante y la app nunca se queda con una versión vieja.
       Si el servidor no está —sin internet, o la app abierta desde el icono
       sin el servidor— se sirve lo guardado. */
    try {
      const red = await fetch(req);
      if (red && red.ok) cache.put(req, red.clone());
      return red;
    } catch {
      /* ignoreSearch: la página pide "style.css?v=12" y lo guardado es
         "style.css". Sin esto, cada cambio de versión rompería el modo sin
         internet: la página abriría sin estilos y sin código. */
      const guardado = await cache.match(req, { ignoreSearch: true });
      if (guardado) return guardado;
      if (req.mode === 'navigate') {
        const inicio = await cache.match('./index.html', { ignoreSearch: true });
        if (inicio) return inicio;
      }
      return new Response('', { status: 504, statusText: 'Sin conexión' });
    }
  })());
});
