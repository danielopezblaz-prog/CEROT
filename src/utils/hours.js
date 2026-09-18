import { WEEKDAYS, WEEKDAYS_SHORT } from './constants.js';

const TZ = 'Europe/Madrid';
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Horario vacío: siete días cerrados. Índice 0 = lunes. */
export function emptyHours() {
  return WEEKDAYS.map(() => ({ closed: true, ranges: [] }));
}

function cleanRange(from, to) {
  if (!TIME_RE.test(String(from ?? '')) || !TIME_RE.test(String(to ?? ''))) return null;
  if (String(to) <= String(from)) return null;
  return [String(from), String(to)];
}

/** Lee el horario guardado en la base de datos. Tolera datos ausentes o corruptos. */
export function parseHours(json) {
  let raw;
  try {
    raw = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return emptyHours();
  }
  if (!Array.isArray(raw) || raw.length !== 7) return emptyHours();
  return raw.map((day) => {
    const ranges = Array.isArray(day?.ranges)
      ? day.ranges.map((r) => cleanRange(r?.[0], r?.[1])).filter(Boolean).slice(0, 2)
      : [];
    return { closed: ranges.length === 0, ranges };
  });
}

/** Construye el horario a partir de los campos del formulario. */
export function hoursFromForm(body) {
  return WEEKDAYS.map((_, i) => {
    if (body[`cerrado_${i}`]) return { closed: true, ranges: [] };
    const ranges = [cleanRange(body[`desde1_${i}`], body[`hasta1_${i}`]), cleanRange(body[`desde2_${i}`], body[`hasta2_${i}`])].filter(Boolean);
    return { closed: ranges.length === 0, ranges };
  });
}

export function hasAnyHours(hours) {
  return hours.some((d) => !d.closed);
}

/** Momento actual en el huso de Madrid: día de la semana (0 = lunes) y minutos desde medianoche. */
function nowInMadrid(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const day = map[get('weekday')] ?? 0;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { day, minutes: hour * 60 + minute };
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMinutes = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Estado de apertura ahora mismo.
 * Devuelve { known, open, label, detail } listo para pintar una etiqueta.
 */
export function openState(hours, now = new Date()) {
  if (!hasAnyHours(hours)) return { known: false, open: false, label: '', detail: '' };
  const { day, minutes } = nowInMadrid(now);

  for (const [from, to] of hours[day].ranges) {
    if (minutes >= toMinutes(from) && minutes < toMinutes(to)) {
      const closesIn = toMinutes(to) - minutes;
      return {
        known: true,
        open: true,
        label: 'Abierto ahora',
        detail: closesIn <= 60 ? `Cierra en ${closesIn} min` : `Cierra a las ${to}`,
      };
    }
  }

  // Siguiente apertura, buscando hasta una semana por delante
  for (let ahead = 0; ahead < 8; ahead += 1) {
    const d = (day + ahead) % 7;
    for (const [from] of hours[d].ranges) {
      const start = toMinutes(from);
      if (ahead === 0 && start <= minutes) continue;
      if (ahead === 0) return { known: true, open: false, label: 'Cerrado', detail: `Abre hoy a las ${from}` };
      if (ahead === 1) return { known: true, open: false, label: 'Cerrado', detail: `Abre mañana a las ${from}` };
      return { known: true, open: false, label: 'Cerrado', detail: `Abre el ${WEEKDAYS[d].toLowerCase()} a las ${from}` };
    }
  }
  return { known: true, open: false, label: 'Cerrado', detail: '' };
}

/** Texto de un día: "09:00 a 14:00 y 17:00 a 20:30" o "Cerrado". */
export function dayText(day) {
  if (!day || day.closed || !day.ranges.length) return 'Cerrado';
  return day.ranges.map(([a, b]) => `${a} a ${b}`).join(' y ');
}

/** Agrupa días seguidos con el mismo horario: "Lunes a viernes: 09:00 a 14:00". */
export function groupedHours(hours) {
  const rows = [];
  let start = 0;
  for (let i = 1; i <= 7; i += 1) {
    const same = i < 7 && dayText(hours[i]) === dayText(hours[start]);
    if (!same) {
      rows.push({
        label: start === i - 1 ? WEEKDAYS[start] : `${WEEKDAYS[start]} a ${WEEKDAYS[i - 1].toLowerCase()}`,
        short: start === i - 1 ? WEEKDAYS_SHORT[start] : `${WEEKDAYS_SHORT[start]}-${WEEKDAYS_SHORT[i - 1]}`,
        text: dayText(hours[start]),
        closed: hours[start].closed,
      });
      start = i;
    }
  }
  return rows;
}

export { fromMinutes };
