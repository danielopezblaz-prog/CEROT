import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { openState, parseHours, hoursFromForm, groupedHours } from '../src/utils/hours.js';

let server;
let base;
let seed;
const jar = new Map();

const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    jar.set(k.trim(), v);
  }
}
async function get(path) {
  const res = await fetch(base + path, { redirect: 'manual', headers: { Cookie: cookieHeader() } });
  storeCookies(res);
  return res;
}
async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  storeCookies(res);
  return res;
}
const csrfFrom = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
const follow = async (res) => (await get(res.headers.get('location'))).text();

async function loginAs(email, password) {
  jar.clear();
  const token = csrfFrom(await (await get('/acceder')).text());
  return post('/acceder', { _csrf: token, email, contrasena: password });
}
async function registerNeighbour(name, email) {
  jar.clear();
  const token = csrfFrom(await (await get('/registro')).text());
  const [nombre, ...resto] = name.split(' ');
  return post('/registro', {
    _csrf: token,
    nombre,
    apellidos: resto.join(' ') || 'Vecinal',
    telefono: '612 34 56 78',
    email,
    contrasena: 'pan-con-tomate-42',
    contrasena2: 'pan-con-tomate-42',
    normas: '1',
  });
}

/** Datos mínimos válidos de un local. */
function businessForm(token, over = {}) {
  return {
    _csrf: token,
    nombre: 'Ferretería La Tuerca',
    categoria: 'ferreteria',
    resumen: 'Todo para el hogar y el bricolaje, con copia de llaves al momento.',
    descripcion: 'Ferretería de barrio de toda la vida.',
    direccion: 'Calle de Oviedo, 3',
    lat: '40.3209',
    lng: '-3.7563',
    telefono: '916 12 34 56',
    web: 'www.latuerca.example',
    instagram: '@latuerca',
    cerrado_0: '', desde1_0: '09:00', hasta1_0: '14:00', desde2_0: '17:00', hasta2_0: '20:00',
    cerrado_6: '1',
    ...over,
  };
}

