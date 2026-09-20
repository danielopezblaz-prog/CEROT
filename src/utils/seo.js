import { excerpt } from './text.js';
import { toIso } from './dates.js';
import { BUSINESS_CATEGORY_MAP } from './constants.js';

/*
 * Lo que el foro le cuenta a Google y al resto de buscadores: fichas
 * estructuradas (schema.org, en JSON-LD) y textos limpios para las
 * descripciones. Un bloque <script type="application/ld+json"> no se ejecuta,
 * así que la CSP sin 'unsafe-inline' no lo bloquea.
 */

const DIAS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* Tipo de schema.org más concreto para cada categoría del directorio. Todos
   son variantes de LocalBusiness, que es lo que Google entiende. */
const TIPO_NEGOCIO = {
  alimentacion: 'GroceryStore',
  panaderia: 'Bakery',
  bar: 'Restaurant',
  cafeteria: 'CafeOrCoffeeShop',
  peluqueria: 'HairSalon',
  moda: 'ClothingStore',
  farmacia: 'Pharmacy',
  salud: 'HealthAndBeautyBusiness',
  ferreteria: 'HardwareStore',
  papeleria: 'Store',
  deportes: 'SportsActivityLocation',
  servicios: 'ProfessionalService',
  talleres: 'AutoRepair',
  mascotas: 'PetStore',
};

function direccion(config, calle) {
  const d = { '@type': 'PostalAddress', addressLocality: config.site.municipality, addressRegion: 'Madrid', addressCountry: 'ES' };
  if (calle) d.streetAddress = calle;
  return d;
}

/** Texto plano y corto de lo que escribe un vecino, para descripciones. */
export function textoPlano(texto, max = 160) {
  return excerpt(String(texto ?? ''), max);
}

/** Quién publica esta web. Va en todas las páginas. */
export function fichaSitio(config) {
  const nombre = `${config.site.brand} ${config.site.name}`;
  const organizacion = {
    '@type': 'Organization',
    '@id': `${config.baseUrl}/#organizacion`,
    name: nombre,
    alternateName: [config.site.name, `${config.site.brand} ${config.site.municipality}`],
    url: `${config.baseUrl}/`,
    logo: `${config.baseUrl}/img/icon-512.png`,
    description: config.site.description,
    areaServed: { '@type': 'City', name: config.site.municipality, address: direccion(config) },
  };
  if (config.site.contactEmail) organizacion.email = config.site.contactEmail;
  const web = {
    '@type': 'WebSite',
    '@id': `${config.baseUrl}/#web`,
    name: nombre,
    alternateName: config.site.name,
    url: `${config.baseUrl}/`,
    inLanguage: 'es',
    description: config.site.description,
    publisher: { '@id': `${config.baseUrl}/#organizacion` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${config.baseUrl}/incidencias?q={termino}` },
      'query-input': 'required name=termino',
    },
  };
  return [organizacion, web];
}

/** Migas de pan: [[nombre, ruta], ...] desde la portada hasta la página actual. */
export function migas(config, tramos) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: tramos.map(([nombre, ruta], i) => ({ '@type': 'ListItem', position: i + 1, name: nombre, item: `${config.baseUrl}${ruta}` })),
  };
}

/** Una publicación del foro, con sus apoyos, comentarios y fotos. */
export function fichaPublicacion(config, post, images = [], comments = []) {
  const url = `${config.baseUrl}/incidencias/${post.slug}`;
  const ficha = {
    '@type': 'DiscussionForumPosting',
    '@id': url,
    url,
    mainEntityOfPage: url,
    headline: post.title,
    text: String(post.body || '').trim(),
    inLanguage: 'es',
    datePublished: toIso(post.created_at),
    dateModified: toIso(post.updated_at || post.created_at),
    author: { '@type': 'Person', name: post.author_name || 'Vecino/a' },
    publisher: { '@id': `${config.baseUrl}/#organizacion` },
    isPartOf: { '@id': `${config.baseUrl}/#web` },
    articleSection: post.category_name,
    keywords: [post.category_name, config.site.name, config.site.municipality].filter(Boolean).join(', '),
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: Number(post.support_count) || 0 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: Number(post.comment_count) || 0 },
    ],
  };
  if (images.length) ficha.image = images.map((i) => `${config.baseUrl}/uploads/${i.filename}`);
  const conPunto = post.lat !== null && post.lat !== undefined && post.lng !== null && post.lng !== undefined;
  if (post.location_text || conPunto) {
    ficha.contentLocation = { '@type': 'Place', name: post.location_text || config.site.name, address: direccion(config) };
    if (conPunto) ficha.contentLocation.geo = { '@type': 'GeoCoordinates', latitude: post.lat, longitude: post.lng };
  }
  const visibles = comments.filter((c) => !c.is_hidden).slice(-10);
  if (visibles.length) {
    ficha.comment = visibles.map((c) => ({
      '@type': 'Comment',
      text: String(c.body || '').trim(),
      dateCreated: toIso(c.created_at),
      author: { '@type': 'Person', name: c.author_name || 'Vecino/a' },
    }));
  }
  return ficha;
}

/** Un negocio del directorio: dirección, horario, teléfono y enlaces. */
export function fichaNegocio(config, business, hours = []) {
  const url = `${config.baseUrl}/negocios/${business.slug}`;
  const ficha = {
    '@type': TIPO_NEGOCIO[business.category] || 'LocalBusiness',
    '@id': url,
    url,
    name: business.name,
    address: direccion(config, business.address),
    areaServed: config.site.name,
  };
  const descripcion = textoPlano(business.short_desc || business.description || '', 300);
  if (descripcion) ficha.description = descripcion;
  const categoria = BUSINESS_CATEGORY_MAP[business.category];
  if (categoria) ficha.keywords = `${categoria.name}, ${config.site.name}, ${config.site.municipality}`;
  const conPunto = business.lat !== null && business.lat !== undefined && business.lng !== null && business.lng !== undefined;
  if (conPunto) ficha.geo = { '@type': 'GeoCoordinates', latitude: business.lat, longitude: business.lng };
  if (business.phone) ficha.telephone = business.phone;
  if (business.email) ficha.email = business.email;
  const imagenes = [business.cover, business.logo].filter(Boolean).map((f) => `${config.baseUrl}/uploads/${f}`);
  if (imagenes.length) ficha.image = imagenes;
  if (business.logo) ficha.logo = `${config.baseUrl}/uploads/${business.logo}`;
  const enlaces = [
    business.website,
    business.instagram ? `https://instagram.com/${business.instagram}` : null,
    business.facebook,
  ].filter(Boolean);
  if (enlaces.length) ficha.sameAs = enlaces;
  const horario = [];
  hours.forEach((dia, i) => {
    for (const [abre, cierra] of dia?.ranges || []) horario.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: DIAS[i], opens: abre, closes: cierra });
  });
  if (horario.length) ficha.openingHoursSpecification = horario;
  return ficha;
}

/** Todas las fichas de una página en un solo bloque, listas para incrustar. */
export function jsonLd(fichas) {
  const lista = (Array.isArray(fichas) ? fichas : [fichas]).filter(Boolean);
  // Un «</script>» escrito por un vecino no puede cerrar el bloque: se escapan
  // los signos que lo permitirían.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': lista })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
