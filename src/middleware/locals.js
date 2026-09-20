import {
  STATUSES, TYPES, SORTS, ENTITIES, REPORT_REASONS, ROLES,
  BUSINESS_CATEGORIES, BUSINESS_CATEGORY_MAP, BUSINESS_STATUSES, OFFER_TYPES, WEEKDAYS,
} from '../utils/constants.js';
import { parseHours, groupedHours, openState, dayText } from '../utils/hours.js';
import { formatDate, formatDateTime, formatLong, timeAgo, toIso, isoDate } from '../utils/dates.js';
import { renderUserText, excerpt, initials, escapeHtml, plural, avatarHue } from '../utils/text.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';
import { icon, categoryIcon, typeIcon, pinIcon, businessIcon, categoryIconBodies, businessIconBodies } from '../utils/icons.js';
import { fichaSitio, jsonLd } from '../utils/seo.js';

const numberFormat = new Intl.NumberFormat('es-ES');
const BUSINESS_ICON_JSON = JSON.stringify(businessIconBodies());

/* Los estilos y los guiones se piden con `?v=...`. Ese número sale de la fecha
   del fichero más reciente, no del arranque: así cambia justo cuando cambia algo
   de verdad. Importa porque la app instalada guarda cada versión por separado;
   si el número no se moviera, seguiría usando los estilos viejos. */
const ASSET_FILES = ['public/css/app.css', 'public/js/app.js', 'public/js/live.js', 'public/js/pwa.js', 'public/js/map.js', 'public/js/post-form.js'];
function assetVersion() {
  let ultima = 0;
  for (const rel of ASSET_FILES) {
    try {
      ultima = Math.max(ultima, fs.statSync(path.join(ROOT_DIR, rel)).mtimeMs);
    } catch {
      // fichero opcional que no existe: no afecta a la versión
    }
  }
  return Math.round(ultima).toString(36);
}
/* En producción se calcula una sola vez; en desarrollo, en cada visita, para no
   tener que reiniciar cada vez que se toca una hoja de estilos. */
const ASSET_VERSION = assetVersion();
const CATEGORY_ICON_JSON = JSON.stringify(categoryIconBodies());

/* Dirección canónica de una página: la ruta más los parámetros que cambian el
   contenido de verdad (categoría, tipo y página). Orden, estado, fechas y
   búsquedas no crean páginas nuevas para Google. */
const PARAMETROS_CANONICOS = ['categoria', 'tipo', 'pagina'];
function canonica(config, req) {
  const p = new URLSearchParams();
  for (const clave of PARAMETROS_CANONICOS) {
    const valor = req.query[clave];
    if (typeof valor !== 'string' || !valor) continue;
    if (clave === 'pagina' && !(Number(valor) > 1)) continue;
    p.set(clave, valor);
  }
  const s = p.toString();
  return `${config.baseUrl}${req.path}${s ? `?${s}` : ''}`;
}

/** Variables y funciones disponibles en todas las vistas. */
export function locals(config, services) {
  const FICHAS_SITIO = fichaSitio(config);
  return (req, res, next) => {
    res.locals.site = config.site;
    res.locals.map = config.map;
    res.locals.baseUrl = config.baseUrl;
    res.locals.assetVersion = config.isProduction ? ASSET_VERSION : assetVersion();
    res.locals.currentPath = req.path;
    res.locals.currentUrl = req.originalUrl;
    res.locals.query = req.query;
    res.locals.pageMeta = {};
    res.locals.canonicalUrl = canonica(config, req);
    // Los resultados de una búsqueda no son páginas para Google.
    res.locals.noindexAuto = typeof req.query.q === 'string' && req.query.q.trim() !== '';
    res.locals.fichasSitio = FICHAS_SITIO;
    res.locals.jsonLd = jsonLd;
    res.locals.STATUSES = STATUSES;
    res.locals.TYPES = TYPES;
    res.locals.SORTS = SORTS;
    res.locals.ENTITIES = ENTITIES;
    res.locals.REPORT_REASONS = REPORT_REASONS;
    res.locals.ROLES = ROLES;
    res.locals.categories = services.categories.all();
    res.locals.facebookEnabled = services.facebook.enabled;
    res.locals.formatDate = formatDate;
    res.locals.formatDateTime = formatDateTime;
    res.locals.formatLong = formatLong;
    res.locals.timeAgo = timeAgo;
    res.locals.toIso = toIso;
    res.locals.isoDate = isoDate;
    res.locals.renderUserText = renderUserText;
    res.locals.excerpt = excerpt;
    res.locals.initials = initials;
    res.locals.avatarHue = avatarHue;
    res.locals.escapeHtml = escapeHtml;
    res.locals.icon = icon;
    res.locals.categoryIcon = categoryIcon;
    res.locals.typeIcon = typeIcon;
    res.locals.pinIcon = pinIcon;
    res.locals.businessIcon = businessIcon;
    res.locals.businessIconJson = BUSINESS_ICON_JSON;
    res.locals.BUSINESS_CATEGORIES = BUSINESS_CATEGORIES;
    res.locals.BUSINESS_CATEGORY_MAP = BUSINESS_CATEGORY_MAP;
    res.locals.BUSINESS_STATUSES = BUSINESS_STATUSES;
    res.locals.OFFER_TYPES = OFFER_TYPES;
    res.locals.WEEKDAYS = WEEKDAYS;
    res.locals.parseHours = parseHours;
    res.locals.groupedHours = groupedHours;
    res.locals.openState = openState;
    res.locals.dayText = dayText;
    res.locals.categoryIconJson = CATEGORY_ICON_JSON;
    res.locals.plural = plural;
    res.locals.number = (n) => numberFormat.format(Number(n) || 0);
    res.locals.pendingBusinesses = () =>
      req.user && ['moderador', 'admin'].includes(req.user.role) ? services.businesses.countPending() : 0;
    res.locals.pendingReports = () =>
      req.user && ['moderador', 'admin'].includes(req.user.role) ? services.reports.countPending() : 0;
    res.locals.absoluteUrl = (p) => `${config.baseUrl}${p.startsWith('/') ? p : `/${p}`}`;
    res.locals.isActivePath = (prefix) => (prefix === '/' ? req.path === '/' : req.path.startsWith(prefix));
    next();
  };
}
