import { uniqueSlug } from '../utils/text.js';
import { BUSINESS_CATEGORY_MAP, BUSINESS_STATUSES } from '../utils/constants.js';

const BASE_SELECT = `
  SELECT b.*, u.name AS owner_name,
         (SELECT COUNT(*) FROM business_offers o
            WHERE o.business_id = b.id AND o.is_hidden = 0
              AND (o.ends_on IS NULL OR o.ends_on >= date('now'))
              AND (o.starts_on IS NULL OR o.starts_on <= date('now'))) AS active_offers,
         (SELECT COUNT(*) FROM business_products pr
            WHERE pr.business_id = b.id AND pr.is_available = 1 AND pr.image IS NOT NULL) AS product_count,
         (SELECT pr.thumb FROM business_products pr
            WHERE pr.business_id = b.id AND pr.is_available = 1 AND pr.thumb IS NOT NULL
            ORDER BY pr.is_featured DESC, pr.sort_order, pr.id LIMIT 1) AS product_thumb
  FROM businesses b
  JOIN users u ON u.id = b.owner_id
`;

/* El id desempata: sin él, dos altas del mismo segundo saldrían en orden aleatorio. */
const ORDER = {
  recientes: 'b.created_at DESC, b.id DESC',
  alfabetico: 'b.name COLLATE NOCASE ASC, b.id ASC',
  ofertas: 'active_offers DESC, b.name COLLATE NOCASE ASC, b.id ASC',
  visitas: 'b.views DESC, b.name COLLATE NOCASE ASC, b.id ASC',
};

