const LIST_SELECT = `
  SELECT r.*, u.name AS reporter_name, rv.name AS reviewer_name,
    CASE WHEN r.target_type = 'post'
      THEN (SELECT title FROM posts WHERE id = r.target_id)
      ELSE (SELECT substr(body, 1, 160) FROM comments WHERE id = r.target_id) END AS target_text,
    CASE WHEN r.target_type = 'post'
      THEN (SELECT slug FROM posts WHERE id = r.target_id)
      ELSE (SELECT p.slug FROM comments cm JOIN posts p ON p.id = cm.post_id WHERE cm.id = r.target_id) END AS post_slug,
    CASE WHEN r.target_type = 'post'
      THEN (SELECT is_hidden FROM posts WHERE id = r.target_id)
      ELSE (SELECT is_hidden FROM comments WHERE id = r.target_id) END AS target_hidden
  FROM reports r
  JOIN users u ON u.id = r.reporter_id
  LEFT JOIN users rv ON rv.id = r.reviewed_by
`;

export function createReportsService(db) {
  return {
    create({ targetType, targetId, reporterId, reason, details }) {
      const dup = db
        .prepare("SELECT id FROM reports WHERE target_type = ? AND target_id = ? AND reporter_id = ? AND status = 'pendiente'")
        .get(targetType, targetId, reporterId);
      if (dup) return null;
      const info = db
        .prepare('INSERT INTO reports (target_type, target_id, reporter_id, reason, details) VALUES (?, ?, ?, ?, ?)')
        .run(targetType, targetId, reporterId, reason, details || null);
      return Number(info.lastInsertRowid);
    },

    countPending() {
      return db.prepare("SELECT COUNT(*) AS c FROM reports WHERE status = 'pendiente'").get().c;
    },

    listPending() {
      return db.prepare(`${LIST_SELECT} WHERE r.status = 'pendiente' ORDER BY r.created_at DESC`).all();
    },

    listReviewed(limit = 30) {
      return db.prepare(`${LIST_SELECT} WHERE r.status = 'revisado' ORDER BY r.reviewed_at DESC LIMIT ?`).all(limit);
    },

    getById(id) {
      return db.prepare(`${LIST_SELECT} WHERE r.id = ?`).get(id);
    },

    review(id, reviewerId) {
      db.prepare("UPDATE reports SET status = 'revisado', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?").run(reviewerId, id);
    },

    reviewAllForTarget(targetType, targetId, reviewerId) {
      db.prepare(
        "UPDATE reports SET status = 'revisado', reviewed_by = ?, reviewed_at = datetime('now') WHERE target_type = ? AND target_id = ? AND status = 'pendiente'"
      ).run(reviewerId, targetType, targetId);
    },
  };
}
