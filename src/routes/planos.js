import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { planosLimiter, busquedaLimiter } from '../middleware/limits.js';

/*
 * Los planos del mapa y la búsqueda de direcciones pasan por el foro en vez de
 * pedirse a OpenStreetMap desde el navegador del vecino. Hay redes y ajustes
 * (el Relay privado de iCloud del iPhone, algunos bloqueadores) que cortan esas
 * peticiones y dejaban el mapa gris; así el vecino solo habla con el foro, que
 * sí le llega, y OpenStreetMap no ve las direcciones IP de los vecinos.
 *
 * Los planos se guardan en data/planos/ y se renuevan pasado un mes
 * (OpenStreetMap pide conservarlos al menos siete días). Solo se sirven los de
 * la zona del barrio y con un tope por conexión, para que nadie use el foro como
 * distribuidor de planos de todo el mundo y OpenStreetMap acabe bloqueando al
 * servidor.
 */

const ZOOM_MAXIMO = 19;
const CADUCIDAD_MS = 30 * 24 * 60 * 60 * 1000; // pasado un mes se vuelve a pedir
const OLVIDO_MS = 90 * 24 * 60 * 60 * 1000; // tres meses sin renovarse (nadie lo pide): se borra
const MARGEN_LAT = 1.2; // grados alrededor del centro del mapa: cubre de sobra la Comunidad de Madrid
const MARGEN_LNG = 1.6;
const DESCARGAS_A_LA_VEZ = 6; // como un navegador: sin avalanchas sobre servidores donados
const TIEMPO_MAXIMO_MS = 10000;
const ESPERA_ENTRE_BUSQUEDAS_MS = 1100; // Nominatim admite una búsqueda por segundo
const FIRMA_PNG = 0x89504e47;

/** Latitud y longitud que abarca un plano (x, y) a un nivel de zoom. */
export function limitesDelPlano(z, x, y) {
  const n = 2 ** z;
  const lngMin = (x / n) * 360 - 180;
  const lngMax = ((x + 1) / n) * 360 - 180;
  const latDe = (fila) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * fila) / n))) * 180) / Math.PI;
  return { latMax: latDe(y), latMin: latDe(y + 1), lngMin, lngMax };
}

