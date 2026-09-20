/**
 * Exporta una copia estática y navegable del foro.
 *
 * Arranca el foro en un proceso aparte con su contenido de ejemplo, recorre
 * todas las páginas públicas y las guarda como ficheros HTML que funcionan sin
 * servidor: se abre `index.html` con doble clic y se navega igual que en local.
 *
 * Qué SÍ funciona en la copia: navegar entre páginas, el menú del móvil, las
 * galerías de fotos, los mapas (las teselas van dentro) y los desplegables.
 * Qué NO: entrar, publicar, comentar, filtrar ni buscar. Todo eso necesita el
 * servidor, y al pulsarlo la copia lo dice en vez de dar un error feo.
 *
 * Uso: npm run exportar
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SALIDA = path.join(RAIZ, 'export');
const PUERTO = Number(process.env.PUERTO_EXPORT || 3299);
const base = `http://127.0.0.1:${PUERTO}`;

/* Dominio definitivo. Sin él, las etiquetas de compartir y la dirección
   canónica apuntarían al servidor temporal que usa esta exportación.
   Uso: DOMINIO=https://foro.tudominio.es npm run exportar */
const DOMINIO = (process.env.DOMINIO || '').replace(/\/+$/, '');

/* Se usa una base de datos temporal: la copia nunca debe llevar datos reales
   de los vecinos, solo el contenido de ejemplo. */
const dataDir = path.join(os.tmpdir(), `foro-export-${Date.now()}`);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* Páginas que hay que exportar aunque no cuelguen de un enlace visible. */
const SEMILLAS = [
  '/', '/incidencias', '/mapa', '/negocios', '/negocios/ofertas', '/estadisticas',
  '/informe', '/recursos', '/normas', '/sobre', '/app', '/aviso-legal', '/privacidad',
  '/acceder', '/registro',
];

/* Nada de esto tiene sentido sin servidor. */
const FUERA = [/^\/admin/, /^\/api\//, /^\/salir/, /\.csv$/, /\.xml$/, /^\/robots/, /\/nueva$/, /\/nuevo$/, /\/editar$/];

const ASSET = /^\/(css|js|img|fonts|uploads|vendor|manifest\.webmanifest)/;

/** Ruta del fichero HTML que le corresponde a una dirección. */
function ficheroDe(ruta) {
  if (ruta === '/') return 'index.html';
  const limpio = ruta.replace(/^\/+|\/+$/g, '');
  return `${limpio}.html`;
}

/** Prefijo «../» necesario para subir desde un fichero hasta la raíz. */
function subir(fichero) {
  const niveles = fichero.split('/').length - 1;
  return niveles === 0 ? '' : '../'.repeat(niveles);
}

async function arrancarServidor() {
  fs.mkdirSync(dataDir, { recursive: true });
  const hijo = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(PUERTO),
      DATA_DIR: dataDir,
      NODE_ENV: 'development',
      BASE_URL: base,
      SEED_DEMO: 'true',
      ADMIN_EMAIL: 'export@vereda.local',
      ADMIN_PASSWORD: 'pan-con-tomate-42',
      FACEBOOK_PAGE_ID: '',
      FACEBOOK_PAGE_TOKEN: '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${base}/api/salud`)).ok) return hijo;
    } catch {
      /* todavía arrancando */
    }
    await esperar(400);
  }
  hijo.kill();
  throw new Error('El foro no ha llegado a arrancar.');
}