function buildWhere(f = {}) {
  const conds = [];
  const params = [];
  if (f.status && BUSINESS_STATUSES[f.status]) {
    conds.push('b.status = ?');
    params.push(f.status);
  } else if (!f.includeAll) {
    conds.push("b.status = 'activo'");
  }
  if (f.category && BUSINESS_CATEGORY_MAP[f.category]) {
    conds.push('b.category = ?');
    params.push(f.category);
  }
  if (f.ownerId) {
    conds.push('b.owner_id = ?');
    params.push(f.ownerId);
  }
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push('(b.name LIKE ? OR b.short_desc LIKE ? OR b.description LIKE ? OR b.address LIKE ?)');
    params.push(like, like, like, like);
  }
  if (f.withOffers) conds.push('active_offers > 0');
  if (f.withLocation) conds.push('b.lat IS NOT NULL AND b.lng IS NOT NULL');
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export function createBusinessesService(db) {
  const service = {
    list(filters = {}) {
      const page = Math.max(1, Number(filters.page) || 1);
      const perPage = Math.min(60, Math.max(1, Number(filters.perPage) || 12));
      const order = ORDER[filters.sort] || ORDER.alfabetico;
      const total = service.count(filters);
      const { where, params } = buildWhere(filters);
      const items = db
        .prepare(`${BASE_SELECT} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...params, perPage, (page - 1) * perPage);
      return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
    },

    /**
     * Contar no necesita las subconsultas de ofertas y productos, que se
     * calculan fila a fila. Solo se usan cuando el filtro las requiere.
     */
    count(filters = {}) {
      const { where, params } = buildWhere(filters);
      const from = filters.withOffers
        ? `(${BASE_SELECT} ${where})`
        : `businesses b JOIN users u ON u.id = b.owner_id ${where}`;
      return db.prepare(`SELECT COUNT(*) AS c FROM ${from}`).get(...params).c;
    },

    getBySlug(slug) {
      return db.prepare(`${BASE_SELECT} WHERE b.slug = ?`).get(String(slug || ''));
    },

    getById(id) {
      return db.prepare(`${BASE_SELECT} WHERE b.id = ?`).get(id);
    },

    /** Categorías con el número de comercios publicados. */
    categoriesWithCounts() {
      const rows = db
        .prepare("SELECT category, COUNT(*) AS total FROM businesses WHERE status = 'activo' GROUP BY category")
        .all();
      return Object.fromEntries(rows.map((r) => [r.category, Number(r.total)]));
    },

    create(data, ownerId, { status = 'pendiente' } = {}) {
      const info = db
        .prepare(
          `INSERT INTO businesses (slug, name, category, short_desc, description, address, lat, lng,
             phone, whatsapp, email, website, instagram, facebook, hours, owner_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          uniqueSlug(data.name), data.name, data.category, data.shortDesc || null, data.description || null,
          data.address || null, data.lat ?? null, data.lng ?? null, data.phone || null, data.whatsapp || null,
          data.email || null, data.website || null, data.instagram || null, data.facebook || null,
          JSON.stringify(data.hours ?? []), ownerId, status
        );
      return service.getById(Number(info.lastInsertRowid));
    },

    update(id, data) {
      db.prepare(
        `UPDATE businesses SET name = ?, category = ?, short_desc = ?, description = ?, address = ?, lat = ?, lng = ?,
           phone = ?, whatsapp = ?, email = ?, website = ?, instagram = ?, facebook = ?, hours = ?,
           updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        data.name, data.category, data.shortDesc || null, data.description || null, data.address || null,
        data.lat ?? null, data.lng ?? null, data.phone || null, data.whatsapp || null, data.email || null,
        data.website || null, data.instagram || null, data.facebook || null, JSON.stringify(data.hours ?? []), id
      );
      return service.getById(id);
    },

    setStatus(id, status, note = null) {
      db.prepare("UPDATE businesses SET status = ?, moderation_note = ?, updated_at = datetime('now') WHERE id = ?").run(status, note, id);
      return service.getById(id);
    },

    setLogo(id, filename) {
      db.prepare('UPDATE businesses SET logo = ? WHERE id = ?').run(filename, id);
    },

    setCover(id, filename, thumb) {
      db.prepare('UPDATE businesses SET cover = ?, cover_thumb = ? WHERE id = ?').run(filename, thumb, id);
    },

    incrementViews(id) {
      db.prepare('UPDATE businesses SET views = views + 1 WHERE id = ?').run(id);
    },

    images(businessId) {
      return db.prepare('SELECT * FROM business_images WHERE business_id = ? ORDER BY sort_order, id').all(businessId);
    },

    imageCount(businessId) {
      return db.prepare('SELECT COUNT(*) AS c FROM business_images WHERE business_id = ?').get(businessId).c;
    },

    addImages(businessId, images) {
      const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM business_images WHERE business_id = ?').get(businessId).m;
      const insert = db.prepare('INSERT INTO business_images (business_id, filename, thumb, sort_order) VALUES (?, ?, ?, ?)');
      db.transaction(() => {
        images.forEach((img, i) => insert.run(businessId, img.filename, img.thumb, max + 1 + i));
      })();
    },

    removeImage(imageId, businessId) {
      const img = db.prepare('SELECT * FROM business_images WHERE id = ? AND business_id = ?').get(imageId, businessId);
      if (!img) return null;
      db.prepare('DELETE FROM business_images WHERE id = ?').run(imageId);
      return img;
    },

    /** Borra el comercio y devuelve los ficheros a eliminar del disco. */
    remove(id) {
      return db.transaction(() => {
        const b = db.prepare('SELECT logo, cover, cover_thumb FROM businesses WHERE id = ?').get(id);
        const gallery = db.prepare('SELECT filename, thumb FROM business_images WHERE business_id = ?').all(id);
        const offers = db.prepare('SELECT image, thumb FROM business_offers WHERE business_id = ?').all(id);
        const products = db.prepare('SELECT image, thumb FROM business_products WHERE business_id = ?').all(id);
        db.prepare('DELETE FROM businesses WHERE id = ?').run(id);
        return [
          b?.logo, b?.cover, b?.cover_thumb,
          ...gallery.flatMap((g) => [g.filename, g.thumb]),
          ...offers.flatMap((o) => [o.image, o.thumb]),
          ...products.flatMap((p) => [p.image, p.thumb]),
        ].filter(Boolean);
      })();
    },

    ownedBy(userId) {
      return db.prepare(`${BASE_SELECT} WHERE b.owner_id = ? ORDER BY b.created_at DESC`).all(userId);
    },

    countPending() {
      return db.prepare("SELECT COUNT(*) AS c FROM businesses WHERE status = 'pendiente'").get().c;
    },

    markers(filters = {}) {
      const { where, params } = buildWhere({ ...filters, withLocation: true });
      return db.prepare(`${BASE_SELECT} ${where} ORDER BY b.name LIMIT 500`).all(...params);
    },

    /** Comercios de ejemplo, para el borrado del contenido de demostración. */
    purgeDemo() {
      return db.transaction(() => {
        const ids = db.prepare('SELECT id FROM businesses WHERE is_demo = 1').all().map((r) => r.id);
        const files = [];
        for (const id of ids) files.push(...service.remove(id));
        return files;
      })();
    },

    countDemo() {
      return db.prepare('SELECT COUNT(*) AS c FROM businesses WHERE is_demo = 1').get().c;
    },
  };
  return service;
}
