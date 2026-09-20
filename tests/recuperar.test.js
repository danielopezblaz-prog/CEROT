import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';

/* Recuperar la contraseña desde el correo. El proveedor de envío está imitado
   aquí: ninguna prueba manda un correo de verdad. */
const buzon = [];
let proveedor;
let server;
let base;
let app;
const CLAVE = 'pan-con-tomate-42';
const CORREO = 'marta@test.local';

function cliente() {
  const jar = new Map();
  const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const guardar = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [par] = c.split(';');
      const [k, v] = par.split('=');
      jar.set(k.trim(), v);
    }
  };
  return {
    async get(ruta) {
      const res = await fetch(base + ruta, { redirect: 'manual', headers: { Cookie: cookie() } });
      guardar(res);
      return res;
    },
    async post(ruta, cuerpo) {
      const res = await fetch(base + ruta, {
        method: 'POST',
        redirect: 'manual',
        headers: { Cookie: cookie(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(cuerpo).toString(),
      });
      guardar(res);
      return res;
    },
  };
}
const csrf = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

/** Pide un enlace para ese correo y devuelve el token que ha llegado al buzón. */
async function pedirEnlace(email) {
  const antes = buzon.length;
  const c = cliente();
  const res = await c.post('/recuperar', { _csrf: csrf(await (await c.get('/recuperar')).text()), email });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /ya va camino de tu buzón/);
  if (buzon.length === antes) return null;
  return buzon[buzon.length - 1].texto.match(/\/recuperar\/([\w-]+)/)[1];
}

before(async () => {
  proveedor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      const datos = JSON.parse(cuerpo);
      buzon.push({
        clave: req.headers['api-key'],
        para: datos.to[0].email,
        asunto: datos.subject,
        texto: datos.textContent,
        html: datos.htmlContent,
      });
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"messageId":"prueba"}');
    });
  });
  proveedor.listen(0, '127.0.0.1');
  await new Promise((r) => proveedor.once('listening', r));

  app = createApp(
    {
      ...config,
      seedDemo: false,
      isProduction: false,
      correo: { proveedor: 'brevo', clave: 'clave-de-prueba', remitente: 'foro@test.local', nombre: 'Foro de prueba', url: `http://127.0.0.1:${proveedor.address().port}/v3/smtp/email` },
    },
    { dbFile: ':memory:' }
  );
  app.services.users.create({ firstName: 'Marta', lastName: 'Ruiz', phone: '612345678', email: CORREO, password: CLAVE });
  server = app.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  proveedor?.close();
});

test('el vecino pide el enlace, elige otra contraseña y entra con ella', async () => {
  const token = await pedirEnlace(CORREO);
  assert.ok(token, 'ha llegado un correo con el enlace');

  const correo = buzon[buzon.length - 1];
  assert.equal(correo.para, CORREO);
  assert.equal(correo.clave, 'clave-de-prueba', 'se identifica ante el proveedor');
  assert.match(correo.asunto, /contraseña/i);
  assert.match(correo.texto, /Hola, Marta/);
  assert.match(correo.texto, /caduca en 60 minutos/);
  assert.match(correo.html, new RegExp(`href="${config.baseUrl}/recuperar/${token}"`));

  // La pantalla del enlace no delata el enlace en las etiquetas de la página.
  const c = cliente();
  const pagina = await (await c.get(`/recuperar/${token}`)).text();
  assert.match(pagina, /Elige una contraseña nueva/);
  assert.match(pagina, /<meta name="robots" content="noindex, follow">/);
  assert.match(pagina, new RegExp(`<link rel="canonical" href="${config.baseUrl}/recuperar">`));
  assert.ok(!pagina.includes(`content="${config.baseUrl}/recuperar/${token}"`), 'el enlace no sale en og:url');

  const nueva = 'bicicleta-verde-91';
  const guardado = await c.post(`/recuperar/${token}`, { _csrf: csrf(pagina), contrasena: nueva, contrasena2: nueva });
  assert.equal(guardado.status, 302);
  assert.equal(guardado.headers.get('location'), '/');
  assert.equal((await c.get('/perfil')).status, 200, 'queda dentro sin volver a escribir nada');

  assert.equal(await app.services.users.verify(CORREO, CLAVE), null, 'la contraseña vieja ya no vale');
  assert.ok(await app.services.users.verify(CORREO, nueva), 'la nueva sí');
});

