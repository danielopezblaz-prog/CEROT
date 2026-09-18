import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { composeMessage } from '../src/services/facebook.js';

/* Servidor que imita la API de Meta. Ninguna prueba toca Facebook de verdad. */
const graph = { calls: [], failWith: null };
let graphServer;
let server;
let base;
let seed;
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
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
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  return m ? m[1] : null;
}
/** Sigue la redirección y devuelve el HTML de destino, donde se ve el aviso. */
async function follow(res) {
  return (await get(res.headers.get('location'))).text();
}

before(async () => {
  graphServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const params = new URLSearchParams(req.method === 'POST' ? body : req.url.split('?')[1] || '');
      graph.calls.push({ method: req.method, path: req.url.split('?')[0], params: Object.fromEntries(params) });
      res.setHeader('Content-Type', 'application/json');
      if (graph.failWith) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: graph.failWith }));
      }
      if (req.method === 'DELETE') return res.end(JSON.stringify({ success: true }));
      return res.end(JSON.stringify({ id: '123456_7890' }));
    });
  });
  await new Promise((r) => graphServer.listen(0, '127.0.0.1', r));
  const graphPort = graphServer.address().port;

  const testConfig = {
    ...config,
    seedDemo: true,
    facebook: {
      pageId: '123456',
      token: 'token-de-prueba',
      apiVersion: 'v25.0',
      apiBase: `http://127.0.0.1:${graphPort}`,
      enabled: true,
    },
  };
  const app = createApp(testConfig, { dbFile: ':memory:' });
  seed = app.seed;
  server = app.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Sesión de administración
  const token = csrfFrom(await (await get('/acceder')).text());
  await post('/acceder', { _csrf: token, email: seed.adminCreated.email, contrasena: seed.adminCreated.password });
});

after(() => {
  server?.close();
  graphServer?.close();
});

