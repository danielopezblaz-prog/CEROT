import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function envNum(name, fallback) {
  const n = Number(env(name, fallback));
  return Number.isFinite(n) ? n : fallback;
}
function envBool(name, fallback) {
  const v = env(name, undefined);
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(String(v).trim().toLowerCase());
}

const dataDir = path.resolve(ROOT_DIR, env('DATA_DIR', './data'));
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

function loadSessionSecret() {
  const fromEnv = env('SESSION_SECRET', '');
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, '.session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // todavía no existe: se genera a continuación
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const nodeEnv = env('NODE_ENV', 'development');

export const config = {
  env: nodeEnv,
  isProduction: nodeEnv === 'production',
  port: envNum('PORT', 3000),
  baseUrl: env('BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  sessionSecret: loadSessionSecret(),
  dataDir,
  uploadsDir,
  dbFile: path.join(dataDir, 'foro.sqlite'),
  site: {
    name: env('SITE_NAME', 'Vereda de los Estudiantes'),
    brand: env('SITE_BRAND', 'Foro Vecinal'),
    municipality: env('MUNICIPALITY', 'Leganés'),
    description: env(
      'SITE_DESCRIPTION',
      'Foro vecinal independiente del barrio Vereda de los Estudiantes, en Leganés: incidencias, apoyos, mapa del barrio, informes para el Ayuntamiento y directorio de comercios.'
    ),
    contactEmail: env('CONTACT_EMAIL', ''),
    // Código de Google Search Console (opcional). Con él Google confirma que el
    // foro es tuyo y te enseña cómo lo ve. La alternativa es un registro TXT en el DNS.
    googleVerification: env('GOOGLE_SITE_VERIFICATION', ''),
    legalOwner: env('LEGAL_OWNER', ''),
  },
  map: {
    lat: envNum('MAP_CENTER_LAT', 40.3215),
    lng: envNum('MAP_CENTER_LNG', -3.756),
    zoom: envNum('MAP_ZOOM', 15),
    // Los planos y la búsqueda de direcciones se piden a OpenStreetMap desde el
    // servidor (src/routes/planos.js). Se puede apuntar a otro sitio en las pruebas.
    origenPlanos: env('PLANOS_ORIGEN', 'https://tile.openstreetmap.org').replace(/\/+$/, ''),
    origenBusqueda: env('BUSQUEDA_ORIGEN', 'https://nominatim.openstreetmap.org/search'),
  },
  admin: {
    email: env('ADMIN_EMAIL', 'admin@vereda.local'),
    password: env('ADMIN_PASSWORD', ''),
  },
  upload: {
    maxMb: envNum('MAX_UPLOAD_MB', 8),
    maxImages: envNum('MAX_IMAGES_PER_POST', 4),
  },
  seedDemo: envBool('SEED_DEMO', true),
  trustProxy: envBool('TRUST_PROXY', false),
  perPage: 12,
  /*
   * Envío de correo. Solo se usa para el enlace de «he olvidado mi contraseña».
   * Sin proveedor configurado, el foro no ofrece esa opción y le dice al vecino
   * que escriba a la administración. Ver README, «Recuperar la contraseña».
   */
  correo: {
    proveedor: env('CORREO_PROVEEDOR', '').trim().toLowerCase(),
    clave: env('CORREO_CLAVE', ''),
    // El remitente tiene que estar verificado en el proveedor o rechazará el envío.
    // Con «smtp» es, casi siempre, el propio buzón desde el que se envía.
    remitente: env('CORREO_REMITENTE', '') || env('CORREO_USUARIO', '') || env('CONTACT_EMAIL', ''),
    nombre: env('CORREO_NOMBRE', '') || `${env('SITE_BRAND', 'Foro Vecinal')} ${env('SITE_NAME', 'Vereda de los Estudiantes')}`,
    // Solo para CORREO_PROVEEDOR=smtp: el buzón de siempre (Gmail, el del dominio…).
    servidor: env('CORREO_SERVIDOR', ''),
    puerto: envNum('CORREO_PUERTO', 587),
    usuario: env('CORREO_USUARIO', ''),
    // Se puede apuntar a otro servidor en las pruebas automáticas.
    url: env('CORREO_URL', ''),
    opciones: null,
  },
  facebook: {
    pageId: env('FACEBOOK_PAGE_ID', ''),
    token: env('FACEBOOK_PAGE_TOKEN', ''),
    apiVersion: env('FACEBOOK_API_VERSION', 'v25.0'),
    // Se puede apuntar a otro servidor en las pruebas automáticas.
    apiBase: env('FACEBOOK_API_BASE', 'https://graph.facebook.com'),
    get enabled() {
      return Boolean(this.pageId && this.token);
    },
  },
};