/** Recorre las páginas públicas siguiendo los enlaces internos. */
async function rastrear() {
  const pendientes = [...SEMILLAS];
  const vistas = new Map();
  while (pendientes.length) {
    const ruta = pendientes.shift();
    if (vistas.has(ruta)) continue;
    const res = await fetch(base + ruta);
    if (!res.ok) {
      console.log(`  (omitida ${ruta}: HTTP ${res.status})`);
      vistas.set(ruta, null);
      continue;
    }
    const html = await res.text();
    vistas.set(ruta, html);
    for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const destino = m[1].replace(/\/$/, '') || '/';
      if (ASSET.test(destino) || FUERA.some((r) => r.test(destino))) continue;
      if (!vistas.has(destino) && !pendientes.includes(destino)) pendientes.push(destino);
    }
  }
  for (const [ruta, html] of vistas) if (html === null) vistas.delete(ruta);
  return vistas;
}

/* ---------------- Teselas del mapa ---------------- */

const lonAx = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latAy = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/**
 * Descarga las teselas de OpenStreetMap que cubren el barrio y las guarda como
 * un diccionario dentro de un fichero JavaScript. Es una descarga acotada y de
 * una sola vez; la copia luego no vuelve a pedir nada a OpenStreetMap.
 */
const CACHE_TESELAS = path.join(RAIZ, 'tools', '.teselas-cache.json');

async function bajarTeselas(puntos, destino) {
  const lats = puntos.map((p) => p.lat).filter(Number.isFinite);
  const lngs = puntos.map((p) => p.lng).filter(Number.isFinite);
  if (!lats.length) return 0;

  const margen = 0.004; // unos 450 metros de aire alrededor
  const caja = {
    n: Math.max(...lats) + margen,
    s: Math.min(...lats) - margen,
    e: Math.max(...lngs) + margen,
    o: Math.min(...lngs) - margen,
  };

  let teselas = {};
  try {
    teselas = JSON.parse(fs.readFileSync(CACHE_TESELAS, 'utf8'));
  } catch {
    /* primera vez: se descargan */
  }
  let bajadas = Object.keys(teselas).length;
  if (bajadas) console.log(`    ${bajadas} teselas guardadas de una exportación anterior.`);
  const TOPE = 520;
  for (const z of [14, 15, 16, 17]) {
    const x0 = lonAx(caja.o, z);
    const x1 = lonAx(caja.e, z);
    const y0 = latAy(caja.n, z);
    const y1 = latAy(caja.s, z);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        if (bajadas >= TOPE) break;
        if (teselas[`${z}/${x}/${y}`]) continue;
        try {
          const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
            headers: { 'User-Agent': 'ForoVecinalVereda/1.0 (exportacion estatica de una web vecinal)' },
          });
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          teselas[`${z}/${x}/${y}`] = `data:image/png;base64,${buf.toString('base64')}`;
          bajadas += 1;
          if (bajadas % 25 === 0) process.stdout.write(`    ${bajadas} teselas…\r`);
          await esperar(60); // sin prisa: son servidores donados
        } catch {
          /* una tesela suelta que falla no rompe el mapa */
        }
      }
    }
  }
  try {
    fs.mkdirSync(path.dirname(CACHE_TESELAS), { recursive: true });
    fs.writeFileSync(CACHE_TESELAS, JSON.stringify(teselas));
  } catch {
    /* sin caché se vuelven a descargar la próxima vez, nada grave */
  }

  const js = [
    '/* Teselas de OpenStreetMap incrustadas: el mapa funciona sin conexión. */',
    `window.TESELAS = ${JSON.stringify(teselas)};`,
    "window.TESELA_VACIA = 'data:image/svg+xml;base64," +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8efe9"/></svg>'
      ).toString('base64') +
      "';",
    'window.tesela = function (z, x, y) { return window.TESELAS[z + "/" + x + "/" + y] || window.TESELA_VACIA; };',
    '/* Capa de Leaflet que sirve las teselas incrustadas en lugar de pedirlas a internet. */',
    'if (window.L) {',
    '  var CapaCopia = window.L.TileLayer.extend({',
    '    getTileUrl: function (coords) { return window.tesela(coords.z, coords.x, coords.y); },',
    '  });',
    '  window.capaTeselas = function (opciones) { return new CapaCopia("", opciones); };',
    '}',
  ].join('\n');
  fs.writeFileSync(destino, js);
  return bajadas;
}

