import { OFFER_TYPES } from '../utils/constants.js';

const BASE_SELECT = `
  SELECT o.*, b.name AS business_name, b.slug AS business_slug, b.category AS business_category,
         b.logo AS business_logo, b.address AS business_address, b.status AS business_status
  FROM business_offers o
  JOIN businesses b ON b.id = o.business_id
`;

/** Vigente hoy: ya ha empezado y no ha terminado. */
const CURRENT = `
  o.is_hidden = 0
  AND (o.starts_on IS NULL OR o.starts_on <= date('now'))
  AND (o.ends_on IS NULL OR o.ends_on >= date('now'))
`;

export function createOffersService(db) {
  const service = {
    /** Ofertas, eventos y novedades vigentes de los comercios publicados. */
    current({ type = '', category = '', businessId = null, limit = 60, page = 1 } = {}) {
      const conds = [CURRENT, "b.status = 'activo'"];
      const params = [];
      if (OFFER_TYPES[type]) {
        conds.push('o.type = ?');
        params.push(type);
      }
      if (category) {
        conds.push('b.category = ?');
        params.push(category);
      }
      if (businessId) {
        conds.push('o.business_id = ?');
        params.push(businessId);
      }
      const where = `WHERE ${conds.join(' AND ')}`;
      const total = db.prepare(`SELECT COUNT(*) AS c FROM business_offers o JOIN businesses b ON b.id = o.business_id ${where}`).get(...params).c;
      const items = db
        .prepare(
          `${BASE_SELECT} ${where}
           ORDER BY CASE o.type WHEN 'evento' THEN 0 ELSE 1 END,
                    CASE WHEN o.type = 'evento' THEN o.starts_on END ASC,
                    o.created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, limit, (Math.max(1, page) - 1) * limit);
      return { items, total, page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / limit)) };
    },

    /** Todas las de un comercio, incluidas las caducadas, para su panel. */
    forBusiness(businessId, { onlyCurrent = false } = {}) {
      const where = onlyCurrent ? `WHERE o.business_id = ? AND ${CURRENT}` : 'WHERE o.business_id = ?';
      return db.prepare(`${BASE_SELECT} ${where} ORDER BY o.created_at DESC`).all(businessId);
    },

    getById(id) {
      return db.prepare(`${BASE_SELECT} WHERE o.id = ?`).get(id);
    },

    create(businessId, data) {
      const info = db
        .prepare(
          `INSERT INTO business_offers (business_id, type, title, body, price_text, starts_on, ends_on, event_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(businessId, data.type, data.title, data.body || null, data.priceText || null, data.startsOn || null, data.endsOn || null, data.eventTime || null);
      return service.getById(Number(info.lastInsertRowid));
    },

    update(id, data) {
      db.prepare(
        `UPDATE business_offers SET type = ?, title = ?, body = ?, price_text = ?, starts_on = ?, ends_on = ?,
           event_time = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(data.type, data.title, data.body || null, data.priceText || null, data.startsOn || null, data.endsOn || null, data.eventTime || null, id);
      return service.getById(id);
    },

    setImage(id, filename, thumb) {
      db.prepare('UPDATE business_offers SET image = ?, thumb = ? WHERE id = ?').run(filename, thumb, id);
    },

    setHidden(id, hidden) {
      db.prepare('UPDATE business_offers SET is_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
    },

    /** Elimina y devuelve los ficheros de imagen a borrar del disco. */
    remove(id) {
      const o = db.prepare('SELECT image, thumb FROM business_offers WHERE id = ?').get(id);
      db.prepare('DELETE FROM business_offers WHERE id = ?').run(id);
      return [o?.image, o?.thumb].filter(Boolean);
    },

    countCurrent() {
      return db
        .prepare(`SELECT COUNT(*) AS c FROM business_offers o JOIN businesses b ON b.id = o.business_id WHERE ${CURRENT} AND b.status = 'activo'`)
        .get().c;
    },
  };
  return service;
}
