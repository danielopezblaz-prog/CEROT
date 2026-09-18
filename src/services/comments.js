export function createCommentsService(db) {
  const recount = db.prepare(
    'UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ? AND is_hidden = 0) WHERE id = ?'
  );

  return {
    forPost(postId, { includeHidden = false } = {}) {
      const cond = includeHidden ? '' : 'AND cm.is_hidden = 0';
      return db
        .prepare(
          `SELECT cm.*, u.name AS author_name, u.role AS author_role
           FROM comments cm JOIN users u ON u.id = cm.author_id
           WHERE cm.post_id = ? ${cond}
           ORDER BY cm.created_at ASC, cm.id ASC`
        )
        .all(postId);
    },

    getById(id) {
      return db
        .prepare(
          `SELECT cm.*, p.slug AS post_slug, u.name AS author_name
           FROM comments cm JOIN posts p ON p.id = cm.post_id JOIN users u ON u.id = cm.author_id
           WHERE cm.id = ?`
        )
        .get(id);
    },

    create(postId, authorId, body) {
      return db.transaction(() => {
        const info = db.prepare('INSERT INTO comments (post_id, author_id, body) VALUES (?, ?, ?)').run(postId, authorId, body);
        recount.run(postId, postId);
        db.prepare("UPDATE posts SET updated_at = datetime('now') WHERE id = ?").run(postId);
        return Number(info.lastInsertRowid);
      })();
    },

    setHidden(id, hidden) {
      db.transaction(() => {
        const c = db.prepare('SELECT post_id FROM comments WHERE id = ?').get(id);
        if (!c) return;
        db.prepare('UPDATE comments SET is_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
        recount.run(c.post_id, c.post_id);
      })();
    },

    remove(id) {
      db.transaction(() => {
        const c = db.prepare('SELECT post_id FROM comments WHERE id = ?').get(id);
        if (!c) return;
        db.prepare("DELETE FROM reports WHERE target_type = 'comment' AND target_id = ?").run(id);
        db.prepare('DELETE FROM comments WHERE id = ?').run(id);
        recount.run(c.post_id, c.post_id);
      })();
    },

    countAll() {
      return db.prepare('SELECT COUNT(*) AS c FROM comments WHERE is_hidden = 0').get().c;
    },

    recent(limit = 8) {
      return db
        .prepare(
          `SELECT cm.id, cm.body, cm.created_at, cm.is_hidden, u.name AS author_name, p.slug AS post_slug, p.title AS post_title
           FROM comments cm JOIN users u ON u.id = cm.author_id JOIN posts p ON p.id = cm.post_id
           ORDER BY cm.created_at DESC LIMIT ?`
        )
        .all(limit);
    },
  };
}
