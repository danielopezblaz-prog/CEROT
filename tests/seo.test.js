import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';

/* Lo que el foro le cuenta a Google: mapa del sitio, títulos, direcciones
   canónicas, fichas estructuradas y qué páginas no se indexan. */
let server;
let base;
let services;
const get = (p) => fetch(base + p, { redirect: 'manual' });
const meta = (html, nombre) => (html.match(new RegExp(`<meta (?:name|property)="${nombre}" content="([^"]*)"`)) || [])[1];
// En el HTML el «&» va como «&amp;»; aquí se lee como lo leería el navegador.
const canonica = (html) => ((html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');
const fichas = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1])['@graph'] : [];
};

before(async () => {
  const app = createApp({ ...config, seedDemo: true, isProduction: false }, { dbFile: ':memory:' });
  services = app.services;
  server = app.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test('mapa del sitio y robots.txt: lo que Google debe rastrear', async () => {
  const robots = await (await get('/robots.txt')).text();
  assert.ok(robots.includes(`Sitemap: ${config.baseUrl}/sitemap.xml`), 'robots.txt apunta al mapa del sitio');
  assert.match(robots, /Disallow: \/estadisticas/);
  assert.match(robots, /Disallow: \/planos\//);

  const res = await get('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  const xml = await res.text();
  const post = services.posts.latest(1)[0];
  const negocio = services.businesses.list({ perPage: 1 }).items[0];
  for (const ruta of ['/', '/incidencias', '/mapa', '/negocios', '/sobre', `/incidencias/${post.slug}`, `/negocios/${negocio.slug}`]) {
    assert.ok(xml.includes(`<loc>${config.baseUrl}${ruta}</loc>`), `el mapa del sitio incluye ${ruta}`);
  }
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  for (const privada of ['/admin', '/estadisticas', '/informe', '/acceder', '/perfil']) {
    assert.ok(!xml.includes(`${config.baseUrl}${privada}<`), `el mapa del sitio no incluye ${privada}`);
  }
});

test('títulos, direcciones canónicas y fichas estructuradas', async () => {
  const portada = await (await get('/')).text();
  const titulo = portada.match(/<title>([^<]*)<\/title>/)[1];
  assert.ok(titulo.includes(config.site.name) && titulo.includes(config.site.municipality), `la portada se titula con barrio y municipio: ${titulo}`);
  assert.equal(canonica(portada), `${config.baseUrl}/`);
  assert.ok(meta(portada, 'description'));
  assert.match(portada, /<link rel="preload" as="image" href="\/img\/portada\.webp"/);
  const enPortada = fichas(portada);
  assert.equal(enPortada.find((f) => f['@type'] === 'WebSite').potentialAction['@type'], 'SearchAction');
  assert.ok(enPortada.some((f) => f['@type'] === 'Organization'));

  // Estado, orden y búsqueda no crean páginas nuevas; categoría, tipo y página sí.
  assert.equal(canonica(await (await get('/incidencias?estado=pendientes&orden=apoyos')).text()), `${config.baseUrl}/incidencias`);
  const cat = services.categories.all()[0].slug;
  assert.equal(canonica(await (await get(`/incidencias?categoria=${cat}&orden=apoyos&pagina=2`)).text()), `${config.baseUrl}/incidencias?categoria=${cat}&pagina=2`);

  const post = services.posts.latest(1)[0];
  const pagina = await (await get(`/incidencias/${post.slug}`)).text();
  assert.equal(meta(pagina, 'og:type'), 'article');
  const ficha = fichas(pagina).find((f) => f['@type'] === 'DiscussionForumPosting');
  assert.equal(ficha.headline, post.title);
  assert.equal(ficha.author.name, post.author_name);
  assert.ok(ficha.datePublished);
  assert.ok(fichas(pagina).some((f) => f['@type'] === 'BreadcrumbList'));

  const negocio = services.businesses.list({ perPage: 1 }).items[0];
  const fichaNegocio = fichas(await (await get(`/negocios/${negocio.slug}`)).text()).find((f) => f.name === negocio.name);
  assert.ok(fichaNegocio, 'el negocio lleva su ficha');
  assert.equal(fichaNegocio.address.addressLocality, config.site.municipality);
  assert.equal(fichaNegocio.url, `${config.baseUrl}/negocios/${negocio.slug}`);
});

test('sin índice donde no toca, y una sola dirección por página', async () => {
  for (const ruta of ['/acceder', '/registro', '/incidencias?q=farola', '/no-existe']) {
    assert.match(await (await get(ruta)).text(), /<meta name="robots" content="noindex, follow">/, `${ruta} no se indexa`);
  }
  for (const ruta of ['/', '/incidencias', '/incidencias?estado=pendientes']) {
    assert.doesNotMatch(await (await get(ruta)).text(), /name="robots"/, `${ruta} sí se indexa`);
  }
  const barra = await get('/incidencias/?estado=pendientes');
  assert.equal(barra.status, 301);
  assert.equal(barra.headers.get('location'), '/incidencias?estado=pendientes');
  assert.equal((await get('/api/marcadores')).headers.get('x-robots-tag'), 'noindex');

  const post = services.posts.latest(1)[0];
  const negocio = services.businesses.list({ perPage: 1 }).items[0];
  const publicas = ['/', '/incidencias', '/mapa', '/negocios', '/negocios/ofertas', '/normas', '/sobre', '/recursos', '/aviso-legal', '/privacidad', '/app', `/incidencias/${post.slug}`, `/negocios/${negocio.slug}`];
  for (const ruta of publicas) {
    const html = await (await get(ruta)).text();
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${ruta} tiene un único h1`);
  }
});