test('un enlace solo sirve una vez', async () => {
  const token = await pedirEnlace(CORREO);
  const c = cliente();
  const html = await (await c.get(`/recuperar/${token}`)).text();
  const clave = 'ventana-abierta-77';
  assert.equal((await c.post(`/recuperar/${token}`, { _csrf: csrf(html), contrasena: clave, contrasena2: clave })).status, 302);

  const otro = cliente();
  const repetido = await otro.get(`/recuperar/${token}`);
  assert.equal(repetido.status, 410);
  assert.match(await repetido.text(), /Este enlace ya no sirve/);
});

test('un enlace caducado no sirve, y los anteriores se anulan al usar uno', async () => {
  const viejo = await pedirEnlace(CORREO);
  const nuevo = await pedirEnlace(CORREO);
  assert.notEqual(viejo, nuevo);

  // Se envejece el más nuevo más de una hora.
  app.db.prepare("UPDATE password_resets SET expires_at = datetime('now', '-1 minute') WHERE used_at IS NULL AND id = (SELECT MAX(id) FROM password_resets)").run();
  assert.equal((await cliente().get(`/recuperar/${nuevo}`)).status, 410, 'el caducado no vale');

  // El viejo sigue valiendo, y al gastarlo desaparecen los demás.
  const c = cliente();
  const html = await (await c.get(`/recuperar/${viejo}`)).text();
  const clave = 'naranja-lunes-33';
  assert.equal((await c.post(`/recuperar/${viejo}`, { _csrf: csrf(html), contrasena: clave, contrasena2: clave })).status, 302);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM password_resets WHERE used_at IS NULL').get().c, 0);
});

test('un correo que no existe recibe la misma respuesta y no se manda nada', async () => {
  const antes = buzon.length;
  assert.equal(await pedirEnlace('no.existe@test.local'), null);
  assert.equal(buzon.length, antes, 'no se ha enviado ningún correo');

  // Un correo mal escrito sí se avisa: ahí no hay nada que delatar.
  const c = cliente();
  const mal = await c.post('/recuperar', { _csrf: csrf(await (await c.get('/recuperar')).text()), email: 'esto-no-es-un-correo' });
  assert.equal(mal.status, 422);
  assert.match(await mal.text(), /no es válido/);
});

test('la contraseña nueva pasa las mismas comprobaciones y cierra las demás sesiones', async () => {
  // Marta entra desde el móvil y deja la sesión abierta.
  const movil = cliente();
  const actual = 'naranja-lunes-33';
  await movil.post('/acceder', { _csrf: csrf(await (await movil.get('/acceder')).text()), email: CORREO, contrasena: actual });
  assert.equal((await movil.get('/perfil')).status, 200);

  const token = await pedirEnlace(CORREO);
  const c = cliente();
  const html = await (await c.get(`/recuperar/${token}`)).text();
  const token2 = csrf(html);

  for (const [clave, clave2, aviso] of [
    ['corta', 'corta', /al menos 8 caracteres/],
    ['4071829365', '4071829365', /solo números/],
    ['marta-la-vecina', 'marta-la-vecina', /no puede contener tu nombre/],
    ['pera-limonera-8', 'otra-distinta-9', /no coinciden/],
  ]) {
    const res = await c.post(`/recuperar/${token}`, { _csrf: token2, contrasena: clave, contrasena2: clave2 });
    assert.equal(res.status, 422, `debería rechazar ${clave}`);
    assert.match(await res.text(), aviso);
  }

  const buena = 'melocoton-en-almibar';
  assert.equal((await c.post(`/recuperar/${token}`, { _csrf: token2, contrasena: buena, contrasena2: buena })).status, 302);
  const enElMovil = await movil.get('/perfil');
  assert.equal(enElMovil.status, 302, 'la sesión del móvil se ha cerrado');
  assert.match(enElMovil.headers.get('location'), /\/acceder/);
});

test('sin proveedor de correo el foro lo dice y no ofrece la opción', async () => {
  const sinCorreo = createApp({ ...config, seedDemo: false, isProduction: false, correo: { proveedor: '', clave: '', remitente: '', nombre: '', url: '' } }, { dbFile: ':memory:' });
  const suServer = sinCorreo.app.listen(0);
  await new Promise((r) => suServer.once('listening', r));
  const suBase = `http://127.0.0.1:${suServer.address().port}`;
  try {
    const acceder = await (await fetch(`${suBase}/acceder`)).text();
    assert.doesNotMatch(acceder, /href="\/recuperar"/, 'no se ofrece el enlace');
    assert.match(acceder, /Pide a la administración del foro/);
    const recuperar = await fetch(`${suBase}/recuperar`);
    assert.equal(recuperar.status, 200);
    assert.match(await recuperar.text(), /no se pueden enviar correos/);
  } finally {
    suServer.close();
  }
});
