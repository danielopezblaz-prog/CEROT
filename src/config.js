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
      'Plataforma vecinal independiente para publicar, apoyar y dar visibilidad a las incidencias y gestiones pendientes del barrio.'
    ),
    contactEmail: env('CONTACT_EMAIL', ''),
    legalOwner: env('LEGAL_OWNER', ''),
  },
  map: {
    lat: envNum('MAP_CENTER_LAT', 40.3215),
    lng: envNum('MAP_CENTER_LNG', -3.756),
    zoom: envNum('MAP_ZOOM', 15),
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
