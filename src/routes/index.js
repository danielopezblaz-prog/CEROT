import express from 'express';
import { parseFilters, filtersToQuery } from '../utils/filters.js';
import { csvEscape, escapeHtml, excerpt } from '../utils/text.js';
import { toIso, formatDate } from '../utils/dates.js';
import { STATUSES, TYPES } from '../utils/constants.js';
import { RECURSOS, PASOS_RECLAMACION } from '../data/recursos.js';

export function indexRoutes({ config, services }) {
  const router = express.Router();

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
    const title = filters.category ? `${filters.category.name}` : filters.type ? TYPES[filters.type].plural : 'Todas las publicaciones';
    res.render('pages/feed', {
      pageMeta: { title, description: `Publicaciones vecinales de ${config.site.name}: incidencias, propuestas, avisos y preguntas.` },
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
      pageMeta: { title: 'Mapa del barrio', description: 'Todas las incidencias del barrio situadas en el mapa.' },
      filters,
      count,
      qs: (overrides) => filtersToQuery(filters, overrides),
    });
  });

  router.get('/estadisticas', (req, res) => {
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

  router.get('/informe', (req, res) => {
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

  router.get('/informe.csv', (req, res) => {
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
    '/normas': { view: 'pages/rules', title: 'Normas de la comunidad' },
    '/sobre': { view: 'pages/about', title: 'Sobre este foro' },
    '/recursos': { view: 'pages/resources', title: 'Recursos y contactos útiles', data: { recursos: RECURSOS, pasos: PASOS_RECLAMACION } },
    '/aviso-legal': { view: 'pages/legal', title: 'Aviso legal' },
    '/privacidad': { view: 'pages/privacy', title: 'Política de privacidad' },
    '/app': { view: 'pages/app', title: 'Instalar la app en el móvil' },
  };
  for (const [route, page] of Object.entries(STATIC_PAGES)) {
    router.get(route, (req, res) => res.render(page.view, { pageMeta: { title: page.title }, ...(page.data || {}) }));
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

  router.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /perfil\nDisallow: /acceder\nDisallow: /registro\nSitemap: ${config.baseUrl}/feed.xml\n`);
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