test('el texto que se envía a Facebook lleva lo importante', () => {
  const post_ = {
    title: 'Farolas fundidas en la calle de Cáceres',
    body: 'Llevan tres semanas apagadas y la acera queda a oscuras por la noche.',
    status: 'abierta',
    type: 'incidencia',
    category_name: 'Alumbrado',
    location_text: 'Calle de Cáceres, 10-24',
    support_count: 14,
    official_reference: 'REG-2026-001',
  };
  const msg = composeMessage(post_, 'https://foro.example/incidencias/x', { name: 'Vereda de los Estudiantes', municipality: 'Leganés' });
  assert.match(msg, /INCIDENCIA · ABIERTA · Alumbrado/);
  assert.match(msg, /Farolas fundidas en la calle de Cáceres/);
  assert.match(msg, /Calle de Cáceres, 10-24/);
  assert.match(msg, /14 vecinos la apoyan/);
  assert.match(msg, /REG-2026-001/);
  assert.match(msg, /https:\/\/foro\.example\/incidencias\/x/);
  assert.match(msg, /#VeredaDeLosEstudiantes #Leganes/);
  assert.doesNotMatch(msg, /\n{3,}/, 'sin huecos de más');
});

test('compartir una publicación en Facebook y retirarla', async () => {
  graph.calls.length = 0;
  const listHtml = await (await get('/admin/publicaciones')).text();
  const token = csrfFrom(listHtml);
  assert.match(listHtml, /Compartir en la página de Facebook/, 'aparece el botón');

  const id = Number(listHtml.match(/\/admin\/publicaciones\/(\d+)\/facebook"/)[1]);

  const shared = await post(`/admin/publicaciones/${id}/facebook`, { _csrf: token, volver: '/admin/publicaciones' });
  assert.equal(shared.status, 302);
  assert.match(await follow(shared), /Publicado en la página de Facebook/);

  // Se ha llamado a la API con el mensaje y el enlace
  assert.equal(graph.calls.length, 1);
  const call = graph.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/v25.0/123456/feed');
  assert.equal(call.params.access_token, 'token-de-prueba');
  assert.match(call.params.link, /\/incidencias\//);
  assert.ok(call.params.message.length > 40);

  // Queda registrado y el panel ofrece verla o retirarla
  const after1 = await (await get('/admin/publicaciones')).text();
  assert.match(after1, /https:\/\/www\.facebook\.com\/123456_7890/);

  // No se comparte dos veces
  const again = await post(`/admin/publicaciones/${id}/facebook`, { _csrf: token, volver: '/admin/publicaciones' });
  assert.match(await follow(again), /ya se compartió en Facebook/);
  assert.equal(graph.calls.length, 1, 'no se vuelve a llamar a la API');

  // Retirar de Facebook
  const removed = await post(`/admin/publicaciones/${id}/facebook/eliminar`, { _csrf: token, volver: '/admin/publicaciones' });
  assert.match(await follow(removed), /Retirada de Facebook/);
  assert.equal(graph.calls.length, 2);
  assert.equal(graph.calls[1].method, 'DELETE');
  assert.equal(graph.calls[1].path, '/v25.0/123456_7890');
  assert.doesNotMatch(await (await get('/admin/publicaciones')).text(), /123456_7890/);
});

test('un error de Facebook no rompe nada y se explica en castellano', async () => {
  graph.calls.length = 0;
  graph.failWith = { message: 'Error validating access token', code: 190, type: 'OAuthException' };
  const listHtml = await (await get('/admin/publicaciones')).text();
  const token = csrfFrom(listHtml);
  const id = Number(listHtml.match(/\/admin\/publicaciones\/(\d+)\/facebook"/)[1]);

  const res = await post(`/admin/publicaciones/${id}/facebook`, { _csrf: token, volver: '/admin/publicaciones' });
  assert.equal(res.status, 302, 'redirige igualmente, sin error 500');
  const html = await follow(res);
  assert.match(html, /token de Facebook ha caducado/);
  assert.doesNotMatch(html, /facebook\.com\/123456_7890/, 'no se registra nada');
  graph.failWith = null;
});

test('no se puede compartir una publicación oculta', async () => {
  const listHtml = await (await get('/admin/publicaciones')).text();
  const token = csrfFrom(listHtml);
  const id = Number(listHtml.match(/\/admin\/publicaciones\/(\d+)\/facebook"/)[1]);
  await post(`/admin/publicaciones/${id}/ocultar`, { _csrf: token, volver: '/admin/publicaciones' });

  graph.calls.length = 0;
  const res = await post(`/admin/publicaciones/${id}/facebook`, { _csrf: token, volver: '/admin/publicaciones' });
  assert.match(await follow(res), /No se puede compartir una publicación oculta/);
  assert.equal(graph.calls.length, 0);
  await post(`/admin/publicaciones/${id}/mostrar`, { _csrf: token, volver: '/admin/publicaciones' });
});

test('un vecino corriente no puede compartir', async () => {
  const token = csrfFrom(await (await get('/admin/publicaciones')).text());
  const id = Number((await (await get('/admin/publicaciones')).text()).match(/\/admin\/publicaciones\/(\d+)\/facebook"/)[1]);
  await post('/salir', { _csrf: token });
  jar.clear();

  const regToken = csrfFrom(await (await get('/registro')).text());
  await post('/registro', {
    _csrf: regToken,
    nombre: 'Vecino',
    apellidos: 'Efebé',
    telefono: '612 34 56 78',
    email: 'vecino.fb@test.local',
    contrasena: 'pan-con-tomate-42',
    contrasena2: 'pan-con-tomate-42',
    normas: '1',
  });

  graph.calls.length = 0;
  const vecinoToken = csrfFrom(await (await get('/')).text());
  const res = await post(`/admin/publicaciones/${id}/facebook`, { _csrf: vecinoToken, volver: '/' });
  assert.equal(res.status, 403);
  assert.equal(graph.calls.length, 0);
});
