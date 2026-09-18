/**
 * Prueba de carga. Arranca el foro en un proceso aparte, con su propia base de
 * datos temporal, y mide cuántas peticiones por segundo aguanta y con qué
 * latencia. El generador de carga va en otro proceso para no falsear la medida.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const NODE = process.execPath;
const PUERTO = 3210;
const dataDir = path.join(os.tmpdir(), `foro-carga-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });

const hijo = spawn(NODE, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  cwd: RAIZ,
  env: {
    ...process.env,
    PORT: String(PUERTO),
    DATA_DIR: dataDir,
    NODE_ENV: 'production',
    BASE_URL: `https://carga.local`,
    PERMITIR_INSEGURO: '1',
    SEED_DEMO: 'true',
    ADMIN_EMAIL: 'carga@test.local',
    ADMIN_PASSWORD: 'pan-con-tomate-42',
    FACEBOOK_PAGE_ID: '',
    FACEBOOK_PAGE_TOKEN: '',
    // La prueba llega toda desde la misma IP; sin subir el tope, el limitador
    // por red rechazaría la mitad de las conexiones en vivo.
    LIMITE_VIVO: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let salida = '';
hijo.stdout.on('data', (d) => { salida += d; });
hijo.stderr.on('data', (d) => { salida += d; });

const base = `http://127.0.0.1:${PUERTO}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i += 1) {
  try {
    const r = await fetch(`${base}/api/salud`);
    if (r.ok) break;
  } catch { /* todavía arrancando */ }
  await esperar(500);
}

function percentil(valores, p) {
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor((orden.length * p) / 100))];
}

/** Lanza `total` peticiones manteniendo `concurrencia` en vuelo. */
async function medir(nombre, hacer, { total, concurrencia }) {
  const latencias = [];
  let errores = 0;
  let hechas = 0;
  const inicio = Date.now();
  await Promise.all(
    Array.from({ length: concurrencia }, async () => {
      while (hechas < total) {
        hechas += 1;
        const t = Date.now();
        try {
          const r = await hacer();
          if (r.status >= 400) errores += 1;
          await r.arrayBuffer();
        } catch {
          errores += 1;
        }
        latencias.push(Date.now() - t);
      }
    })
  );
  const seg = (Date.now() - inicio) / 1000;
  return {
    nombre,
    concurrencia,
    peticiones: latencias.length,
    porSegundo: Math.round(latencias.length / seg),
    medianaMs: percentil(latencias, 50),
    p95Ms: percentil(latencias, 95),
    errores,
  };
}

const csrf = (h) => (h.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

const resultados = [];
for (const [nombre, ruta] of [['Portada', '/'], ['Listado de incidencias', '/incidencias'], ['Directorio de negocios', '/negocios'], ['API de marcadores', '/api/marcadores']]) {
  resultados.push(await medir(nombre, () => fetch(base + ruta), { total: 600, concurrencia: 50 }));
}

/** Acceso completo y realista: sesión nueva, testigo nuevo y comprobación de la contraseña. */
async function iniciarSesion() {
  const primera = await fetch(`${base}/acceder`);
  const cookies = (primera.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]);
  const token = csrf(await primera.text());
  return fetch(`${base}/acceder`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies.join('; ') },
    body: new URLSearchParams({ _csrf: token, email: 'carga@test.local', contrasena: 'pan-con-tomate-42' }).toString(),
  });
}
resultados.push(await medir('Iniciar sesión (completo)', iniciarSesion, { total: 60, concurrencia: 10 }));

// Lecturas mientras varios vecinos inician sesión: ¿se congela el foro para el resto?
const durante = (async () => {
  await esperar(80);
  return medir('Portada mientras hay accesos', () => fetch(base + '/'), { total: 300, concurrencia: 25 });
})();
await medir('accesos en paralelo', iniciarSesion, { total: 30, concurrencia: 6 });
resultados.push(await durante);

/* ---------------------------------------------------------------
   Conexiones en vivo: cientos de vecinos con el foro abierto a la vez.
   Interesan dos cosas: si el servidor sigue sirviendo páginas con esa
   carga encima, y cuánto tarda un aviso en llegarles a todos.
   --------------------------------------------------------------- */
