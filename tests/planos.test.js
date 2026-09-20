import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';

/* Servidor que imita a OpenStreetMap (planos) y a Nominatim (direcciones).
   Ninguna prueba sale a internet. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const osm = { planos: [], busquedas: [], caido: false };
let osmServer;
let server;
let base;
let carpeta;

/** Plano (x, y) que contiene un punto a un nivel de zoom. */
function planoDe(lat, lng, z) {
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * 2 ** z),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z),
  };
}
const json = { headers: { Accept: 'application/json' } };

before(async () => {
  osmServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://osm.local');
    if (url.pathname === '/search') {
      const params = Object.fromEntries(url.searchParams);
      osm.busquedas.push({ params, agente: req.headers['user-agent'] });
      res.setHeader('Content-Type', 'application/json');
      if (params.q.includes('lejos') && params.bounded === '1') return res.end('[]');
      return res.end(JSON.stringify([{ lat: '40.3300', lon: '-3.7600', display_name: 'Calle de Ejemplo, 1, Leganés' }]));
    }
    osm.planos.push({ ruta: url.pathname, agente: req.headers['user-agent'] });
    if (osm.caido) {
      res.statusCode = 503;
      return res.end('caído');
    }
    res.setHeader('Content-Type', 'image/png');
    return res.end(PNG);
  });
  osmServer.listen(0, '127.0.0.1');
  await new Promise((r) => osmServer.once('listening', r));
  const origen = `http://127.0.0.1:${osmServer.address().port}`;

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'foro-planos-'));
  carpeta = path.join(dataDir, 'planos');
  const app = createApp(
    { ...config, seedDemo: false, isProduction: false, dataDir, map: { ...config.map, origenPlanos: origen, origenBusqueda: `${origen}/search` } },
    { dbFile: ':memory:' }
  );
  server = app.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  osmServer?.close();
});

test('los planos del barrio llegan a través del foro y se guardan en el disco', async () => {
  const { x, y } = planoDe(config.map.lat, config.map.lng, 15);
  const res = await fetch(`${base}/planos/15/${x}/${y}.png`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/png/);
  assert.match(res.headers.get('cache-control'), /max-age=604800/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  assert.equal(osm.planos.length, 1);
  assert.equal(osm.planos[0].ruta, `/15/${x}/${y}.png`);
  assert.match(osm.planos[0].agente, /ForoVecinal/, 'se identifica ante OpenStreetMap');
  await fs.access(path.join(carpeta, `15-${x}-${y}.png`));

  // La segunda vez sale del disco: OpenStreetMap no recibe nada.
  const otra = await fetch(`${base}/planos/15/${x}/${y}.png`);
  assert.equal(otra.status, 200);
  assert.deepEqual(Buffer.from(await otra.arrayBuffer()), PNG);
  assert.equal(osm.planos.length, 1);
});

test('fuera de la zona del barrio o mal escrito: 404 sin molestar a OpenStreetMap', async () => {
  const antes = osm.planos.length;
  const { x, y } = planoDe(config.map.lat, config.map.lng, 15);
  const fuera = ['/planos/15/0/0.png', '/planos/25/1/1.png', `/planos/15/${x}/${y}.jpg`, `/planos/15/${x}/hola.png`, '/planos/15/99999999/1.png'];
  for (const ruta of fuera) {
    const res = await fetch(`${base}${ruta}`);
    assert.equal(res.status, 404, `GET ${ruta}`);
    await res.text();
  }
  assert.equal(osm.planos.length, antes);

  // Un plano del mundo entero que incluye Madrid sí vale, aunque sea de zoom bajo.
  const mundo = planoDe(config.map.lat, config.map.lng, 3);
  const res = await fetch(`${base}/planos/3/${mundo.x}/${mundo.y}.png`);
  assert.equal(res.status, 200);
  await res.arrayBuffer();
  assert.equal(osm.planos.length, antes + 1);
});

test('si OpenStreetMap no responde, vale el plano guardado aunque sea viejo; si no hay, se avisa', async () => {
  const { x, y } = planoDe(config.map.lat, config.map.lng, 16);
  const fichero = path.join(carpeta, `16-${x}-${y}.png`);
  const primero = await fetch(`${base}/planos/16/${x}/${y}.png`);
  assert.equal(primero.status, 200);
  await primero.arrayBuffer();

  // Lo envejecemos más de un mes: tocaría renovarlo, pero OpenStreetMap está caído.
  const hace = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await fs.utimes(fichero, hace, hace);
  osm.caido = true;
  try {
    const viejo = await fetch(`${base}/planos/16/${x}/${y}.png`);
    assert.equal(viejo.status, 200, 'mejor un plano viejo que un hueco gris');
    assert.match(viejo.headers.get('cache-control'), /max-age=3600/);
    assert.deepEqual(Buffer.from(await viejo.arrayBuffer()), PNG);

    const nuevo = await fetch(`${base}/planos/16/${x + 1}/${y}.png`);
    assert.equal(nuevo.status, 502);
    assert.match(nuevo.headers.get('cache-control'), /no-store/);
    assert.match(await nuevo.text(), /No se ha podido obtener el plano/);
  } finally {
    osm.caido = false;
  }
});

test('la búsqueda de direcciones pasa por el foro: primero cerca del barrio y luego en toda España', async () => {
  const corta = await fetch(`${base}/planos/buscar?q=ab`, json);
  assert.deepEqual(await corta.json(), []);
  assert.equal(osm.busquedas.length, 0, 'con menos de tres letras no se pregunta a Nominatim');

  const res = await fetch(`${base}/planos/buscar?q=Calle%20de%20Ejemplo%201&lat=40.32&lng=-3.75`, json);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await res.json(), [{ lat: 40.33, lon: -3.76, display_name: 'Calle de Ejemplo, 1, Leganés' }]);
  assert.equal(osm.busquedas.length, 1);
  const { params, agente } = osm.busquedas[0];
  assert.equal(params.bounded, '1', 'primero solo alrededor del barrio');
  assert.equal(params.q, 'Calle de Ejemplo 1');
  assert.equal(params.countrycodes, 'es');
  assert.match(agente, /ForoVecinal/, 'se identifica ante Nominatim');

  // Si cerca del barrio no hay nada, se busca en toda España.
  const lejos = await fetch(`${base}/planos/buscar?q=Plaza%20lejos`, json);
  assert.equal((await lejos.json()).length, 1);
  assert.equal(osm.busquedas.length, 3);
  assert.equal(osm.busquedas[1].params.bounded, '1');
  assert.equal(osm.busquedas[2].params.bounded, undefined);
});