/* ---------------- Copiado de ficheros ---------------- */

function copiarArbol(origen, destino, filtro = () => true) {
  if (!fs.existsSync(origen)) return 0;
  fs.mkdirSync(destino, { recursive: true });
  let n = 0;
  for (const entrada of fs.readdirSync(origen, { withFileTypes: true })) {
    const o = path.join(origen, entrada.name);
    const d = path.join(destino, entrada.name);
    if (entrada.isDirectory()) n += copiarArbol(o, d, filtro);
    else if (filtro(entrada.name)) {
      fs.copyFileSync(o, d);
      n += 1;
    }
  }
  return n;
}

/* ---------------- Reescritura del HTML ---------------- */

function reescribir(html, fichero, paginas) {
  const arriba = subir(fichero);
  let s = html;

  // Los guiones que hablan con el servidor no pintan nada aquí: la conexión en
  // vivo se pasaría el rato reintentando y el service worker no tiene sentido.
  s = s.replace(/\s*<script src="\/js\/(live|pwa)\.js[^"]*"[^>]*><\/script>/g, '');

  // Datos del mapa: ahora son ficheros.
  s = s.replace(/data-map-markers="\/api\/marcadores[^"]*"/g, `data-map-markers="${arriba}datos/marcadores.json"`);
  s = s.replace(/data-map-business="\/api\/negocios[^"]*"/g, `data-map-business="${arriba}datos/negocios.json"`);

  // Recursos (estilos, guiones, imágenes, fotos): a rutas relativas.
  s = s.replace(/(href|src)="(\/(?:css|js|img|fonts|uploads|vendor)\/[^"]*|\/manifest\.webmanifest)"/g, (todo, attr, ruta) => {
    const limpia = ruta.split('?')[0].replace(/^\//, '');
    return `${attr}="${arriba}${limpia}"`;
  });

  // Enlaces internos: al fichero equivalente, o marcados como no disponibles.
  s = s.replace(/href="(\/[^"]*)"/g, (todo, ruta) => {
    const base = ruta.split(/[?#]/)[0].replace(/\/$/, '') || '/';
    const ancla = ruta.includes('#') ? `#${ruta.split('#')[1]}` : '';
    // Un enlace con filtros o paginación no tiene equivalente estático.
    const filtrado = ruta.includes(String.fromCharCode(63));
    if (paginas.has(base) && !filtrado) return `href="${arriba}${ficheroDe(base)}${ancla}"`;
    const cercano = paginas.has(base) ? ficheroDe(base) : ficheroDe("/");
    return `href="${arriba}${cercano}" data-sin-servidor="1"`;
  });

  // Filtros y paginación: enlaces que solo llevan la consulta, sin barra inicial.
  const INTERROGANTE = String.fromCharCode(63);
  s = s.split(`href="${INTERROGANTE}`).join('href="#" data-sin-servidor="1" data-consulta="');

  // La dirección del servidor temporal se cambia por el dominio de verdad.
  if (DOMINIO) {
    s = s.split(base).join(DOMINIO);
    const sinEsquema = (u) => u.replace(/^https?:\/\//, '');
    s = s.split(encodeURIComponent(base)).join(encodeURIComponent(DOMINIO));
    s = s.split(sinEsquema(base)).join(sinEsquema(DOMINIO));
  }

  // Los formularios avisan en vez de romperse.
  s = s.replace(/<form /g, '<form data-sin-servidor="1" ');

  // Y se añaden los dos guiones propios de la copia.
  s = s.replace(
    '</body>',
    `<script src="${arriba}datos/mapa.js"></script>\n<script src="${arriba}js/teselas.js"></script>\n<script src="${arriba}js/estatico.js"></script>\n</body>`
  );
  return s;
}