before(async () => {
  const app = createApp({ ...config, seedDemo: true }, { dbFile: ':memory:' });
  seed = app.seed;
  server = app.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test('el horario sabe si el local está abierto ahora', () => {
  const cerrado = () => ({ closed: true, ranges: [] });
  const hours = [cerrado(), { closed: false, ranges: [['09:00', '14:00'], ['17:00', '20:00']] }, cerrado(), cerrado(), cerrado(), cerrado(), cerrado()];
  // Martes 8 de septiembre de 2026. En septiembre Madrid va dos horas por delante de UTC.
  const martes10h = new Date('2026-09-08T08:00:00Z');
  const martes15h = new Date('2026-09-08T13:00:00Z');
  const lunes12h = new Date('2026-09-07T10:00:00Z');

  const abierto = openState(hours, martes10h);
  assert.equal(abierto.open, true);
  assert.equal(abierto.label, 'Abierto ahora');
  assert.match(abierto.detail, /Cierra a las 14:00/);

  const siesta = openState(hours, martes15h);
  assert.equal(siesta.open, false);
  assert.match(siesta.detail, /Abre hoy a las 17:00/);

  const lunes = openState(hours, lunes12h);
  assert.equal(lunes.open, false);
  assert.match(lunes.detail, /Abre mañana a las 09:00/);

  assert.equal(openState(parseHours('[]')).known, false, 'sin horario no se muestra etiqueta');
});

test('el formulario de horarios descarta tramos incoherentes', () => {
  const hours = hoursFromForm({
    desde1_0: '09:00', hasta1_0: '14:00',
    desde1_1: '20:00', hasta1_1: '09:00', // fin anterior al inicio: se descarta
    cerrado_2: '1', desde1_2: '09:00', hasta1_2: '14:00', // marcado cerrado: manda el checkbox
    desde1_3: '25:00', hasta1_3: '99:99', // horas imposibles
  });
  assert.deepEqual(hours[0].ranges, [['09:00', '14:00']]);
  assert.equal(hours[1].closed, true);
  assert.equal(hours[2].closed, true);
  assert.equal(hours[3].closed, true);
  const rows = groupedHours(hours);
  assert.ok(rows.length >= 2, 'se agrupan días con el mismo horario');
});

test('directorio y ofertas responden con el contenido de ejemplo', async () => {
  for (const path of ['/negocios', '/negocios/ofertas', '/negocios/ofertas?tipo=evento', '/negocios?categoria=panaderia']) {
    const res = await get(path);
    assert.equal(res.status, 200, `GET ${path}`);
  }
  const directorio = await (await get('/negocios')).text();
  assert.match(directorio, /Panadería La Espiga/);
  assert.match(directorio, /Abierto ahora|Cerrado/, 'se muestra el estado de apertura');

  const ofertas = await (await get('/negocios/ofertas')).text();
  assert.match(ofertas, /Menú del día/);

  const api = await get('/api/negocios');
  assert.equal(api.status, 200);
  const data = await api.json();
  assert.ok(data.count > 0);
  assert.ok(data.markers[0].lat && data.markers[0].categoryName);
});

test('las direcciones antiguas de «locales» redirigen a «negocios»', async () => {
  const casos = [
    ['/locales', '/negocios'],
    ['/ofertas', '/negocios/ofertas'],
    ['/locales/nuevo', '/negocios/nuevo'],
    ['/locales/un-comercio-cualquiera', '/negocios/un-comercio-cualquiera'],
  ];
  for (const [viejo, nuevo] of casos) {
    const res = await get(viejo);
    assert.equal(res.status, 301, `GET ${viejo}`);
    assert.equal(res.headers.get('location'), nuevo);
  }
});

test('un vecino da de alta un local y queda pendiente de aprobación', async () => {
  assert.equal((await get('/negocios/nuevo')).status, 302, 'sin sesión pide acceder');

  await registerNeighbour('Dueña de negocio', 'local@test.local');
  const token = csrfFrom(await (await get('/negocios/nuevo')).text());

  const invalid = await post('/negocios', businessForm(token, { nombre: 'X', resumen: 'corto' }));
  assert.equal(invalid.status, 422);
  const invalidHtml = await invalid.text();
  assert.match(invalidHtml, /Escribe el nombre del negocio/);
  assert.match(invalidHtml, /al menos 10 caracteres/);

  const created = await post('/negocios', businessForm(token));
  assert.equal(created.status, 302);
  const slug = created.headers.get('location').replace('/negocios/', '');

  const ficha = await (await get(`/negocios/${slug}`)).text();
  assert.match(ficha, /Ferretería La Tuerca/);
  assert.match(ficha, /Pendiente de revisión/);
  assert.match(ficha, /09:00 a 14:00 y 17:00 a 20:00/, 'el horario se guarda con sus dos tramos');
  assert.match(ficha, /latuerca/, 'el usuario de Instagram se limpia y se enlaza');

  // Pendiente: no aparece en el directorio público
  jar.clear();
  assert.doesNotMatch(await (await get('/negocios')).text(), /La Tuerca/);
  assert.equal((await get(`/negocios/${slug}`)).status, 404);
});

test('la moderación aprueba el local y entonces se ve', async () => {
  await loginAs(seed.adminCreated.email, seed.adminCreated.password);
  const adminHtml = await (await get('/admin/negocios?estado=pendiente')).text();
  assert.match(adminHtml, /Ferretería La Tuerca/);
  const token = csrfFrom(adminHtml);
  const id = Number(adminHtml.match(/\/admin\/negocios\/(\d+)\/aprobar/)[1]);

  const approved = await post(`/admin/negocios/${id}/aprobar`, { _csrf: token, volver: '/admin/negocios' });
  assert.equal(approved.status, 302);
  assert.match(await follow(approved), /ya está publicado/);

  jar.clear();
  assert.match(await (await get('/negocios')).text(), /La Tuerca/);
});

test('quien gestiona el local publica una oferta y aparece en la portada de ofertas', async () => {
  await loginAs('local@test.local', 'pan-con-tomate-42');
  const dir = await (await get('/negocios')).text();
  const slug = dir.match(/href="\/negocios\/(ferreteria-la-tuerca[a-z0-9-]*)"/)[1];

  const formHtml = await (await get(`/negocios/${slug}/publicaciones/nueva`)).text();
  const token = csrfFrom(formHtml);

  const bad = await post(`/negocios/${slug}/publicaciones`, { _csrf: token, tipo: 'evento', titulo: 'Taller de bricolaje' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /Un evento necesita una fecha/);

  const ok = await post(`/negocios/${slug}/publicaciones`, {
    _csrf: token,
    tipo: 'oferta',
    titulo: 'Copia de llaves a 3 € toda la semana',
    cuerpo: 'Llaves de casa y del portal. Al momento y sin cita.',
    precio: '3 €',
    hasta: '2099-12-31',
  });
  assert.equal(ok.status, 302);

  const ficha = await (await get(`/negocios/${slug}`)).text();
  assert.match(ficha, /Copia de llaves a 3 €/);

  jar.clear();
  const ofertas = await (await get('/negocios/ofertas')).text();
  assert.match(ofertas, /Copia de llaves a 3 €/);
  assert.match(ofertas, /Ferretería La Tuerca/);
});

test('nadie puede tocar el local de otra persona', async () => {
  await registerNeighbour('Vecino Curioso', 'curioso@test.local');
  const dir = await (await get('/negocios')).text();
  const slug = dir.match(/href="\/negocios\/(ferreteria-la-tuerca[a-z0-9-]*)"/)[1];

  assert.equal((await get(`/negocios/${slug}/editar`)).status, 403);
  assert.equal((await get(`/negocios/${slug}/publicaciones/nueva`)).status, 403);

  const token = csrfFrom(await (await get('/')).text());
  assert.equal((await post(`/negocios/${slug}/eliminar`, { _csrf: token })).status, 403);
  assert.equal((await get('/admin/negocios')).status, 403);
});

test('la moderación suspende un local y desaparece del directorio', async () => {
  await loginAs(seed.adminCreated.email, seed.adminCreated.password);
  const adminHtml = await (await get('/admin/negocios')).text();
  const token = csrfFrom(adminHtml);
  const filaTuerca = adminHtml.split('<tr').find((r) => r.includes('La Tuerca'));
  assert.ok(filaTuerca, 'La Tuerca aparece en el panel');
  const id = Number(filaTuerca.match(/\/admin\/negocios\/(\d+)\/suspender/)[1]);

  const res = await post(`/admin/negocios/${id}/suspender`, { _csrf: token, nota: 'Datos sin confirmar.', volver: '/admin/negocios' });
  assert.equal(res.status, 302);

  jar.clear();
  const dir = await (await get('/negocios')).text();
  assert.doesNotMatch(dir, /La Tuerca/, 'el suspendido desaparece del directorio');
  assert.ok((dir.match(/class="biz-card/g) || []).length >= 1, 'los demás negocios siguen visibles');

  // Se vuelve a publicar, para que las pruebas siguientes trabajen con él
  await loginAs(seed.adminCreated.email, seed.adminCreated.password);
  const adminHtml2 = await (await get('/admin/negocios')).text();
  await post(`/admin/negocios/${id}/aprobar`, { _csrf: csrfFrom(adminHtml2), volver: '/admin/negocios' });
  jar.clear();
  assert.match(await (await get('/negocios')).text(), /La Tuerca/);
});

/* ---------- Catálogo de productos ---------- */

/** Imagen JPEG mínima generada al vuelo, para no depender de ficheros de prueba. */
async function fotoFalsa(color = { r: 200, g: 120, b: 60 }) {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 600, height: 600, channels: 3, background: color } }).jpeg().toBuffer();
}

test('un negocio sube varias fotos de golpe y luego las nombra', async () => {
  await loginAs('local@test.local', 'pan-con-tomate-42');
  const dir = await (await get('/negocios')).text();
  const slug = dir.match(/href="\/negocios\/(ferreteria-la-tuerca[a-z0-9-]*)"/)[1];

  const page = await get(`/negocios/${slug}/productos`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Todavía no hay fotos de productos/);
  const token = csrfFrom(html);

  // Subida múltiple: tres fotos, tres productos sin nombre
  const fd = new FormData();
  fd.set('_csrf', token);
  for (let i = 0; i < 3; i += 1) {
    fd.append('fotos', new Blob([await fotoFalsa({ r: 60 + i * 40, g: 120, b: 90 })], { type: 'image/jpeg' }), `p${i}.jpg`);
  }
  const bulk = await fetch(`${base}/negocios/${slug}/productos/varias`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookieHeader() }, body: fd });
  storeCookies(bulk);
  assert.equal(bulk.status, 302);
  const tras = await follow(bulk);
  assert.match(tras, /3 fotos añadidas/);
  assert.match(tras, /3 <\/strong>|<strong>3<\/strong>/, 'avisa de las fotos sin nombre');

  // Las fotos se han procesado y se sirven
  const fotos = [...tras.matchAll(/\/uploads\/([a-z0-9_-]+\.jpg)/g)].map((m) => m[1]);
  assert.ok(fotos.length >= 3, `se esperaban 3 fotos y hay ${fotos.length}`);
  const img = await get(`/uploads/${fotos[0]}`);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/jpeg/);

  // Guardado en bloque de nombres, precios y estados
  const ids = [...tras.matchAll(/name="id" value="(\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 3);
  const save = new URLSearchParams();
  save.append('_csrf', csrfFrom(tras));
  ids.forEach((id, i) => {
    save.append('id', id);
    save.append('nombre', `Producto ${i + 1}`);
    save.append('precio', `${i + 2},50 €`);
    save.append('descripcion', '');
  });
  save.append('disponible', ids[0]);
  save.append('disponible', ids[1]);
  save.append('destacado', ids[1]);
  const saved = await fetch(`${base}/negocios/${slug}/productos/guardar`, {
    method: 'POST', redirect: 'manual',
    headers: { Cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: save.toString(),
  });
  storeCookies(saved);
  assert.equal(saved.status, 302);
  const guardado = await follow(saved);
  assert.match(guardado, /Catálogo actualizado/);
  assert.doesNotMatch(guardado, /fotos sin nombre/);

  // En la ficha pública: el destacado va primero y el no disponible no aparece
  const ficha = await (await get(`/negocios/${slug}`)).text();
  const publica = ficha.slice(ficha.indexOf('id="productos"'));
  assert.ok(publica.indexOf('Producto 2') < publica.indexOf('Producto 1'), 'el destacado se muestra primero');
  jar.clear();
  const anonima = await (await get(`/negocios/${slug}`)).text();
  assert.match(anonima, /Producto 1/);
  assert.doesNotMatch(anonima, /Producto 3/, 'el marcado como no disponible se oculta a los vecinos');
});

test('alta de un producto suelto y borrado, con su foto', async () => {
  await loginAs('local@test.local', 'pan-con-tomate-42');
  const dir = await (await get('/negocios')).text();
  const slug = dir.match(/href="\/negocios\/(ferreteria-la-tuerca[a-z0-9-]*)"/)[1];
  const token = csrfFrom(await (await get(`/negocios/${slug}/productos`)).text());

  const sinNombre = new FormData();
  sinNombre.set('_csrf', token);
  sinNombre.set('nombre', 'X');
  const malo = await fetch(`${base}/negocios/${slug}/productos`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookieHeader() }, body: sinNombre });
  storeCookies(malo);
  assert.equal(malo.status, 422);
  assert.match(await malo.text(), /Escribe el nombre del producto/);

  const fd = new FormData();
  fd.set('_csrf', token);
  fd.set('nombre', 'Juego de destornilladores');
  fd.set('precio', '14,90 €');
  fd.set('descripcion', 'Seis piezas con punta imantada.');
  fd.append('foto', new Blob([await fotoFalsa()], { type: 'image/jpeg' }), 'destornilladores.jpg');
  const ok = await fetch(`${base}/negocios/${slug}/productos`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookieHeader() }, body: fd });
  storeCookies(ok);
  assert.equal(ok.status, 302);
  const lista = await follow(ok);
  assert.match(lista, /Juego de destornilladores/);
  assert.match(lista, /14,90 €/);

  const fichaHtml = await (await get(`/negocios/${slug}`)).text();
  assert.match(fichaHtml, /Seis piezas con punta imantada/);

  // Borrado: desaparece del catálogo y su foto del disco
  // Ojo: el separador lleva espacio, para no partir por product-row-fields y demás
  const fila = lista.split('<div class="product-row ').find((f) => f.includes('value="Juego de destornilladores"'));
  assert.ok(fila, 'la fila del producto aparece en el catálogo');
  const foto = fila.match(/\/uploads\/([a-z0-9_-]+\.jpg)/)[1];
  const id = Number(fila.match(/productos\/(\d+)\/eliminar/)[1]);
  const del = await post(`/negocios/${slug}/productos/${id}/eliminar`, { _csrf: token });
  assert.equal(del.status, 302);
  assert.doesNotMatch(await (await get(`/negocios/${slug}/productos`)).text(), /Juego de destornilladores/);
  assert.equal((await get(`/uploads/${foto}`)).status, 404, 'la foto se borra del disco');
});

test('el catálogo solo lo toca quien gestiona el negocio', async () => {
  await registerNeighbour('Curiosa Dos', 'curiosa2@test.local');
  const dir = await (await get('/negocios')).text();
  const slug = dir.match(/href="\/negocios\/(ferreteria-la-tuerca[a-z0-9-]*)"/)[1];
  const token = csrfFrom(await (await get('/')).text());

  assert.equal((await get(`/negocios/${slug}/productos`)).status, 403);
  assert.equal((await post(`/negocios/${slug}/productos/guardar`, { _csrf: token })).status, 403);
  assert.equal((await post(`/negocios/${slug}/productos/1/eliminar`, { _csrf: token })).status, 403);
});
