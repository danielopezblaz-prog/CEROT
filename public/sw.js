/**
 * Service worker del foro.
 *
 * Es lo que convierte la web en una app instalable: guarda el armazón (estilos,
 * guiones, tipografía, iconos) para que abra al instante, conserva las fotos ya
 * vistas y muestra una página decente cuando no hay cobertura.
 *
 * Dos reglas que no se rompen nunca:
 *  1. El HTML no se guarda jamás. Las páginas llevan datos de cada vecino y su
 *     sesión; una copia guardada podría enseñarle a otro lo que no debe ver.
 *  2. Nada de interceptar el flujo de eventos en vivo ni la API.
 */

const VERSION = 'v3';
const ARMAZON = 'foro-armazon-' + VERSION;
const FOTOS = 'foro-fotos-' + VERSION;
const MAPAS = 'foro-mapas-' + VERSION;

const SIN_CONEXION = '/sin-conexion.html';

/* Lo mínimo para que la app abra aunque no haya red. */
const BASICOS = [
  SIN_CONEXION,
  '/css/app.css',
  '/js/app.js',
  '/js/live.js',
  '/js/pwa.js',
  '/fonts/manrope-latin.woff2',
  '/img/logo.svg',
  '/img/favicon.svg',
  '/img/icon-192.png',
  '/img/icon-512.png',
];

const TOPE_FOTOS = 150;
const TOPE_MAPAS = 250;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(ARMAZON)
      // Uno a uno: si falta un fichero suelto, la instalación no se cae entera.
      .then((cache) => Promise.all(BASICOS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  const vigentes = [ARMAZON, FOTOS, MAPAS];
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith('foro-') && !vigentes.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Recorta una caché a los últimos `tope` elementos. */
async function recortar(nombre, tope) {
  const cache = await caches.open(nombre);
  const claves = await cache.keys();
  if (claves.length <= tope) return;
  await Promise.all(claves.slice(0, claves.length - tope).map((k) => cache.delete(k)));
}

/** Primero la copia guardada; si no está, la red (y se guarda para la próxima). */
async function deLaCaja(req, nombre, tope) {
  const cache = await caches.open(nombre);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone());
    recortar(nombre, tope);
  }
  return res;
}

/**
 * Armazón (estilos, guiones, tipografía, iconos).
 *
 * Los ficheros llegan con `?v=...`, que cambia con cada actualización del foro.
 * Por eso se busca primero la coincidencia exacta: si la versión es nueva no
 * está guardada, se baja de la red y se tiran las versiones anteriores de ese
 * mismo fichero. Buscar ignorando la versión solo sirve de último recurso,
 * cuando no hay red; hacerlo antes serviría estilos viejos tras cada mejora.
 */
async function delArmazon(req) {
  const cache = await caches.open(ARMAZON);
  const exacta = await cache.match(req);
  if (exacta) return exacta;

  try {
    const res = await fetch(req);
    if (res && res.ok) {
      await tirarVersionesViejas(cache, req);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cualquiera = await cache.match(req, { ignoreSearch: true });
    if (cualquiera) return cualquiera;
    throw err;
  }
}

/** Borra las copias guardadas del mismo fichero con otra versión. */
async function tirarVersionesViejas(cache, req) {
  const ruta = new URL(req.url).pathname;
  const claves = await cache.keys();
  await Promise.all(
    claves.filter((k) => new URL(k.url).pathname === ruta && k.url !== req.url).map((k) => cache.delete(k))
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const propio = url.origin === self.location.origin;

  // Los eventos en vivo y la API van siempre directos a la red.
  if (propio && url.pathname.startsWith('/api/')) return;
  if (req.headers.get('accept') === 'text/event-stream') return;

  // Las teselas del mapa se guardan: así el mapa sigue viéndose sin datos y se
  // baja mucho la carga sobre los servidores de OpenStreetMap.
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(deLaCaja(req, MAPAS, TOPE_MAPAS).catch(() => Response.error()));
    return;
  }

  if (!propio) return;

  // Páginas: siempre la versión de verdad. Si no hay red, la pantalla de aviso.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(ARMAZON);
        return (await cache.match(SIN_CONEXION)) || new Response('Sin conexión', { status: 503 });
      })
    );
    return;
  }

  // Fotos subidas por los vecinos: el nombre del fichero no se repite nunca.
  if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(deLaCaja(req, FOTOS, TOPE_FOTOS).catch(() => Response.error()));
    return;
  }

  // Armazón: estilos, guiones, tipografía, iconos y el propio manifiesto.
  if (/^\/(css|js|fonts|img|vendor)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    e.respondWith(delArmazon(req).catch(() => Response.error()));
  }
});

/* La página avisa cuando el vecino acepta actualizar. */
self.addEventListener('message', (e) => {
  if (e.data === 'actualizar-ya') self.skipWaiting();
});
