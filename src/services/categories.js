export function createCategoriesService(db) {
  /* Las categorías se consultan en cada visita y solo cambian al reiniciar,
     así que se guardan en memoria. invalidate() las vuelve a leer. */
  let cache = null;
  let porSlug = null;
  let porId = null;

  function load() {
    if (cache) return cache;
    cache = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, name').all();
    porSlug = new Map(cache.map((c) => [c.slug, c]));
    porId = new Map(cache.map((c) => [c.id, c]));
    return cache;
  }

  return {
    invalidate() {
      cache = null;
      porSlug = null;
      porId = null;
    },
    all() {
      return load();
    },
    bySlug(slug) {
      load();
      return porSlug.get(String(slug || ''));
    },
    byId(id) {
      load();
      return porId.get(Number(id));
    },
    withCounts() {
      return db
        .prepare(
          `SELECT c.*, COUNT(p.id) AS total,
              SUM(CASE WHEN p.status IN ('abierta','en_tramite') THEN 1 ELSE 0 END) AS pendientes
           FROM categories c
           LEFT JOIN posts p ON p.category_id = c.id AND p.is_hidden = 0
           WHERE c.is_active = 1
           GROUP BY c.id ORDER BY c.sort_order, c.name`
        )
        .all();
    },
  };
}