export function planosRoutes({ config }) {
  const router = express.Router();
  const carpeta = path.join(config.dataDir, 'planos');
  fs.mkdirSync(carpeta, { recursive: true });

  // OpenStreetMap exige identificarse; sin esto rechaza o limita las peticiones.
  const identidad = {
    'User-Agent': `ForoVecinal/1.0 (+${config.baseUrl}${config.site.contactEmail ? `; ${config.site.contactEmail}` : ''})`,
    Referer: `${config.baseUrl}/`,
  };
  const zona = {
    latMin: config.map.lat - MARGEN_LAT,
    latMax: config.map.lat + MARGEN_LAT,
    lngMin: config.map.lng - MARGEN_LNG,
    lngMax: config.map.lng + MARGEN_LNG,
  };

  function dentroDeZona(z, x, y) {
    const p = limitesDelPlano(z, x, y);
    return p.lngMax >= zona.lngMin && p.lngMin <= zona.lngMax && p.latMax >= zona.latMin && p.latMin <= zona.latMax;
  }

  /* Descargas: pocas a la vez y nunca dos veces el mismo plano. */
  let descargando = 0;
  const esperandoTurno = [];
  const enCurso = new Map();
  function turno() {
    if (descargando < DESCARGAS_A_LA_VEZ) {
      descargando += 1;
      return Promise.resolve();
    }
    return new Promise((r) => esperandoTurno.push(r));
  }
  function fin() {
    const siguiente = esperandoTurno.shift();
    if (siguiente) siguiente(); // hereda el hueco
    else descargando -= 1;
  }

  async function descargarPlano(z, x, y, fichero) {
    const clave = `${z}/${x}/${y}`;
    if (enCurso.has(clave)) return enCurso.get(clave);
    const tarea = (async () => {
      await turno();
      const control = new AbortController();
      const tope = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
      try {
        const r = await fetch(`${config.map.origenPlanos}/${clave}.png`, { headers: identidad, signal: control.signal });
        if (!r.ok) throw new Error(`OpenStreetMap ha respondido ${r.status}`);
        const datos = Buffer.from(await r.arrayBuffer());
        if (datos.length < 8 || datos.readUInt32BE(0) !== FIRMA_PNG) throw new Error('la respuesta no es una imagen PNG');
        // Se escribe aparte y se renombra: nunca queda un plano a medias en el disco.
        const temporal = `${fichero}.${process.pid}.${Date.now()}.tmp`;
        await fsp.writeFile(temporal, datos);
        await fsp.rename(temporal, fichero);
        return datos;
      } finally {
        clearTimeout(tope);
        fin();
        enCurso.delete(clave);
      }
    })();
    enCurso.set(clave, tarea);
    return tarea;
  }

  /* Los planos que llevan meses sin renovarse se borran, igual que los restos de
     descargas interrumpidas. Una pasada al arrancar y otra cada día. */
  async function limpiar() {
    try {
      for (const nombre of await fsp.readdir(carpeta)) {
        const limite = nombre.endsWith('.tmp') ? 60 * 60 * 1000 : nombre.endsWith('.png') ? OLVIDO_MS : null;
        if (limite === null) continue;
        const ruta = path.join(carpeta, nombre);
        const estado = await fsp.stat(ruta).catch(() => null);
        if (estado && Date.now() - estado.mtimeMs > limite) await fsp.rm(ruta, { force: true });
      }
    } catch (err) {
      console.error('[planos] No se ha podido limpiar la carpeta de planos:', err.message);
    }
  }
  limpiar();
  setInterval(limpiar, 24 * 60 * 60 * 1000).unref();

  /* Búsqueda de direcciones: una detrás de otra y con un segundo entre ellas,
     que es lo que pide Nominatim. */
  let cola = Promise.resolve();
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms).unref());
  function enCola(tarea) {
    const resultado = cola.then(tarea);
    cola = resultado.then(() => esperar(ESPERA_ENTRE_BUSQUEDAS_MS), () => esperar(ESPERA_ENTRE_BUSQUEDAS_MS));
    return resultado;
  }

  router.get('/planos/buscar', busquedaLimiter, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 200);
    res.set('Cache-Control', 'no-store');
    if (q.length < 3) return res.json([]);
    let lat = Number(req.query.lat);
    let lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) lat = config.map.lat;
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) lng = config.map.lng;
    const d = 0.06;
    const base = `${config.map.origenBusqueda}?format=json&limit=1&accept-language=es&countrycodes=es&viewbox=${lng - d},${lat + d},${lng + d},${lat - d}&q=${encodeURIComponent(q)}`;
    try {
      const resultados = await enCola(async () => {
        // Primero cerca del barrio; si no hay nada, en toda España.
        const intentos = [`${base}&bounded=1`, base];
        for (const [i, url] of intentos.entries()) {
          if (i) await esperar(ESPERA_ENTRE_BUSQUEDAS_MS);
          const r = await fetch(url, { headers: { ...identidad, Accept: 'application/json' }, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
          if (!r.ok) throw new Error(`Nominatim ha respondido ${r.status}`);
          const datos = await r.json();
          if (Array.isArray(datos) && datos.length) return datos;
        }
        return [];
      });
      return res.json(resultados.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), display_name: String(r.display_name || '') })));
    } catch (err) {
      return res.status(502).json({ error: `No se ha podido buscar la dirección: ${err.message}` });
    }
  });

  router.get('/planos/:z/:x/:archivo', planosLimiter, async (req, res) => {
    const m = /^(\d{1,7})\.png$/.exec(req.params.archivo);
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = m ? Number(m[1]) : NaN;
    const n = 2 ** z;
    const valido = /^\d{1,2}$/.test(req.params.z) && /^\d{1,7}$/.test(req.params.x) && m
      && z <= ZOOM_MAXIMO && x < n && y < n && dentroDeZona(z, x, y);
    if (!valido) return res.status(404).type('text/plain').send('Plano fuera de la zona del foro.');

    const fichero = path.join(carpeta, `${z}-${x}-${y}.png`);
    try {
      const estado = await fsp.stat(fichero);
      if (Date.now() - estado.mtimeMs < CADUCIDAD_MS) return res.sendFile(fichero, { maxAge: '7d' });
    } catch {
      // no está guardado todavía
    }
    try {
      const datos = await descargarPlano(z, x, y, fichero);
      res.set('Cache-Control', 'public, max-age=604800');
      return res.type('png').send(datos);
    } catch (err) {
      // Un plano caducado es mejor que un hueco gris.
      if (fs.existsSync(fichero)) return res.sendFile(fichero, { maxAge: '1h' });
      res.set('Cache-Control', 'no-store');
      return res.status(502).type('text/plain').send(`No se ha podido obtener el plano: ${err.message}`);
    }
  });

  return router;
}
