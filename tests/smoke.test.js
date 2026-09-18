import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';

let server;
let base;
let seed;
let seedDb;
let seedUsers;
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function storeCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    jar.set(k.trim(), v);
  }
}
async function get(path, opts = {}) {
  const res = await fetch(base + path, { redirect: 'manual', headers: { Cookie: cookieHeader(), ...(opts.headers || {}) } });
  storeCookies(res);
  return res;
}
async function post(path, body, opts = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
    body: typeof body === 'string' ? body : new URLSearchParams(body).toString(),
  });
  storeCookies(res);
  return res;
}
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  return m ? m[1] : null;
}
/** Sigue la redirección y devuelve el HTML de destino, donde aparece el aviso. */
async function follow(res) {
  return (await get(res.headers.get('location'))).text();
}

before(async () => {
  const app = createApp({ ...config, seedDemo: true, isProduction: false }, { dbFile: ':memory:' });
  seed = app.seed;
  seedDb = app.db;
  seedUsers = app.services.users;
  server = app.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('páginas públicas responden', async () => {
  for (const path of ['/', '/incidencias', '/incidencias?estado=pendientes&orden=apoyos', '/mapa', '/estadisticas', '/informe', '/normas', '/sobre', '/recursos', '/aviso-legal', '/privacidad', '/acceder', '/registro']) {
    const res = await get(path);
    assert.equal(res.status, 200, `GET ${path}`);
    const html = await res.text();
    assert.match(html, /<html lang="es">/);
  }
});

test('contenido de ejemplo visible y API JSON', async () => {
  const res = await get('/incidencias');
  const html = await res.text();
  assert.match(html, /Ejemplo/);
  const api = await get('/api/marcadores');
  assert.equal(api.status, 200);
  const data = await api.json();
  assert.ok(data.count > 0);
  assert.ok(data.markers[0].lat);
  const stats = await (await get('/api/estadisticas')).json();
  assert.ok(stats.overview.total > 0);
  const csv = await get('/informe.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const rss = await get('/feed.xml');
  assert.match(await rss.text(), /<rss/);
});

test('cabeceras de seguridad y redirecciones internas', async () => {
  const res = await get('/');
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'se envía una política de contenidos');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/, 'ningún script en línea permitido');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'self'/, 'los formularios no pueden enviarse fuera');
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(res.headers.get('permissions-policy') || '', /camera=\(\)/);
  assert.equal(res.headers.get('x-powered-by'), null, 'no se anuncia el servidor');

  // La cookie de sesión no es accesible desde JavaScript
  const loginPage = await get('/acceder');
  const token = csrfFrom(await loginPage.text());
  const login = await post('/acceder', { _csrf: token, email: seed.adminCreated.email, contrasena: seed.adminCreated.password });
  const cookie = (login.headers.getSetCookie?.() || []).find((c) => c.startsWith('vereda.sid'));
  assert.ok(cookie, 'se emite la cookie de sesión');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  // Un destino de redirección manipulado no puede sacarnos del foro
  const perfil = await (await get('/perfil')).text();
  const token2 = csrfFrom(perfil);
  const fuera = await post('/salir', { _csrf: token2 });
  assert.equal(fuera.status, 302);
  jar.clear();
  for (const destino of ['https://sitio-malo.example/', '//sitio-malo.example/', '/\\sitio-malo.example']) {
    const page = await (await get(`/acceder?next=${encodeURIComponent(destino)}`)).text();
    const t = csrfFrom(page);
    const res2 = await post('/acceder', { _csrf: t, email: seed.adminCreated.email, contrasena: seed.adminCreated.password, next: destino });
    assert.equal(res2.headers.get('location'), '/', `no debe redirigir a ${destino}`);
    await post('/salir', { _csrf: t });
    jar.clear();
  }
});

