const TZ = 'Europe/Madrid';

export function parseDb(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  // SQLite guarda 'YYYY-MM-DD HH:MM:SS' en UTC
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmtDate = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtLong = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, month: 'short', year: '2-digit' });
const fmtIsoDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export function formatDate(value) {
  const d = parseDb(value);
  return d ? fmtDate.format(d) : '';
}
export function formatDateTime(value) {
  const d = parseDb(value);
  return d ? fmtDateTime.format(d) : '';
}
export function formatLong(value) {
  const d = parseDb(value);
  return d ? fmtLong.format(d) : '';
}
export function formatMonth(value) {
  const d = parseDb(value);
  return d ? fmtMonth.format(d) : '';
}
export function isoDate(value) {
  const d = parseDb(value);
  return d ? fmtIsoDate.format(d) : '';
}
export function toIso(value) {
  const d = parseDb(value);
  return d ? d.toISOString() : '';
}

export function timeAgo(value, now = new Date()) {
  const d = parseDb(value);
  if (!d) return '';
  const diff = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return 'hace un momento';
  const m = Math.floor(diff / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
  const years = Math.floor(days / 365);
  return years === 1 ? 'hace 1 año' : `hace ${years} años`;
}

export function daysBetween(a, b) {
  const da = parseDb(a);
  const db = parseDb(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
