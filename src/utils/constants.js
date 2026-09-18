export const STATUSES = {
  abierta: { key: 'abierta', label: 'Abierta', color: '#dc2626', bg: '#fee2e2', description: 'Publicada y pendiente de respuesta.' },
  en_tramite: { key: 'en_tramite', label: 'En trámite', color: '#b45309', bg: '#fef3c7', description: 'Hay una gestión o reclamación oficial en curso.' },
  resuelta: { key: 'resuelta', label: 'Resuelta', color: '#15803d', bg: '#dcfce7', description: 'El problema se ha solucionado.' },
  cerrada: { key: 'cerrada', label: 'Cerrada', color: '#475569', bg: '#e2e8f0', description: 'Cerrada sin solución o ya no aplica.' },
};

export const TYPES = {
  incidencia: { key: 'incidencia', label: 'Incidencia', plural: 'Incidencias', icon: '⚠️', description: 'Algo que está mal y debe arreglarse.' },
  propuesta: { key: 'propuesta', label: 'Propuesta', plural: 'Propuestas', icon: '💡', description: 'Una idea para mejorar el barrio.' },
  aviso: { key: 'aviso', label: 'Aviso', plural: 'Avisos', icon: '📢', description: 'Información útil para los vecinos.' },
  pregunta: { key: 'pregunta', label: 'Pregunta', plural: 'Preguntas', icon: '❓', description: 'Una duda sobre el barrio o un trámite.' },
};

export const ENTITIES = [
  'Ayuntamiento de Leganés',
  'Comunidad de Madrid',
  'Canal de Isabel II',
  'Consorcio de Transportes / EMT',
  'Compañía eléctrica o de gas',
  'Operador de telecomunicaciones',
  'Comunidad de propietarios',
  'Otro / no lo sé',
];

export const SORTS = {
  recientes: { key: 'recientes', label: 'Más recientes' },
  apoyos: { key: 'apoyos', label: 'Más apoyadas' },
  comentadas: { key: 'comentadas', label: 'Más comentadas' },
  antiguas: { key: 'antiguas', label: 'Más antiguas' },
};

export const REPORT_REASONS = {
  spam: 'Publicidad o spam',
  ofensivo: 'Contenido ofensivo o insultos',
  datos: 'Datos personales de terceros',
  falso: 'Información falsa',
  otro: 'Otro motivo',
};

export const ROLES = {
  vecino: 'Vecino/a',
  moderador: 'Moderador/a',
  admin: 'Administrador/a',
};

/* ---------- Locales y comercios del barrio ---------- */

export const BUSINESS_CATEGORIES = [
  { slug: 'alimentacion', name: 'Alimentación', color: '#0e7490' },
  { slug: 'panaderia', name: 'Panadería y pastelería', color: '#b45309' },
  { slug: 'bar', name: 'Bares y restaurantes', color: '#c2410c' },
  { slug: 'cafeteria', name: 'Cafeterías', color: '#92400e' },
  { slug: 'peluqueria', name: 'Peluquería y estética', color: '#be185d' },
  { slug: 'moda', name: 'Moda y complementos', color: '#7c3aed' },
  { slug: 'farmacia', name: 'Farmacia y parafarmacia', color: '#15803d' },
  { slug: 'salud', name: 'Salud y bienestar', color: '#0369a1' },
  { slug: 'ferreteria', name: 'Ferretería y hogar', color: '#57534e' },
  { slug: 'papeleria', name: 'Papelería y librería', color: '#4338ca' },
  { slug: 'deportes', name: 'Deporte y gimnasios', color: '#1d4ed8' },
  { slug: 'servicios', name: 'Servicios profesionales', color: '#475569' },
  { slug: 'talleres', name: 'Talleres y automoción', color: '#334155' },
  { slug: 'educacion', name: 'Academias y educación', color: '#0f766e' },
  { slug: 'mascotas', name: 'Mascotas', color: '#a16207' },
  { slug: 'otros', name: 'Otros comercios', color: '#64748b' },
];

export const BUSINESS_CATEGORY_MAP = Object.fromEntries(BUSINESS_CATEGORIES.map((c) => [c.slug, c]));

export const BUSINESS_STATUSES = {
  pendiente: { key: 'pendiente', label: 'Pendiente de revisión', color: '#b45309', bg: '#fef3c7', description: 'Aún no es visible para los vecinos.' },
  activo: { key: 'activo', label: 'Publicado', color: '#15803d', bg: '#dcfce7', description: 'Visible en el directorio del barrio.' },
  suspendido: { key: 'suspendido', label: 'Suspendido', color: '#475569', bg: '#e2e8f0', description: 'Retirado del directorio por la moderación.' },
};

export const OFFER_TYPES = {
  oferta: { key: 'oferta', label: 'Oferta', plural: 'Ofertas', icon: 'tag', description: 'Un descuento o un precio especial.' },
  evento: { key: 'evento', label: 'Evento', plural: 'Eventos', icon: 'calendar', description: 'Una actividad con fecha y hora.' },
  novedad: { key: 'novedad', label: 'Novedad', plural: 'Novedades', icon: 'sparkles', description: 'Algo nuevo que quieres contar.' },
};

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const CATEGORY_SEED = [
  { slug: 'limpieza', name: 'Limpieza y residuos', icon: '🧹', color: '#0e7490' },
  { slug: 'alumbrado', name: 'Alumbrado', icon: '💡', color: '#ca8a04' },
  { slug: 'calles', name: 'Calles y aceras', icon: '🛣️', color: '#57534e' },
  { slug: 'parques', name: 'Parques y zonas verdes', icon: '🌳', color: '#15803d' },
  { slug: 'seguridad', name: 'Seguridad y convivencia', icon: '🚨', color: '#b91c1c' },
  { slug: 'ruido', name: 'Ruido', icon: '🔊', color: '#7c3aed' },
  { slug: 'trafico', name: 'Tráfico y aparcamiento', icon: '🚗', color: '#1d4ed8' },
  { slug: 'transporte', name: 'Transporte público', icon: '🚌', color: '#0f766e' },
  { slug: 'obras', name: 'Obras y urbanismo', icon: '🏗️', color: '#c2410c' },
  { slug: 'tramites', name: 'Trámites y atención ciudadana', icon: '📋', color: '#4338ca' },
  { slug: 'agua', name: 'Agua y saneamiento', icon: '💧', color: '#0369a1' },
  { slug: 'servicios', name: 'Servicios públicos (salud, educación, mayores)', icon: '🏫', color: '#be185d' },
  { slug: 'animales', name: 'Animales y plagas', icon: '🐾', color: '#92400e' },
  { slug: 'otros', name: 'Otros', icon: '📌', color: '#64748b' },
];