test('las contraseñas se guardan con scrypt y las antiguas se renuevan al entrar', async () => {
  const { hashPassword, hashPasswordSync, verifyPassword, needsUpgrade } = await import('../src/utils/passwords.js');
  const bcrypt = (await import('bcryptjs')).default;

  const nuevo = await hashPassword('pan-con-tomate-42');
  assert.match(nuevo, /^scrypt\$16384\$8\$2\$/, 'formato y parámetros esperados');
  assert.equal(await verifyPassword('pan-con-tomate-42', nuevo), true);
  assert.equal(await verifyPassword('pan-con-tomate-43', nuevo), false);
  assert.notEqual(hashPasswordSync('misma'), hashPasswordSync('misma'), 'cada cifrado lleva su propia sal');

  // Formatos corruptos no deben colar ni reventar
  for (const basura of ['', 'basura', 'scrypt$mal', 'scrypt$a$b$c$d$e', null, undefined]) {
    assert.equal(await verifyPassword('x', basura), false, `rechaza ${JSON.stringify(basura)}`);
  }

  // Compatibilidad con las cuentas creadas antes del cambio
  const antiguo = bcrypt.hashSync('clave-de-antes-42', 10);
  assert.equal(needsUpgrade(antiguo), true);
  assert.equal(needsUpgrade(nuevo), false);
  assert.equal(await verifyPassword('clave-de-antes-42', antiguo), true);

  // Al entrar, la cuenta antigua se pasa al formato nuevo sin que el vecino note nada
  jar.clear();
  const email = 'antigua@test.local';
  const usuario = seedUsers.create({ firstName: 'Antigua', lastName: 'Cuenta', phone: '612 22 22 22', email, password: 'da-igual-42' });
  seedDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync('clave-de-antes-42', 10), usuario.id);

  const token = csrfFrom(await (await get('/acceder')).text());
  const acceso = await post('/acceder', { _csrf: token, email, contrasena: 'clave-de-antes-42' });
  assert.equal(acceso.status, 302, 'entra con su contraseña de siempre');
  await new Promise((r) => setTimeout(r, 400));
  const guardado = seedDb.prepare('SELECT password_hash FROM users WHERE id = ?').get(usuario.id).password_hash;
  assert.match(guardado, /^scrypt\$/, 'el cifrado se ha renovado solo');
  jar.clear(); // se deja la sesión limpia para las pruebas siguientes
});

test('404 y protección de rutas', async () => {
  assert.equal((await get('/no-existe')).status, 404);
  assert.equal((await get('/incidencias/no-existe-xyz')).status, 404);
  const nueva = await get('/incidencias/nueva');
  assert.equal(nueva.status, 302);
  assert.match(nueva.headers.get('location'), /\/acceder/);
  assert.equal((await get('/admin')).status, 302);
  const noCsrf = await post('/acceder', { email: 'x@x.com', contrasena: 'y' });
  assert.equal(noCsrf.status, 403);
});

