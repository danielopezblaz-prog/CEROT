/**
 * Catálogo de productos de un negocio: una foto, un nombre y un precio.
 * El orden lo decide quien gestiona el negocio; los destacados van primero.
 */
const ORDER = 'p.is_featured DESC, p.sort_order ASC, p.id ASC';

export function createProductsService(db) {
  const service = {
    forBusiness(businessId, { onlyAvailable = false } = {}) {
      const cond = onlyAvailable ? 'AND p.is_available = 1' : '';
      return db.prepare(`SELECT p.* FROM business_products p WHERE p.business_id = ? ${cond} ORDER BY ${ORDER}`).all(businessId);
    },

    getById(id, businessId) {
      return db.prepare('SELECT * FROM business_products WHERE id = ? AND business_id = ?').get(id, businessId);
    },

    count(businessId) {
      return db.prepare('SELECT COUNT(*) AS c FROM business_products WHERE business_id = ?').get(businessId).c;
    },

    countUnnamed(businessId) {
      return db.prepare("SELECT COUNT(*) AS c FROM business_products WHERE business_id = ? AND TRIM(name) = ''").get(businessId).c;
    },

    nextOrder(businessId) {
      return db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM business_products WHERE business_id = ?').get(businessId).n;
    },

    create(businessId, data) {
      const info = db
        .prepare(
          `INSERT INTO business_products (business_id, name, description, price_text, image, thumb, is_available, is_featured, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          businessId, data.name || '', data.description || null, data.priceText || null,
          data.image || null, data.thumb || null,
          data.isAvailable === false ? 0 : 1, data.isFeatured ? 1 : 0,
          data.sortOrder ?? service.nextOrder(businessId)
        );
      return service.getById(Number(info.lastInsertRowid), businessId);
    },

    /** Crea un producto por cada foto subida en bloque, sin nombre todavía. */
    createFromImages(businessId, images) {
      let order = service.nextOrder(businessId);
      const insert = db.prepare(
        "INSERT INTO business_products (business_id, name, image, thumb, sort_order) VALUES (?, '', ?, ?, ?)"
      );
      db.transaction(() => {
        for (const img of images) insert.run(businessId, img.filename, img.thumb, order++);
      })();
      return images.length;
    },

    setImage(id, businessId, filename, thumb) {
      db.prepare("UPDATE business_products SET image = ?, thumb = ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?")
        .run(filename, thumb, id, businessId);
    },

    /** Guarda de una vez los cambios de la tabla de productos. */
    saveAll(businessId, rows) {
      const stmt = db.prepare(
        `UPDATE business_products SET name = ?, price_text = ?, description = ?, is_available = ?, is_featured = ?,
           updated_at = datetime('now')
         WHERE id = ? AND business_id = ?`
      );
      db.transaction(() => {
        for (const r of rows) {
          stmt.run(r.name, r.priceText || null, r.description || null, r.isAvailable ? 1 : 0, r.isFeatured ? 1 : 0, r.id, businessId);
        }
      })();
    },

    /** Mueve un producto una posición arriba o abajo intercambiando el orden con su vecino. */
    move(id, businessId, direction) {
      return db.transaction(() => {
        const list = service.forBusiness(businessId);
        const i = list.findIndex((p) => p.id === Number(id));
        const j = direction === 'subir' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= list.length) return false;
        // Reasigna el orden completo según la nueva secuencia, para que quede consistente.
        const reordered = [...list];
        [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
        const stmt = db.prepare('UPDATE business_products SET sort_order = ?, is_featured = ? WHERE id = ? AND business_id = ?');
        reordered.forEach((p, k) => stmt.run(k, 0, p.id, businessId));
        return true;
      })();
    },

    /** Elimina el producto y devuelve sus ficheros para borrarlos del disco. */
    remove(id, businessId) {
      const p = service.getById(id, businessId);
      if (!p) return [];
      db.prepare('DELETE FROM business_products WHERE id = ? AND business_id = ?').run(id, businessId);
      return [p.image, p.thumb].filter(Boolean);
    },

    countAllAvailable() {
      return db
        .prepare(
          "SELECT COUNT(*) AS c FROM business_products p JOIN businesses b ON b.id = p.business_id WHERE p.is_available = 1 AND b.status = 'activo' AND p.image IS NOT NULL"
        )
        .get().c;
    },

    /** Escaparate de productos de todo el barrio, para la portada de la sección. */
    showcase(limit = 12) {
      return db
        .prepare(
          `SELECT p.*, b.name AS business_name, b.slug AS business_slug, b.category AS business_category
           FROM business_products p JOIN businesses b ON b.id = p.business_id
           WHERE p.is_available = 1 AND b.status = 'activo' AND p.image IS NOT NULL AND TRIM(p.name) != ''
           ORDER BY p.is_featured DESC, p.updated_at DESC LIMIT ?`
        )
        .all(limit);
    },
  };
  return service;
}