/** El guion que hace habitable la copia. */
const ESTATICO = `/* Ajustes de la copia estática del foro. */
(function () {
  'use strict';

  function aviso(texto) {
    var caja = document.getElementById('aviso-copia');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'aviso-copia';
      caja.setAttribute('role', 'status');
      caja.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(1rem + env(safe-area-inset-bottom,0px) + 62px);z-index:4000;max-width:min(92vw,430px);padding:0.7rem 1.1rem;border-radius:14px;background:#17211e;color:#fff;font:600 0.88rem/1.35 Manrope,system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3);text-align:center';
      document.body.appendChild(caja);
    }
    caja.textContent = texto;
    caja.hidden = false;
    clearTimeout(aviso.reloj);
    aviso.reloj = setTimeout(function () { caja.hidden = true; }, 3600);
  }

  var TEXTO = 'Esto es una copia para mirar: entrar, publicar y filtrar necesitan el foro en marcha.';

  document.addEventListener('click', function (e) {
    var enlace = e.target.closest('a[data-sin-servidor]');
    if (enlace) { e.preventDefault(); aviso(TEXTO); }
  });
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    aviso(TEXTO);
  });

  // El botón de apoyo, si falla su petición, reenvía el formulario y te saca de
  // la página. Este guion se ejecuta antes que app.js, así que le quitamos la
  // marca y nunca llega a engancharse.
  document.querySelectorAll('[data-support]').forEach(function (f) { f.removeAttribute('data-support'); });

  // Los campos siguen viéndose, pero no invitan a rellenarlos.
  document.querySelectorAll('form[data-sin-servidor] button[type="submit"], form[data-sin-servidor] button:not([type])').forEach(function (b) {
    b.title = TEXTO;
  });
})();
`;

/* ---------------- Programa ---------------- */