test('inicio de sesión del administrador y flujo completo', async () => {
  assert.ok(seed.adminCreated, 'se crea el primer administrador');
  const loginPage = await (await get('/acceder')).text();
  const token = csrfFrom(loginPage);
  assert.ok(token);
  const bad = await post('/acceder', { _csrf: token, email: seed.adminCreated.email, contrasena: 'incorrecta' });
  assert.equal(bad.status, 401);
  const ok = await post('/acceder', { _csrf: token, email: seed.adminCreated.email, contrasena: seed.adminCreated.password, next: '/perfil' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/perfil');

  const perfil = await get('/perfil');
  assert.equal(perfil.status, 200);
  const perfilHtml = await perfil.text();
  assert.match(perfilHtml, /Mi perfil/);
  const token2 = csrfFrom(perfilHtml);

  // Crear publicación (formulario sin fotos)
  const created = await post('/incidencias', {
    _csrf: token2,
    tipo: 'incidencia',
    titulo: 'Prueba automática de publicación',
    categoria: 'alumbrado',
    cuerpo: 'Texto de prueba suficientemente largo para pasar la validación.',
    ubicacion: 'Calle de prueba, 1',
    lat: '40.32',
    lng: '-3.755',
    organismo: 'Ayuntamiento de Leganés',
    reclamacion_oficial: '1',
    referencia: 'REG-TEST-1',
    fecha_reclamacion: '2026-09-01',
  });
  assert.equal(created.status, 302, 'crear publicación redirige');
  const slug = created.headers.get('location').replace('/incidencias/', '');
  const detail = await get(`/incidencias/${slug}`);
  assert.equal(detail.status, 200);
  const detailHtml = await detail.text();
  assert.match(detailHtml, /Prueba automática de publicación/);
  assert.match(detailHtml, /En trámite/);
  assert.match(detailHtml, /REG-TEST-1/);

  // Validación
  const invalid = await post('/incidencias', { _csrf: token2, tipo: 'incidencia', titulo: 'corto', categoria: 'alumbrado', cuerpo: 'x' });
  assert.equal(invalid.status, 422);

  // Apoyo vía JSON
  const support = await post(`/incidencias/${slug}/apoyar`, '{}', { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token2, 'X-Requested-With': 'fetch', Accept: 'application/json' } });
  assert.equal(support.status, 200);
  const sup = await support.json();
  assert.equal(sup.supported, true);
  assert.equal(sup.count, 1);

  // Comentario
  const comment = await post(`/incidencias/${slug}/comentarios`, { _csrf: token2, cuerpo: 'Comentario de prueba' });
  assert.equal(comment.status, 302);
  assert.match(await (await get(`/incidencias/${slug}`)).text(), /Comentario de prueba/);

  // Cambio de estado
  const status = await post(`/incidencias/${slug}/estado`, { _csrf: token2, estado: 'resuelta', nota: 'Arreglado' });
  assert.equal(status.status, 302);
  assert.match(await (await get(`/incidencias/${slug}`)).text(), /Arreglado/);

  // Panel de administración
  for (const path of ['/admin', '/admin/publicaciones', '/admin/denuncias', '/admin/usuarios']) {
    assert.equal((await get(path)).status, 200, `GET ${path}`);
  }

  // Edición y borrado
  assert.equal((await get(`/incidencias/${slug}/editar`)).status, 200);
  const removed = await post(`/incidencias/${slug}/eliminar`, { _csrf: token2 });
  assert.equal(removed.status, 302);
  assert.equal((await get(`/incidencias/${slug}`)).status, 404);

  // Salir
  const out = await post('/salir', { _csrf: token2 });
  assert.equal(out.status, 302);
  assert.equal((await get('/perfil')).status, 302);
});

test('publicación con foto (multipart) y procesado de imagen', async () => {
  jar.clear();
  const loginPage = await (await get('/acceder')).text();
  const token = csrfFrom(loginPage);
  await post('/acceder', { _csrf: token, email: seed.adminCreated.email, contrasena: seed.adminCreated.password });
  const formPage = await (await get('/incidencias/nueva')).text();
  const token2 = csrfFrom(formPage);

  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 30, g: 120, b: 90 } } }).png().toBuffer();
  const fd = new FormData();
  fd.set('_csrf', token2);
  fd.set('tipo', 'incidencia');
  fd.set('titulo', 'Publicación con fotografía adjunta');
  fd.set('categoria', 'limpieza');
  fd.set('cuerpo', 'Descripción suficientemente larga para pasar la validación del formulario.');
  fd.set('ubicacion', 'Plaza de prueba');
  fd.append('imagenes', new Blob([png], { type: 'image/png' }), 'foto.png');
  const res = await fetch(`${base}/incidencias`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookieHeader() }, body: fd });
  storeCookies(res);
  assert.equal(res.status, 302, 'publicación con foto redirige');
  const slug = res.headers.get('location').replace('/incidencias/', '');
  const html = await (await get(`/incidencias/${slug}`)).text();
  const match = html.match(/\/uploads\/([a-z0-9-]+\.jpg)/);
  assert.ok(match, 'la página muestra la foto procesada');
  const img = await get(`/uploads/${match[1]}`);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/jpeg/);

  // Tipo de fichero no permitido
  const bad = new FormData();
  bad.set('_csrf', token2);
  bad.set('tipo', 'incidencia');
  bad.set('titulo', 'Intento con fichero no válido');
  bad.set('categoria', 'limpieza');
  bad.set('cuerpo', 'Descripción suficientemente larga para pasar la validación del formulario.');
  bad.append('imagenes', new Blob(['hola'], { type: 'text/plain' }), 'nota.txt');
  const badRes = await fetch(`${base}/incidencias`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookieHeader() }, body: bad });
  assert.equal(badRes.status, 422);
  assert.match(await badRes.text(), /JPG, PNG o WebP/);

  // Limpieza: borrar la publicación y comprobar que la foto desaparece del disco
  const del = await post(`/incidencias/${slug}/eliminar`, { _csrf: token2 });
  assert.equal(del.status, 302);
  assert.equal((await get(`/uploads/${match[1]}`)).status, 404);
});

