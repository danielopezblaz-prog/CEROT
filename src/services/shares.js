/**
 * Registro de las publicaciones que se han compartido en redes externas.
 * De momento solo Facebook, pero la tabla admite más redes.
 */
export function createSharesService(db) {
  return {
    get(postId, network = 'facebook') {
      return db.prepare('SELECT * FROM external_shares WHERE post_id = ? AND network = ?').get(postId, network);
    },

    /** Devuelve un mapa id de publicación -> registro, para pintar listados sin N consultas. */
    forPosts(postIds, network = 'facebook') {
      if (!postIds.length) return new Map();
      const rows = db
        .prepare(
          `SELECT * FROM external_shares WHERE network = ? AND post_id IN (${postIds.map(() => '?').join(',')})`
        )
        .all(network, ...postIds);
      return new Map(rows.map((r) => [r.post_id, r]));
    },

    add({ postId, network = 'facebook', externalId, externalUrl, sharedBy }) {
      db.prepare(
        `INSERT INTO external_shares (post_id, network, external_id, external_url, shared_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(post_id, network) DO UPDATE SET
           external_id = excluded.external_id,
           external_url = excluded.external_url,
           shared_by = excluded.shared_by,
           created_at = datetime('now')`
      ).run(postId, network, externalId, externalUrl, sharedBy ?? null);
      return this.get(postId, network);
    },

    remove(postId, network = 'facebook') {
      db.prepare('DELETE FROM external_shares WHERE post_id = ? AND network = ?').run(postId, network);
    },

    count(network = 'facebook') {
      return db.prepare('SELECT COUNT(*) AS c FROM external_shares WHERE network = ?').get(network).c;
    },

    recent(limit = 5, network = 'facebook') {
      return db
        .prepare(
          `SELECT s.*, p.title, p.slug, u.name AS shared_by_name
           FROM external_shares s
           JOIN posts p ON p.id = s.post_id
           LEFT JOIN users u ON u.id = s.shared_by
           WHERE s.network = ?
           ORDER BY s.created_at DESC LIMIT ?`
        )
        .all(network, limit);
    },
  };
}
