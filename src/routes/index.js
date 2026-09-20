import express from 'express';
import { parseFilters, filtersToQuery } from '../utils/filters.js';
import { csvEscape, escapeHtml, excerpt } from '../utils/text.js';
import { toIso, formatDate } from '../utils/dates.js';
import { STATUSES, TYPES } from '../utils/constants.js';
import { RECURSOS, PASOS_RECLAMACION } from '../data/recursos.js';
import { requireRole } from '../middleware/auth.js';

export function indexRoutes({ config, services }) {
  const router = express.Router();
  // Estado del barrio y el informe son privados: los ve la moderación, que decide
  // qué compartir y cuándo. Lo decidió el usuario (18/09/2026).
  const soloModeracion = requireRole('moderador', 'admin');

  router.get('/', (req, res) => {
    const stats = services.stats.overview();
    const latest = services.posts.latest(6);
    const top = services.posts.topSupported(5);
    const cats = services.categories.withCounts().filter((c) => c.total > 0);
    const supported = services.posts.supportedIds(req.user?.id, [...latest, ...top].map((p) => p.id));
    res.render('pages/home', {
      pageMeta: { title: null, description: config.site.description },
      stats,
      latest,
      top,
      cats,
      supported,
      offers: services.offers.current({ limit: 3 }).items,
      offersCount: services.offers.countCurrent(),
      businessCount: services.businesses.count({ status: 'activo' }),
    });
  });

  router.get('/incidencias', (req, res) => {
    const filters = parseFilters(req.query, services.categories);
    const result = services.posts.list({ ...filters, perPage: config.perPage });
    const supported = services.posts.supportedIds(req.user?.id, result.items.map((p) => p.id));
    const title = filters.category
      ? `${filters.category.name} en ${config.site.name}`
      : filters.type ? `${TYPES[filters.type].plural} del barrio` : 'Incidencias y publicaciones del barrio';
    res.render('pages/feed', {
      pageMeta: { title, description: `Incidencias, propuestas, avisos y preguntas de los vecinos de ${config.site.name} (${config.site.municipality}), con apoyos y seguimiento de cada reclamación.` },
      filters,
      result,
      supported,
      qs: (overrides) => filtersToQuery(filters, overrides),
    });
  });

  router.get('/mapa', (req, res) => {
    const filters = parseFilters(req.query, services.categories);
    const count = services.posts.count({ ...filters, withLocation: true });
    res.render('pages/map', {
      pageMeta: { title: 'Mapa de incidencias del barrio', description: `Todas las incidencias de ${config.site.name} (${config.site.municipality}) situadas en el mapa, por estado y categoría.` },
      filters,
      count,
      qs: (overrides) => filtersToQuery(filters, overrides),
    });
  });

  router.get('/estadisticas', soloModeracion, (req, res) => {
    res.render('pages/stats', {
      pageMeta: { title: 'Estado del barrio', description: 'Cifras de incidencias abiertas, resueltas y tiempos de respuesta.' },
      stats: services.stats.overview(),
      byStatus: services.stats.byStatus(),
      byCategory: services.stats.byCategory(),
      byMonth: services.stats.byMonth(12),
      byType: services.stats.byType(),
      byEntity: services.stats.byEntity(),
      topOpen: services.posts.topSupported(5),
      oldestOpen: services.posts.list({ status: 'pendientes', sort: 'antiguas', perPage: 5 }).items,
    });
  });

  router.get('/informe', soloModeracion, (req, res) => {
    const filters = parseFilters(req.query, services.categories);
    const posts = services.posts.forReport(filters);
    const summary = summarize(posts);
    res.render('pages/report', {
      pageMeta: { title: 'Informe de incidencias', description: 'Informe imprimible para presentar al Ayuntamiento.' },
      filters,
      posts,
      summary,
      generatedAt: new Date(),
      qs: (overrides) => filtersToQuery(filters, overrides),
    });
  });

  router.get('/informe.csv', soloModeracion, (req, res) => {
    const filters = parseFilters(req.query, services.categories);
    const posts = services.posts.forReport(filters);
    const header = ['ID', 'Fecha', 'Tipo', 'Categoría', 'Título', 'Estado', 'Ubicación', 'Apoyos', 'Comentarios', 'Organismo responsable', 'Referencia oficial', 'Fecha reclamación', 'Fecha resolución', 'Enlace'];
    const lines = [header.join(';')];
    for (const p of posts) {
      lines.push(
        [
          p.id, formatDate(p.created_at), TYPES[p.type]?.label || p.type, p.category_name, p.title, STATUSES[p.status]?.label || p.status,
          p.location_text || '', p.support_count, p.comment_count, p.responsible_entity || '', p.official_reference || '',
          p.official_claim_date || '', p.resolved_at ? formatDate(p.resolved_at) : '', `${config.baseUrl}/incidencias/${p.slug}`,
        ]
          .map(csvEscape)
          .join(';')
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="informe-${config.site.name.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  });

  const STATIC_PAGES = {
    '/normas': { view: 'pages/rules', title: 'Normas de la comunidad', description: 'Normas de convivencia del foro vecinal: qué se puede publicar, cómo tratar a los demás y qué hace la moderación.' },
    '/sobre': { view: 'pages/about', title: 'Sobre este foro', description: `Qué es ${config.site.brand} ${config.site.name}, quién lo mantiene y para qué sirve: un foro vecinal independiente del barrio, en ${config.site.municipality}.` },
    '/recursos': { view: 'pages/resources', title: 'Recursos y contactos útiles', description: `Teléfonos, direcciones y pasos para reclamar ante el Ayuntamiento de ${config.site.municipality} y otros organismos.`, data: { recursos: RECURSOS, pasos: PASOS_RECLAMACION } },
    '/aviso-legal': { view: 'pages/legal', title: 'Aviso legal', description: 'Aviso legal del foro vecinal: titular, condiciones de uso y responsabilidad.' },
    '/privacidad': { view: 'pages/privacy', title: 'Política de privacidad', description: 'Qué datos guarda el foro, para qué, durante cuánto tiempo y cómo ejercer tus derechos.' },
    '/app': { view: 'pages/app', title: 'Instalar la app en el móvil', description: 'Instala el foro vecinal como una app en tu móvil, sin pasar por ninguna tienda y sin ocupar casi espacio.' },
  };
  for (const [route, page] of Object.entries(STATIC_PAGES)) {
    router.get(route, (req, res) => res.render(page.view, { pageMeta: { title: page.title, description: page.description }, ...(page.data || {}) }));
  }

  router.get('/feed.xml', (req, res) => {
    const posts = services.posts.latest(30);
    const items = posts
      .map(
        (p) => `
    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>${config.baseUrl}/incidencias/${p.slug}</link>
      <guid isPermaLink="true">${config.baseUrl}/incidencias/${p.slug}</guid>
      <pubDate>${new Date(toIso(p.created_at)).toUTCString()}</pubDate>
      <category>${escapeHtml(p.category_name)}</category>
      <description>${escapeHtml(excerpt(p.body, 300))}</description>
    </item>`
      )
      .join('');
    res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(`${config.site.brand} ${config.site.name}`)}</title>
    <link>${config.baseUrl}</link>
    <description>${escapeHtml(config.site.description)}</description>
    <language>es-ES</language>${items}
  </channel>
</rss>`);
  });

  /* Mapa del sitio para los buscadores: portada, secciones, categorías con
     contenido y cada publicación y negocio visibles, con su última fecha. */
  router.get('/sitemap.xml', (req, res) => {
    const fecha = (v) => (v ? toIso(v).slice(0, 10) : '');
    const entradas = [['/'], ['/incidencias'], ['/mapa'], ['/negocios'], ['/negocios/ofertas'], ...Object.keys(STATIC_PAGES).map((r) => [r])];
    const conteos = new Map(services.categories.withCounts().map((c) => [c.id, c.total]));
    for (const c of services.categories.all()) if (conteos.get(c.id) > 0) entradas.push([`/incidencias?categoria=${c.slug}`]);
    for (const p of services.posts.forSitemap()) entradas.push([`/incidencias/${p.slug}`, fecha(p.updated_at)]);
    for (const b of services.businesses.forSitemap()) entradas.push([`/negocios/${b.slug}`, fecha(b.updated_at)]);
    const cuerpo = entradas
      .map(([ruta, ultima]) => `  <url><loc>${escapeHtml(`${config.baseUrl}${ruta}`)}</loc>${ultima ? `<lastmod>${ultima}</lastmod>` : ''}</url>`)
      .join('\n');
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</urlset>\n`);
  });

  router.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /estadisticas\nDisallow: /informe\nDisallow: /perfil\nDisallow: /acceder\nDisallow: /registro\nDisallow: /api/\nDisallow: /planos/\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
  });

  return router;
}

function summarize(posts) {
  const s = { total: posts.length, abierta: 0, en_tramite: 0, resuelta: 0, cerrada: 0, supports: 0, withReference: 0, byCategory: new Map() };
  for (const p of posts) {
    s[p.status] = (s[p.status] || 0) + 1;
    s.supports += p.support_count;
    if (p.official_reference) s.withReference += 1;
    const c = s.byCategory.get(p.category_name) || { name: p.category_name, icon: p.category_icon, total: 0, pendientes: 0 };
    c.total += 1;
    if (p.status === 'abierta' || p.status === 'en_tramite') c.pendientes += 1;
    s.byCategory.set(p.category_name, c);
  }
  s.byCategory = [...s.byCategory.values()].sort((a, b) => b.total - a.total);
  s.pendientes = s.abierta + s.en_tramite;
  return s;
}
