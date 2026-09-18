import fs from 'node:fs';
import path from 'node:path';

/**
 * Devuelve una ruta interna segura para una redirección.
 * Evita que un enlace manipulado nos mande a otro sitio web
 * («open redirect»), aceptando solo rutas de este mismo foro.
 */
export function safePath(value, fallback = '/') {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (raw.includes('\\') || /[\r\n]/.test(raw)) return fallback;
  // Rechaza esquemas colados por codificación, del tipo /%09javascript:
  if (/^\/%[0-9a-f]{2}/i.test(raw) && /javascript|data/i.test(decodeURIComponent(raw.slice(0, 20)))) return fallback;
  return raw;
}

/**
 * Contraseñas demasiado usadas. No pretende ser exhaustivo: corta las que
 * aparecen las primeras en cualquier ataque de diccionario.
 */
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '1234567890', '87654321', '11111111', '00000000',
  'contrasena', 'contraseña', 'password', 'password1', 'passw0rd', 'qwertyui', 'qwerty123',
  'iloveyou', 'princesa', 'estrella', 'administrador', 'admin1234', 'adminadmin',
  'bienvenido', 'santiago', 'mariposa', 'cristina', 'alejandro', 'sebastian', 'francisco',
  'barcelona', 'realmadrid', 'atletico', 'vereda2026', 'leganes123', 'contrasena123',
  'temporal123', 'cambiame123', 'letmein123', 'welcome123', 'abcd1234', 'aaaaaaaa',
]);

/**
 * Comprueba que la contraseña vale. Devuelve un mensaje de error o null.
 * No obliga a mayúsculas ni símbolos: para gente mayor eso solo produce
 * contraseñas apuntadas en un papel. Prioriza longitud y evitar las obvias.
 */
export function checkPassword(password, { email = '', firstName = '', lastName = '' } = {}) {
  const value = String(password ?? '');
  if (value.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (value.length > 200) return 'La contraseña es demasiado larga.';
  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'Esa contraseña es de las más usadas del mundo. Elige otra.';
  if (/^(\d)\1+$/.test(value) || /^\d+$/.test(value)) return 'La contraseña no puede ser solo números.';
  const localPart = String(email).split('@')[0].toLowerCase();
  for (const dato of [localPart, String(firstName).toLowerCase(), String(lastName).toLowerCase()]) {
    if (dato && dato.length >= 4 && lower.includes(dato)) {
      return 'La contraseña no puede contener tu nombre ni tu correo.';
    }
  }
  return null;
}

/**
 * Repaso de seguridad antes de abrir el foro al barrio. Devuelve una lista de
 * comprobaciones con su estado, para mostrarla en el panel y en la consola.
 */
export function launchChecklist(config, services) {
  const primerAcceso = path.join(config.dataDir, 'PRIMER-ACCESO.txt');
  const demoPosts = services ? services.posts.countDemo() : 0;
  const demoBusinesses = services ? services.businesses.countDemo() : 0;

  const items = [
    {
      key: 'produccion',
      done: config.isProduction,
      label: 'Arrancar en modo producción',
      help: 'Pon NODE_ENV=production en el fichero .env. Activa la caché de plantillas y endurece las cookies.',
      critical: false,
    },
    {
      key: 'https',
      done: config.baseUrl.startsWith('https://'),
      label: 'Servir el foro por HTTPS',
      help: 'BASE_URL debe empezar por https://. Sin cifrado, las contraseñas de los vecinos viajan en claro.',
      critical: true,
    },
    {
      key: 'credenciales',
      done: !fs.existsSync(primerAcceso),
      label: 'Borrar el fichero de la contraseña inicial',
      help: `Entra, cambia la contraseña en Mi perfil y borra ${primerAcceso}.`,
      critical: true,
    },
    {
      key: 'demo',
      done: demoPosts === 0 && demoBusinesses === 0,
      label: 'Eliminar el contenido de ejemplo',
      help: 'Desde Panel, botón «Eliminar contenido de ejemplo». Borra publicaciones, negocios y vecinos ficticios.',
      critical: false,
    },
    {
      key: 'legal',
      done: Boolean(config.site.legalOwner && config.site.contactEmail),
      label: 'Rellenar el titular y el correo de contacto',
      help: 'LEGAL_OWNER y CONTACT_EMAIL en el .env. Son obligatorios en el aviso legal, y más ahora que guardas teléfonos.',
      critical: false,
    },
    {
      key: 'proxy',
      done: !config.isProduction || config.trustProxy,
      label: 'Avisar de que hay un proxy delante',
      help: 'Con Caddy, Nginx, Railway o Render, pon TRUST_PROXY=1. Si no, los límites contra abusos ven una sola IP.',
      critical: false,
    },
  ];

  return {
    items,
    pending: items.filter((i) => !i.done),
    blockers: items.filter((i) => !i.done && i.critical),
  };
}