async function main() {
  console.log('\n=== EXPORTAR COPIA ESTÁTICA ===\n');
  console.log('  Arrancando el foro con contenido de ejemplo…');
  const hijo = await arrancarServidor();

  try {
    if (DOMINIO) console.log(`  Dominio de la copia: ${DOMINIO}`);
  else console.log('  (Sin DOMINIO: las etiquetas para compartir llevarán la dirección temporal.)');
  console.log('  Recorriendo las páginas públicas…');
    const paginas = await rastrear();
    console.log(`    ${paginas.size} páginas.`);

    fs.rmSync(SALIDA, { recursive: true, force: true });
    fs.mkdirSync(SALIDA, { recursive: true });

    console.log('  Copiando estilos, guiones, iconos y fotos…');
    const nPublic = copiarArbol(path.join(RAIZ, 'public'), SALIDA, (n) => !/^(sw|live|pwa|sin-conexion)\./.test(n));
    const nFotos = copiarArbol(path.join(dataDir, 'uploads'), path.join(SALIDA, 'uploads'));
    copiarArbol(path.join(RAIZ, 'node_modules', 'leaflet', 'dist'), path.join(SALIDA, 'vendor', 'leaflet'), (n) =>
      !n.includes('-src') && !n.endsWith('.map')
    );

    // La hoja de estilos referencia la tipografía con ruta absoluta.
    const css = path.join(SALIDA, 'css', 'app.css');
    fs.writeFileSync(css, fs.readFileSync(css, 'utf8').replace(/url\(['"]?\/([^'")]+)['"]?\)/g, "url('../$1')"));

    // El mapa deja de pedir los planos al foro: van incrustados.
    const mapJs = path.join(SALIDA, 'js', 'map.js');
    fs.writeFileSync(
      mapJs,
      fs
        .readFileSync(mapJs, 'utf8')
        .replace(
          "const TILES = '/planos/{z}/{x}/{y}.png';",
          "const TILES = '';"
        )
        .replace(
          'L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19 })',
          'window.capaTeselas({ attribution: ATTR, maxZoom: 17, minZoom: 14 })'
        )
    );
    const mapaLeido = fs.readFileSync(mapJs, 'utf8')
      .split("fetch(markersEl.dataset.mapMarkers, { headers: { Accept: 'application/json' } })")
      .join('window.datosMapa(markersEl.dataset.mapMarkers)')
      .split("fetch(bizEl.dataset.mapBusiness, { headers: { Accept: 'application/json' } })")
      .join('window.datosMapa(bizEl.dataset.mapBusiness)')
      .split('href="/incidencias/${esc(m.slug)}"')
      .join('href="incidencias/${esc(m.slug)}.html"')
      .split('href="/negocios/${esc(m.slug)}"')
      .join('href="negocios/${esc(m.slug)}.html"');
    fs.writeFileSync(mapJs, mapaLeido);

    const appJs = path.join(SALIDA, 'js', 'app.js');
    fs.writeFileSync(
      appJs,
      fs
        .readFileSync(appJs, 'utf8')
        .replace(
          'img.src = `/planos/${ZOOM}/${tx}/${ty}.png`;',
          'img.src = window.tesela(ZOOM, tx, ty);'
        )
    );

    console.log('  Guardando los datos de los mapas…');
    fs.mkdirSync(path.join(SALIDA, 'datos'), { recursive: true });
    const marcadores = await (await fetch(`${base}/api/marcadores`)).json();
    const negocios = await (await fetch(`${base}/api/negocios`)).json();
    fs.writeFileSync(path.join(SALIDA, 'datos', 'marcadores.json'), JSON.stringify(marcadores));
    fs.writeFileSync(path.join(SALIDA, 'datos', 'negocios.json'), JSON.stringify(negocios));
    const datosJs = [
      '/* Chinchetas de los mapas, incrustadas para que el mapa funcione tambien al abrir el fichero con doble clic. */',
      'window.MAPA_DATOS = ' + JSON.stringify({ 'marcadores.json': marcadores, 'negocios.json': negocios }) + ';',
      'window.datosMapa = function (ruta) {',
      '  var clave = String(ruta).split(String.fromCharCode(47)).pop();',
      '  return Promise.resolve({ json: function () { return window.MAPA_DATOS[clave] || { markers: [] }; } });',
      '};',
    ].join(String.fromCharCode(10));
    fs.writeFileSync(path.join(SALIDA, 'datos', 'mapa.js'), datosJs);

    console.log('  Descargando las teselas del barrio (una sola vez)…');
    const puntos = [
      ...marcadores.markers.map((m) => ({ lat: m.lat, lng: m.lng })),
      ...negocios.markers.map((m) => ({ lat: m.lat, lng: m.lng })),
    ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const nTeselas = await bajarTeselas(puntos, path.join(SALIDA, 'js', 'teselas.js'));
    console.log(`    ${nTeselas} teselas incrustadas.        `);

    fs.writeFileSync(path.join(SALIDA, 'js', 'estatico.js'), ESTATICO);

    console.log('  Escribiendo las páginas…');
    for (const [ruta, html] of paginas) {
      const fichero = ficheroDe(ruta);
      const destino = path.join(SALIDA, fichero);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, reescribir(html, fichero, paginas));
    }

    const cuenta = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? cuenta(path.join(dir, e.name)) : 1), 0);
    const pesa = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).reduce(
        (n, e) => n + (e.isDirectory() ? pesa(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size),
        0
      );

    console.log('\n  LISTO');
    console.log(`    Carpeta:  ${SALIDA}`);
    console.log(`    Páginas:  ${paginas.size}   Ficheros: ${cuenta(SALIDA)} (${nPublic} de public, ${nFotos} fotos)`);
    console.log(`    Tamaño:   ${(pesa(SALIDA) / 1024 / 1024).toFixed(1)} MB`);
    console.log('    Ábrela con doble clic en export/index.html\n');
  } finally {
    hijo.kill();
    await esperar(400);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