test('el registro exige nombre, apellidos, teléfono, correo y contraseña', async () => {
  jar.clear();
  const token = csrfFrom(await (await get('/registro')).text());
  const validos = {
    _csrf: token,
    nombre: 'Vecina',
    apellidos: 'Test Ejemplo',
    telefono: '612 34 56 78',
    email: 'vecina@test.local',
    contrasena: 'pan-con-tomate-42',
    contrasena2: 'pan-con-tomate-42',
    normas: '1',
  };

  const casos = [
    [{ nombre: '' }, /Escribe tu nombre/],
    [{ nombre: 'A' }, /Escribe tu nombre/],
    [{ apellidos: '' }, /Escribe tus apellidos/],
    [{ telefono: '' }, /Escribe tu número de teléfono/],
    [{ telefono: '12345' }, /teléfono no es válido/],
    [{ email: 'no-es-un-correo' }, /correo electrónico no es válido/],
    [{ contrasena: 'corta', contrasena2: 'corta' }, /al menos 8 caracteres/],
    [{ contrasena: 'contrasena123', contrasena2: 'contrasena123' }, /de las más usadas/],
    [{ contrasena: '1029384756', contrasena2: '1029384756' }, /solo números/],
    [{ contrasena: 'vecina-lo-que-sea', contrasena2: 'vecina-lo-que-sea' }, /no puede contener tu nombre/],
    [{ contrasena2: 'otra-distinta' }, /no coinciden/],
    [{ normas: '' }, /aceptar las normas/],
  ];
  for (const [cambio, mensaje] of casos) {
    const res = await post('/registro', { ...validos, ...cambio });
    assert.equal(res.status, 422, `debería rechazar ${JSON.stringify(cambio)}`);
    assert.match(await res.text(), mensaje);
  }

  const res = await post('/registro', validos);
  assert.equal(res.status, 302);

  // El teléfono se guarda normalizado y no es público; el nombre visible se abrevia
  const home = await (await get('/')).text();
  assert.match(home, /Vecina T\./, 'aparece como nombre e inicial del apellido');
  assert.doesNotMatch(home, /Test Ejemplo/, 'el apellido completo no se muestra');
  assert.doesNotMatch(home, /612 34 56 78/, 'el teléfono no se muestra');
  assert.equal((await get('/admin')).status, 403);

  // Un correo repetido no crea una segunda cuenta
  jar.clear();
  const token2 = csrfFrom(await (await get('/registro')).text());
  const repe = await post('/registro', { ...validos, _csrf: token2, telefono: '699 99 99 99' });
  assert.equal(repe.status, 422);
  assert.match(await repe.text(), /Ya existe una cuenta con ese correo/);
});

test('el vecino corrige sus datos desde el perfil', async () => {
  jar.clear();
  const token = csrfFrom(await (await get('/acceder')).text());
  await post('/acceder', { _csrf: token, email: 'vecina@test.local', contrasena: 'pan-con-tomate-42' });
  const perfil = await (await get('/perfil')).text();
  assert.match(perfil, /Test Ejemplo/, 'en su perfil sí ve sus apellidos');
  assert.match(perfil, /612 34 56 78/, 'y su teléfono');

  const token2 = csrfFrom(perfil);
  const mal = await post('/perfil/datos', { _csrf: token2, nombre: 'Vecina', apellidos: 'Nueva', telefono: '111' });
  assert.match(await follow(mal), /teléfono no es válido/);

  const bien = await post('/perfil/datos', { _csrf: token2, nombre: 'Vecina', apellidos: 'Nueva Aparecida', telefono: '+34 699 99 99 99' });
  const tras = await follow(bien);
  assert.match(tras, /apareces como «Vecina N\.»/);
  assert.match(tras, /699 99 99 99/, 'el teléfono internacional se normaliza');
});
