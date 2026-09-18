import express from 'express';
import { apiLimiter } from '../middleware/limits.js';
import { parseFilters } from '../utils/filters.js';
import { STATUSES, TYPES, BUSINESS_CATEGORY_MAP } from '../utils/constants.js';

export function apiRoutes({ services }) {
  const router = express.Router();
  router.use(apiLimiter);

  router.get('/marcadores', (req, res) => {
    const filters = parseFilters(req.query, services.categories);
    const markers = services.posts.markers(filters).map((m) => ({
      id: m.id,
      slug: m.slug,
      title: m.title,
      status: m.status,
      statusLabel: STATUSES[m.status]?.label || m.status,
      color: STATUSES[m.status]?.color || '#64748b',
      type: m.type,
      typeLabel: TYPES[m.type]?.label || m.type,
      lat: m.lat,
      lng: m.lng,
      supports: m.support_count,
      comments: m.comment_count,
      category: m.category_name,
      categorySlug: m.category_slug,
      categoryColor: m.category_color,
      icon: m.category_icon,
      location: m.location_text,
      createdAt: m.created_at,
    }));
    res.set('Cache-Control', 'no-store');
    res.json({ count: markers.length, markers });
  });

  router.get('/negocios', (req, res) => {
    const category = String(req.query.categoria || '');
    const q = String(req.query.q || '').slice(0, 100);
    const withOffers = req.query.ofertas === '1';
    const markers = services.businesses.markers({ category, q, withOffers }).map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      category: b.category,
      categoryName: BUSINESS_CATEGORY_MAP[b.category]?.name || b.category,
      color: BUSINESS_CATEGORY_MAP[b.category]?.color || '#0f5c4c',
      lat: b.lat,
      lng: b.lng,
      address: b.address,
      shortDesc: b.short_desc,
      offers: Number(b.active_offers) || 0,
      logo: b.logo,
    }));
    res.set('Cache-Control', 'no-store');
    res.json({ count: markers.length, markers });
  });

  router.get('/estadisticas', (req, res) => {
    res.json({
      overview: services.stats.overview(),
      byStatus: services.stats.byStatus(),
      byCategory: services.stats.byCategory(),
      byMonth: services.stats.byMonth(12),
    });
  });

  router.get('/salud', (req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      // Cuántos vecinos tienen el foro abierto ahora mismo. Sirve para vigilar
      // el servidor y para saber si las conexiones en vivo se están acumulando.
      enVivo: services.events.conectados(),
    });
  });

  return router;
}
