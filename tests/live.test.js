/**
 * Pruebas del modo app y de la actualización en vivo:
 * el manifiesto, el service worker, la conexión de eventos y los comentarios
 * que llegan sin recargar.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../src/config.js';
import { createApp } from '../src/app.js';

let server;
let base;
let seed;
let services;
const jar = new Map();

const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function storeCookies(res) {
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const [k, v] = c.split(';')[0].split('=');
    jar.set(k.trim(), v);
  }
}
async function get(ruta, opts = {}) {
  const res = await fetch(base + ruta, { redirect: 'manual', headers: { Cookie: cookieHeader(), ...(opts.headers || {}) } });
  storeCookies(res);
  return res;
}
async function post(ruta, body) {
  const res = await fetch(base + ruta, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  storeCookies(res);
  return res;
}
/** Slug de una publicación de verdad, tomado de la base de datos.
    Leerlo del HTML es frágil: el botón "Publicar" también cuelga de /incidencias/. */
const unaPublicacion = () => {
  const post = services.posts.latest(1)[0];
  assert.ok(post, 'hay alguna publicación de ejemplo');
  return post.slug;
};

const csrfFrom = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

/**
 * Abre la conexión de eventos y va devolviendo lo que llega.
 * Se usa a mano en lugar de EventSource porque en Node no existe.
 */
async function abrirEventos(conSesion = true) {
  const control = new AbortController();
  const res = await fetch(base + '/api/eventos', {
    headers: conSesion ? { Cookie: cookieHeader(), Accept: 'text/event-stream' } : { Accept: 'text/event-stream' },
    signal: control.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const lector = res.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  const recibidos = [];

  (async () => {
    try {
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        buffer += decodificador.decode(value, { stream: true });
        let corte = buffer.indexOf('\n\n');
        while (corte !== -1) {
          const bloque = buffer.slice(0, corte);
          buffer = buffer.slice(corte + 2);
          const tipo = (bloque.match(/^event: (.+)$/m) || [])[1];
          const datos = (bloque.match(/^data: (.+)$/m) || [])[1];
          if (tipo && datos) recibidos.push({ tipo, datos: JSON.parse(datos) });
          corte = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // la conexión se ha cerrado al terminar la prueba
    }
  })();

  return {
    recibidos,
    cerrar: () => control.abort(),
    /** Espera a que llegue un evento del tipo pedido. */
    async esperar(tipo, ms = 3000) {
      const limite = Date.now() + ms;
      while (Date.now() < limite) {
        const encontrado = recibidos.find((e) => e.tipo === tipo);
        if (encontrado) return encontrado;
        await new Promise((r) => setTimeout(r, 25));
      }
      return null;
    },
  };
}

before(async () => {
  const app = createApp({ ...config, seedDemo: true, isProduction: false }, { dbFile: ':memory:' });
  seed = app.seed;
  services = app.services;
  server = app.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  services?.events.cerrarTodo();
  server?.close();
});

test('el manifiesto describe una app instalable y sus iconos existen', async () => {
  const res = await get('/manifest.webmanifest');
  assert.equal(res.status, 200);
  // Sin no-cache, una copia vieja dejaría la app instalada anclada al pasado.
  assert.match(res.headers.get('cache-control'), /no-cache/);

  const manifiesto = JSON.parse(await res.text());
  assert.equal(manifiesto.display, 'standalone');
  assert.equal(manifiesto.scope, '/');
  assert.ok(manifiesto.shortcuts.length >= 3, 'hay accesos directos');
  assert.equal(manifiesto.share_target.action, '/incidencias/nueva');

  const enmascarables = manifiesto.icons.filter((i) => i.purpose === 'maskable');
  assert.ok(enmascarables.length >= 1, 'hay al menos un icono recortable');
  for (const icono of manifiesto.icons) {
    const fichero = path.join(ROOT_DIR, 'public', icono.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(fichero), `falta el icono ${icono.src}`);
  }
  for (const atajo of manifiesto.shortcuts) {
    const res2 = await get(atajo.url);
    assert.ok(res2.status < 400, `el acceso directo ${atajo.url} responde ${res2.status}`);
    for (const icono of atajo.icons || []) {
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public', icono.src.replace(/^\//, ''))), `falta ${icono.src}`);
    }
  }
});

test('el service worker y la pantalla sin conexión se sirven', async () => {
  const sw = await get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('cache-control'), /no-cache/);
  const codigo = await sw.text();
  // Guardar HTML sería enseñarle a un vecino la página de otro.
  assert.ok(!/cache\.put\(req, res\.clone\(\)\);?\s*}\s*\/\/ html/i.test(codigo));
  assert.match(codigo, /sin-conexion/);

  const offline = await get('/sin-conexion.html');
  assert.equal(offline.status, 200);
  assert.match(await offline.text(), /No hay conexión/);
});

test('la página de instalación explica Android y iPhone', async () => {
  const res = await get('/app');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Android/);
  assert.match(html, /Safari/);
  assert.match(html, /data-install/);
});

test('todas las páginas llevan la barra inferior y los guiones de la app', async () => {
  const html = await (await get('/')).text();
  assert.match(html, /class="tabbar"/);
  assert.match(html, /\/js\/live\.js/);
  assert.match(html, /\/js\/pwa\.js/);
  assert.match(html, /viewport-fit=cover/);
});