const CONEXIONES = Number(process.env.CONEXIONES_VIVO || 300);
const agente = new http.Agent({ keepAlive: true, maxSockets: CONEXIONES + 50 });
const abiertas = [];
const llegadas = [];
let esperandoAviso = false;

function conectarEnVivo() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: PUERTO, path: '/api/eventos', agent: agente, headers: { Accept: 'text/event-stream' } },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (trozo) => {
          if (esperandoAviso && trozo.includes('event: comentario:nuevo')) llegadas.push(Date.now());
        });
        res.on('error', () => {});
        abiertas.push(req);
        // Un 429 también responde: solo cuentan las aceptadas.
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

const conectadas = (await Promise.all(Array.from({ length: CONEXIONES }, conectarEnVivo))).filter(Boolean).length;
await esperar(500);
const salud = await (await fetch(base + '/api/salud')).json();

resultados.push(await medir(`Portada con ${conectadas} en vivo`, () => fetch(base + '/'), { total: 400, concurrencia: 40 }));

/* Cuánto tarda un comentario nuevo en llegarle a todo el que esté conectado. */
const galletas = [];
const primera = await fetch(`${base}/acceder`);
(primera.headers.getSetCookie?.() || []).forEach((c) => galletas.push(c.split(';')[0]));
let ficha = await primera.text();
const entrada = await fetch(`${base}/acceder`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: galletas.join('; ') },
  body: new URLSearchParams({ _csrf: csrf(ficha), email: 'carga@test.local', contrasena: 'pan-con-tomate-42' }).toString(),
});
/* Al entrar, la sesión se regenera y la cookie cambia: hay que quedarse con la nueva. */
const nuevas = entrada.headers.getSetCookie?.() || [];
if (nuevas.length) {
  galletas.length = 0;
  nuevas.forEach((k) => galletas.push(k.split(';')[0]));
}
const listado = await (await fetch(`${base}/incidencias`)).text();
const slug = [...listado.matchAll(/href="\/incidencias\/([a-z0-9-]+)"/g)].map((m) => m[1]).find((x) => x !== 'nueva');
let reparto = null;
if (slug) {
  ficha = await (await fetch(`${base}/incidencias/${slug}`, { headers: { Cookie: galletas.join('; ') } })).text();
  esperandoAviso = true;
  const t0 = Date.now();
  const comentado = await fetch(`${base}/incidencias/${slug}/comentarios`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: galletas.join('; ') },
    body: new URLSearchParams({ _csrf: csrf(ficha), cuerpo: 'Comprobando el reparto de avisos en vivo.' }).toString(),
  });
  await esperar(1500);
  reparto = { recibidos: llegadas.length, ultimoMs: llegadas.length ? Math.max(...llegadas) - t0 : null, comentario: comentado.status };
}

for (const req of abiertas) req.destroy();

console.log('\n=== PRUEBA DE CARGA ===');
console.log('escenario'.padEnd(34), 'conc'.padStart(5), 'req/s'.padStart(7), 'mediana'.padStart(9), 'p95'.padStart(8), 'errores'.padStart(8));
for (const r of resultados) {
  console.log(
    r.nombre.padEnd(34),
    String(r.concurrencia).padStart(5),
    String(r.porSegundo).padStart(7),
    `${r.medianaMs} ms`.padStart(9),
    `${r.p95Ms} ms`.padStart(8),
    String(r.errores).padStart(8)
  );
}
console.log('');

console.log('=== CONEXIONES EN VIVO ===');
console.log(`  Conexiones abiertas:       ${conectadas} (el servidor cuenta ${salud.enVivo ?? "?"})`);
if (reparto) {
  console.log(`  Comentario publicado:      HTTP ${reparto.comentario}`);
console.log(`  Avisados de un comentario: ${reparto.recibidos} de ${conectadas}`);
  console.log(`  El último se entera en:    ${reparto.ultimoMs} ms`);
}

hijo.kill();
await esperar(500);
fs.rmSync(dataDir, { recursive: true, force: true });
