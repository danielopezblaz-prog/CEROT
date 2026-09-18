import { uniqueSlug } from '../utils/text.js';
import { STATUSES, TYPES } from '../utils/constants.js';

const BASE_SELECT = `
  SELECT p.*,
         c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon, c.color AS category_color,
         u.name AS author_name, u.role AS author_role,
         (SELECT i.thumb FROM post_images i WHERE i.post_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS thumb,
         (SELECT i.filename FROM post_images i WHERE i.post_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image,
         (SELECT COUNT(*) FROM post_images i WHERE i.post_id = p.id) AS image_count
  FROM posts p
  JOIN categories c ON c.id = p.category_id
  JOIN users u ON u.id = p.author_id
`;

const ORDER = {
  recientes: 'p.created_at DESC',
  apoyos: 'p.support_count DESC, p.created_at DESC',
  comentadas: 'p.comment_count DESC, p.created_at DESC',
  antiguas: 'p.created_at ASC',
};

const OPEN_STATUSES = ['abierta', 'en_tramite'];

function buildWhere(f = {}) {
  const conds = [];
  const params = [];
  if (!f.includeHidden) conds.push('p.is_hidden = 0');
  if (f.status && STATUSES[f.status]) {
    conds.push('p.status = ?');
    params.push(f.status);
  } else if (f.status === 'pendientes') {
    conds.push(`p.status IN ('abierta','en_tramite')`);
  }
  if (f.type && TYPES[f.type]) {
    conds.push('p.type = ?');
    params.push(f.type);
  }
  if (f.categoryId) {
    conds.push('p.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.authorId) {
    conds.push('p.author_id = ?');
    params.push(f.authorId);
  }
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push('(p.title LIKE ? OR p.body LIKE ? OR p.location_text LIKE ? OR p.official_reference LIKE ?)');
    params.push(like, like, like, like);
  }
  if (f.from) {
    conds.push('p.created_at >= ?');
    params.push(`${f.from} 00:00:00`);
  }
  if (f.to) {
    conds.push('p.created_at <= ?');
    params.push(`${f.to} 23:59:59`);
  }
  if (f.withLocation) conds.push('p.lat IS NOT NULL AND p.lng IS NOT NULL');
  if (f.onlyDemo) conds.push('p.is_demo = 1');
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export function createPostsService(db) {
  const insertHistory = db.prepare(
    'INSERT INTO status_history (post_id, from_status, to_status, note, changed_by) VALUES (?, ?, ?, ?, ?)'
  );

  const service = {
    list(filters = {}) {
      const page = Math.max(1, Number(filters.page) || 1);
      const perPage = Math.min(50, Math.max(1, Number(filters.perPage) || 12));
      const { where, params } = buildWhere(filters);
      const order = ORDER[filters.sort] || ORDER.recientes;
      const total = db.prepare(`SELECT COUNT(*) AS c FROM posts p ${where}`).get(...params).c;
      const items = db
        .prepare(`${BASE_SELECT} ${where} ORDER BY p.is_pinned DESC, ${order} LIMIT ? OFFSET ?`)
        .all(...params, perPage, (page - 1) * perPage);
      return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
    },

    count(filters = {}) {
      const { where, params } = buildWhere(filters);
      return db.prepare(`SELECT COUNT(*) AS c FROM posts p ${where}`).get(...params).c;
    },

    getBySlug(slug, { includeHidden = false } = {}) {
      const post = db.prepare(`${BASE_SELECT} WHERE p.slug = ?`).get(String(slug || ''));
      if (!post) return null;
      if (post.is_hidden && !includeHidden) return null;
      return post;
    },

    getById(id) {
      return db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(id);
    },

    create(data, authorId) {
      return db.transaction(() => {
        const slug = uniqueSlug(data.title);
        const status = data.status && STATUSES[data.status] ? data.status : 'abierta';
        const info = db
          .prepare(
            `INSERT INTO posts (slug, type, title, body, category_id, author_id, status, location_text, lat, lng,
               responsible_entity, official_reference, official_claim_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            slug, data.type, data.title, data.body, data.categoryId, authorId, status,
            data.locationText || null, data.lat ?? null, data.lng ?? null,
            data.responsibleEntity || null, data.officialReference || null, data.officialClaimDate || null
          );
        const id = Number(info.lastInsertRowid);
        insertHistory.run(id, null, 'abierta', null, authorId);
        if (status !== 'abierta') {
          insertHistory.run(id, 'abierta', status, data.officialReference ? `Reclamación oficial presentada. Referencia: ${data.officialReference}` : null, authorId);
        }
        return service.getById(id);
      })();
    },

    update(id, data) {
      db.prepare(
        `UPDATE posts SET type = ?, title = ?, body = ?, category_id = ?, location_text = ?, lat = ?, lng = ?,
           responsible_entity = ?, official_reference = ?, official_claim_date = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        data.type, data.title, data.body, data.categoryId, data.locationText || null, data.lat ?? null, data.lng ?? null,
        data.responsibleEntity || null, data.officialReference || null, data.officialClaimDate || null, id
      );
      return service.getById(id);
    },

    /** Elimina la publicación y devuelve los nombres de fichero de sus fotos para borrarlos del disco. */
    remove(id) {
      return db.transaction(() => {
        const files = db.prepare('SELECT filename, thumb FROM post_images WHERE post_id = ?').all(id);
        db.prepare(
          "DELETE FROM reports WHERE (target_type = 'post' AND target_id = ?) OR (target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE post_id = ?))"
        ).run(id, id);
        db.prepare('DELETE FROM posts WHERE id = ?').run(id);
        return files.flatMap((f) => [f.filename, f.thumb]);
      })();
    },

    setHidden(id, hidden) {
      db.prepare("UPDATE posts SET is_hidden = ?, updated_at = datetime('now') WHERE id = ?").run(hidden ? 1 : 0, id);
    },

    setPinned(id, pinned) {
      db.prepare('UPDATE posts SET is_pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
    },

    changeStatus(id, toStatus, { userId = null, note = '' } = {}) {
      if (!STATUSES[toStatus]) throw Object.assign(new Error('Estado no válido'), { status: 400 });
      return db.transaction(() => {
        const post = db.prepare('SELECT id, status FROM posts WHERE id = ?').get(id);
        if (!post) return null;
        if (post.status === toStatus && !note) return service.getById(id);
        db.prepare(
          `UPDATE posts SET status = ?, updated_at = datetime('now'),
             resolved_at = CASE WHEN ? = 'resuelta' THEN datetime('now') WHEN ? IN ('abierta','en_tramite') THEN NULL ELSE resolved_at END
           WHERE id = ?`
        ).run(toStatus, toStatus, toStatus, id);
        insertHistory.run(id, post.status, toStatus, note || null, userId);
        return service.getById(id);
      })();
    },

    history(postId) {
      return db
        .prepare(
          `SELECT h.*, u.name AS user_name, u.role AS user_role
           FROM status_history h LEFT JOIN users u ON u.id = h.changed_by
           WHERE h.post_id = ? ORDER BY h.created_at ASC, h.id ASC`
        )
        .all(postId);
    },

    addImages(postId, images) {
      const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM post_images WHERE post_id = ?').get(postId).m;
      const insert = db.prepare('INSERT INTO post_images (post_id, filename, thumb, width, height, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
      db.transaction(() => {
        images.forEach((img, i) => insert.run(postId, img.filename, img.thumb, img.width, img.height, max + 1 + i));
      })();
    },

    images(postId) {
      return db.prepare('SELECT * FROM post_images WHERE post_id = ? ORDER BY sort_order, id').all(postId);
    },

    imageCount(postId) {
      return db.prepare('SELECT COUNT(*) AS c FROM post_images WHERE post_id = ?').get(postId).c;
    },

    removeImage(imageId, postId) {
      const img = db.prepare('SELECT * FROM post_images WHERE id = ? AND post_id = ?').get(imageId, postId);
      if (!img) return null;
      db.prepare('DELETE FROM post_images WHERE id = ?').run(imageId);
      return img;
    },

    toggleSupport(postId, userId) {
      return db.transaction(() => {
        const exists = db.prepare('SELECT 1 AS x FROM supports WHERE post_id = ? AND user_id = ?').get(postId, userId);
        if (exists) {
          db.prepare('DELETE FROM supports WHERE post_id = ? AND user_id = ?').run(postId, userId);
          db.prepare('UPDATE posts SET support_count = MAX(0, support_count - 1) WHERE id = ?').run(postId);
        } else {
          db.prepare('INSERT INTO supports (post_id, user_id) VALUES (?, ?)').run(postId, userId);
          db.prepare('UPDATE posts SET support_count = support_count + 1 WHERE id = ?').run(postId);
        }
        const count = db.prepare('SELECT support_count AS c FROM posts WHERE id = ?').get(postId).c;
        return { supported: !exists, count };
      })();
    },

    hasSupported(postId, userId) {
      if (!userId) return false;
      return Boolean(db.prepare('SELECT 1 AS x FROM supports WHERE post_id = ? AND user_id = ?').get(postId, userId));
    },

    supportedIds(userId, postIds) {
      if (!userId || !postIds.length) return new Set();
      const rows = db
        .prepare(`SELECT post_id FROM supports WHERE user_id = ? AND post_id IN (${postIds.map(() => '?').join(',')})`)
        .all(userId, ...postIds);
      return new Set(rows.map((r) => r.post_id));
    },

    incrementViews(id) {
      db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(id);
    },

    markers(filters = {}) {
      const { where, params } = buildWhere({ ...filters, withLocation: true });
      return db
        .prepare(
          `SELECT p.id, p.slug, p.title, p.status, p.type, p.lat, p.lng, p.support_count, p.comment_count, p.created_at,
                  p.location_text, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon, c.color AS category_color
           FROM posts p JOIN categories c ON c.id = p.category_id ${where}
           ORDER BY p.created_at DESC LIMIT 2000`
        )
        .all(...params);
    },

    latest(limit = 6) {
      return db.prepare(`${BASE_SELECT} WHERE p.is_hidden = 0 ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ?`).all(limit);
    },

    topSupported(limit = 5, { openOnly = true } = {}) {
      const cond = openOnly ? `AND p.status IN ('abierta','en_tramite')` : '';
      return db.prepare(`${BASE_SELECT} WHERE p.is_hidden = 0 ${cond} ORDER BY p.support_count DESC, p.created_at DESC LIMIT ?`).all(limit);
    },

    forReport(filters = {}) {
      const { where, params } = buildWhere(filters);
      return db
        .prepare(
          `${BASE_SELECT} ${where}
           ORDER BY CASE p.status WHEN 'abierta' THEN 0 WHEN 'en_tramite' THEN 1 WHEN 'resuelta' THEN 2 ELSE 3 END,
                    p.support_count DESC, p.created_at ASC
           LIMIT 1000`
        )
        .all(...params);
    },

    countDemo() {
      return db.prepare('SELECT COUNT(*) AS c FROM posts WHERE is_demo = 1').get().c;
    },

    /** Borra todo el contenido de ejemplo (publicaciones y usuarios ficticios). Devuelve ficheros a eliminar. */
    purgeDemo() {
      return db.transaction(() => {
        const files = db
          .prepare('SELECT filename, thumb FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE is_demo = 1)')
          .all()
          .flatMap((f) => [f.filename, f.thumb]);
        db.prepare("DELETE FROM reports WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE is_demo = 1)").run();
        db.prepare("DELETE FROM reports WHERE target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_demo = 1))").run();
        db.prepare('DELETE FROM posts WHERE is_demo = 1').run();
        db.prepare('DELETE FROM reports WHERE reporter_id IN (SELECT id FROM users WHERE is_demo = 1)').run();
        db.prepare('UPDATE reports SET reviewed_by = NULL WHERE reviewed_by IN (SELECT id FROM users WHERE is_demo = 1)').run();
        db.prepare('DELETE FROM comments WHERE author_id IN (SELECT id FROM users WHERE is_demo = 1)').run();
        db.prepare('DELETE FROM supports WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)').run();
        db.prepare('UPDATE status_history SET changed_by = NULL WHERE changed_by IN (SELECT id FROM users WHERE is_demo = 1)').run();
        db.prepare('DELETE FROM posts WHERE author_id IN (SELECT id FROM users WHERE is_demo = 1)').run();
        db.prepare('DELETE FROM users WHERE is_demo = 1').run();
        db.prepare('UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id AND comments.is_hidden = 0)').run();
        return files;
      })();
    },

    OPEN_STATUSES,
  };

  return service;
}