test('compartir desde el móvil rellena el formulario de publicación', async () => {
  const loginPage = await (await get('/acceder')).text();
  await post('/acceder', {
    _csrf: csrfFrom(loginPage),
    email: seed.adminCreated.email,
    contrasena: seed.adminCreated.password,
  });

  const html = await (
    await get('/incidencias/nueva?titulo=' + encodeURIComponent('Farola rota en la plaza') + '&cuerpo=' + encodeURIComponent('Lleva dos semanas') + '&enlace=https://ejemplo.es/foto')
  ).text();
  assert.match(html, /Farola rota en la plaza/);
  assert.match(html, /Lleva dos semanas/);
  assert.match(html, /https:\/\/ejemplo\.es\/foto/);
});

test('un comentario nuevo se anuncia en vivo y se puede pintar sin recargar', async () => {
  const slug = unaPublicacion();

  const flujo = await abrirEventos();
  const hola = await flujo.esperar('hola');
  assert.ok(hola, 'el servidor saluda al conectar');
  assert.equal(hola.datos.alcance, 'moderacion');

  const pagina = await (await get(`/incidencias/${slug}`)).text();
  const antesDe = Number((pagina.match(/data-last-comment="(\d+)"/) || [])[1] ?? 0);
  const enviado = await post(`/incidencias/${slug}/comentarios`, {
    _csrf: csrfFrom(pagina),
    cuerpo: 'Confirmo que sigue igual esta mañana.',
  });
  assert.equal(enviado.status, 302, 'el comentario se guarda');

  const evento = await flujo.esperar('comentario:nuevo');
  assert.ok(evento, 'llega el aviso del comentario');
  assert.equal(evento.datos.slug, slug);

  const fragmento = await (await get(`/incidencias/${slug}/comentarios/nuevos?desde=${antesDe}`)).json();
  assert.match(fragmento.html, /Confirmo que sigue igual esta mañana/);
  assert.match(fragmento.html, /class="comment/);
  assert.ok(fragmento.ultimo > antesDe);

  // Pedir lo mismo otra vez no devuelve nada: no se duplican comentarios.
  const otraVez = await (await get(`/incidencias/${slug}/comentarios/nuevos?desde=${fragmento.ultimo}`)).json();
  assert.equal(otraVez.html, '');

  flujo.cerrar();
});

test('los apoyos y los cambios de estado llegan en vivo', async () => {
  const slug = unaPublicacion();
  const pagina = await (await get(`/incidencias/${slug}`)).text();
  const token = csrfFrom(pagina);

  const flujo = await abrirEventos();
  await flujo.esperar('hola');

  const apoyado = await post(`/incidencias/${slug}/apoyar`, { _csrf: token });
  assert.equal(apoyado.status, 302, 'el apoyo se guarda');
  const apoyo = await flujo.esperar('apoyo');
  assert.ok(apoyo, 'llega el aviso del apoyo');
  assert.equal(typeof apoyo.datos.apoyos, 'number');

  await post(`/incidencias/${slug}/estado`, { _csrf: token, estado: 'en_tramite', nota: 'Reclamado al Ayuntamiento.' });
  const estado = await flujo.esperar('estado');
  assert.ok(estado, 'llega el cambio de estado');
  assert.equal(estado.datos.estado, 'en_tramite');

  flujo.cerrar();
});

test('quien no modera no recibe los avisos reservados a moderación', async () => {
  const anonimo = await abrirEventos(false);
  const hola = await anonimo.esperar('hola');
  assert.equal(hola.datos.alcance, 'publico');

  services.events.publicar('denuncia', { pendientes: 7 }, { alcance: 'moderacion' });
  services.events.publicar('publicacion:nueva', { slug: 'prueba-visible' });

  const publico = await anonimo.esperar('publicacion:nueva');
  assert.ok(publico, 'sí recibe lo público');
  assert.equal(anonimo.recibidos.filter((e) => e.tipo === 'denuncia').length, 0, 'no recibe denuncias');

  anonimo.cerrar();
});

test('editar a la vez que otra persona no pisa su trabajo', async () => {
  const slug = unaPublicacion();
  const formulario = await (await get(`/incidencias/${slug}/editar`)).text();
  const token = csrfFrom(formulario);
  const categoria = (formulario.match(/name="categoria" value="([a-z0-9-]+)"[^>]*checked/) || [])[1]
    || (formulario.match(/name="categoria" value="([a-z0-9-]+)"/) || [])[1];

  const datos = {
    _csrf: token,
    tipo: 'incidencia',
    titulo: 'Un título nuevo lo bastante largo',
    cuerpo: 'Texto de prueba con la longitud mínima necesaria para pasar.',
    categoria,
    visto_en: '2000-01-01 00:00:00', // como si alguien hubiera guardado mientras tanto
  };
  const choque = await post(`/incidencias/${slug}/editar`, datos);
  assert.equal(choque.status, 422);
  const html = await choque.text();
  assert.match(html, /mientras la editabas/);
  // El texto escrito no se pierde.
  assert.match(html, /Un título nuevo lo bastante largo/);
});
