/**
 * Rastreo de extremo a extremo: arranca el foro en memoria, crea contenido,
 * y recorre todos los enlaces internos con tres perfiles distintos.
 * Informa de cualquier página que no responda 200 y de los enlaces rotos.
 */
import { config } from '../src/config.js';
const { createApp } = await import('../src/app.js');

const { app, seed } = createApp({ ...config, seedDemo: true, isProduction: false }, { dbFile: ':memory:' });
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

function makeClient() {
  const jar = new Map();
  const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const store = (r) => {
    for (const c of r.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      jar.set(k.trim(), v);
    }
  };
  return {
    jar,
    async get(p) {
      const r = await fetch(base + p, { redirect: 'manual', headers: { Cookie: cookie() } });
      store(r);
      return r;
    },
    async post(p, body) {
      const r = await fetch(base + p, {
        method: 'POST',
        redirect: 'manual',
        headers: { Cookie: cookie(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });
      store(r);
      return r;
    },
  };
}
const csrf = (h) => (h.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

/* ---------- Preparar contenido para que haya enlaces que seguir ---------- */
const admin = makeClient();
await admin.post('/acceder', {
  _csrf: csrf(await (await admin.get('/acceder')).text()),
  email: seed.adminCreated.email,
  contrasena: seed.adminCreated.password,
});

const vecino = makeClient();
await vecino.post('/registro', {
  _csrf: csrf(await (await vecino.get('/registro')).text()),
  nombre: 'Rastreo', apellidos: 'De Prueba', telefono: '612 00 00 00',
  email: 'rastreo@test.local', contrasena: 'pan-con-tomate-42', contrasena2: 'pan-con-tomate-42', normas: '1',
});
// El vecino da de alta un negocio y la moderación lo aprueba
const tokV = csrf(await (await vecino.get('/negocios/nuevo')).text());
const alta = await vecino.post('/negocios', {
  _csrf: tokV, nombre: 'Kiosco de Prueba', categoria: 'otros',
  resumen: 'Prensa, chuches y recargas de transporte para el rastreo.',
  descripcion: 'Negocio creado por el rastreo automático.',
  direccion: 'Calle de Prueba, 1', lat: '40.3209', lng: '-3.7563', telefono: '916 00 00 00',
  cerrado_0: '', desde1_0: '09:00', hasta1_0: '14:00',
});
const slugNegocio = alta.headers.get('location')?.replace('/negocios/', '');
const adminNeg = await (await admin.get('/admin/negocios?estado=pendiente')).text();
const idNeg = adminNeg.match(/\/admin\/negocios\/(\d+)\/aprobar/)?.[1];
if (idNeg) await admin.post(`/admin/negocios/${idNeg}/aprobar`, { _csrf: csrf(adminNeg), volver: '/admin/negocios' });
// Una oferta y un producto
if (slugNegocio) {
  const t = csrf(await (await vecino.get(`/negocios/${slugNegocio}/publicaciones/nueva`)).text());
  await vecino.post(`/negocios/${slugNegocio}/publicaciones`, { _csrf: t, tipo: 'oferta', titulo: 'Oferta de rastreo', cuerpo: 'Prueba', precio: '1 €' });
  const t2 = csrf(await (await vecino.get(`/negocios/${slugNegocio}/productos`)).text());
  await vecino.post(`/negocios/${slugNegocio}/productos`, { _csrf: t2, nombre: 'Producto de rastreo', precio: '2 €' });
}
// Una incidencia con comentario y denuncia
const tokP = csrf(await (await vecino.get('/incidencias/nueva')).text());
const pub = await vecino.post('/incidencias', {
  _csrf: tokP, tipo: 'incidencia', titulo: 'Incidencia creada por el rastreo automático',
  categoria: 'alumbrado', cuerpo: 'Texto suficientemente largo para pasar la validación del formulario.',
  ubicacion: 'Calle de Prueba, 1', lat: '40.3209', lng: '-3.7563',
});
const slugPub = pub.headers.get('location')?.replace('/incidencias/', '');
if (slugPub) {
  const t = csrf(await (await vecino.get(`/incidencias/${slugPub}`)).text());
  await vecino.post(`/incidencias/${slugPub}/comentarios`, { _csrf: t, cuerpo: 'Comentario del rastreo.' });
  const otro = makeClient();
  await otro.post('/registro', {
    _csrf: csrf(await (await otro.get('/registro')).text()),
    nombre: 'Otro', apellidos: 'Vecino', telefono: '612 11 11 11',
    email: 'otro.rastreo@test.local', contrasena: 'pan-con-tomate-42', contrasena2: 'pan-con-tomate-42', normas: '1',
  });
  const t3 = csrf(await (await otro.get(`/incidencias/${slugPub}`)).text());
  await otro.post(`/incidencias/${slugPub}/denunciar`, { _csrf: t3, motivo: 'spam', detalles: 'Prueba' });
}

/* ---------- Rastreo ---------- */
const SEMILLAS = ['/', '/incidencias', '/mapa', '/estadisticas', '/informe', '/informe.csv', '/negocios',
  '/negocios/ofertas', '/negocios/nuevo', '/recursos', '/normas', '/sobre', '/aviso-legal', '/privacidad',
  '/feed.xml', '/robots.txt', '/manifest.webmanifest', '/api/marcadores', '/api/negocios', '/api/estadisticas',
  '/api/salud', '/perfil', '/admin', '/admin/publicaciones', '/admin/negocios', '/admin/denuncias', '/admin/usuarios'];

async function crawl(nombre, client, esperaLogin) {
  const vistos = new Set();
  const cola = [...SEMILLAS];
  const problemas = [];
  let paginas = 0;

  while (cola.length) {
    const ruta = cola.shift();
    if (vistos.has(ruta) || vistos.size > 400) continue;
    vistos.add(ruta);
    let res;
    try {
      res = await client.get(ruta);
    } catch (err) {
      problemas.push({ ruta, estado: 'excepción', detalle: err.message });
      continue;
    }
    paginas += 1;
    const s = res.status;
    if (s >= 500) {
      problemas.push({ ruta, estado: s, detalle: 'error del servidor' });
      continue;
    }
    if (s === 404) {
      problemas.push({ ruta, estado: 404, detalle: 'no encontrado' });
      continue;
    }
    if (s === 302) {
      const destino = res.headers.get('location') || '';
      if (!esperaLogin && destino.includes('/acceder')) {
        problemas.push({ ruta, estado: 302, detalle: `redirige a acceder: ${destino}` });
      }
      continue;
    }
    if (s === 403 || s === 301) continue;
    const tipo = res.headers.get('content-type') || '';
    if (!tipo.includes('text/html')) continue;

    const html = await res.text();
    if (/error-code|Algo ha fallado/.test(html)) problemas.push({ ruta, estado: s, detalle: 'página de error' });
    for (const m of html.matchAll(/href="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
      const enlace = m[1];
      if (enlace.startsWith('/uploads/') || enlace.startsWith('/vendor/') || enlace.startsWith('/css/')
        || enlace.startsWith('/js/') || enlace.startsWith('/img/') || enlace.startsWith('/fonts/')) continue;
      if (!vistos.has(enlace)) cola.push(enlace);
    }
  }
  return { nombre, paginas, problemas };
}

const resultados = [
  await crawl('visitante', makeClient(), true),
  await crawl('vecino', vecino, false),
  await crawl('moderación', admin, false),
];

console.log('\n=== RASTREO DE EXTREMO A EXTREMO ===');
let total = 0;
for (const r of resultados) {
  console.log(`\n[${r.nombre}] ${r.paginas} páginas visitadas, ${r.problemas.length} problema(s)`);
  for (const p of r.problemas) console.log(`   ${p.estado}  ${p.ruta}  — ${p.detalle}`);
  total += r.problemas.length;
}
console.log(`\nTOTAL PROBLEMAS: ${total}\n`);
server.close();
process.exit(total > 0 ? 1 : 0);
