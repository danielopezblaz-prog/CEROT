import { STATUSES, TYPES, SORTS } from './constants.js';
import { cleanString, toInt } from './text.js';

const STATUS_FILTERS = [...Object.keys(STATUSES), 'pendientes'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  return ISO_DATE.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/** Interpreta los parámetros de la URL (en castellano) y los normaliza. */
export function parseFilters(query = {}, categories) {
  const q = cleanString(query.q, 100);
  const status = STATUS_FILTERS.includes(query.estado) ? query.estado : '';
  const type = TYPES[query.tipo] ? query.tipo : '';
  const category = query.categoria ? categories.bySlug(query.categoria) : null;
  const sort = SORTS[query.orden] ? query.orden : 'recientes';
  const page = Math.max(1, toInt(query.pagina, 1));
  const from = isIsoDate(query.desde) ? String(query.desde) : '';
  const to = isIsoDate(query.hasta) ? String(query.hasta) : '';
  return {
    q,
    status,
    type,
    category: category || null,
    categoryId: category ? category.id : null,
    categorySlug: category ? category.slug : '',
    sort,
    page,
    from,
    to,
    isActive: Boolean(q || status || type || category || from || to),
  };
}

const PARAM_NAMES = {
  q: 'q',
  status: 'estado',
  type: 'tipo',
  categorySlug: 'categoria',
  sort: 'orden',
  page: 'pagina',
  from: 'desde',
  to: 'hasta',
};

/** Construye una query string a partir de los filtros, aplicando cambios (overrides). */
export function filtersToQuery(filters = {}, overrides = {}) {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const [key, name] of Object.entries(PARAM_NAMES)) {
    const value = merged[key];
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (key === 'sort' && value === 'recientes') continue;
    if (key === 'page' && Number(value) <= 1) continue;
    params.set(name, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
