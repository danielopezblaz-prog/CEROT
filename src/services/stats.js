import { STATUSES, TYPES } from '../utils/constants.js';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function createStatsService(db) {
  return {
    overview() {
      const t = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(status = 'abierta') AS abierta,
                  SUM(status = 'en_tramite') AS en_tramite,
                  SUM(status = 'resuelta') AS resuelta,
                  SUM(status = 'cerrada') AS cerrada,
                  SUM(support_count) AS supports,
                  SUM(comment_count) AS comments,
                  SUM(CASE WHEN status IN ('abierta','en_tramite') AND created_at < datetime('now', '-30 days') THEN 1 ELSE 0 END) AS pending_over_30,
                  SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS last_30_days,
                  SUM(official_reference IS NOT NULL AND official_reference != '') AS with_reference
           FROM posts WHERE is_hidden = 0`
        )
        .get();
      const users = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_banned = 0').get().c;
      const avg = db
        .prepare(
          `SELECT AVG(julianday(resolved_at) - julianday(created_at)) AS d
           FROM posts WHERE is_hidden = 0 AND status = 'resuelta' AND resolved_at IS NOT NULL`
        )
        .get().d;
      const oldest = db
        .prepare(
          `SELECT MAX(julianday('now') - julianday(created_at)) AS d
           FROM posts WHERE is_hidden = 0 AND status IN ('abierta','en_tramite')`
        )
        .get().d;
      const total = Number(t.total) || 0;
      const resuelta = Number(t.resuelta) || 0;
      const pendientes = (Number(t.abierta) || 0) + (Number(t.en_tramite) || 0);
      return {
        total,
        abierta: Number(t.abierta) || 0,
        en_tramite: Number(t.en_tramite) || 0,
        resuelta,
        cerrada: Number(t.cerrada) || 0,
        pendientes,
        supports: Number(t.supports) || 0,
        comments: Number(t.comments) || 0,
        users,
        pendingOver30: Number(t.pending_over_30) || 0,
        last30Days: Number(t.last_30_days) || 0,
        withReference: Number(t.with_reference) || 0,
        resolutionRate: total ? Math.round((resuelta / total) * 100) : 0,
        avgResolutionDays: avg != null ? Math.round(Number(avg)) : null,
        oldestOpenDays: oldest != null ? Math.floor(Number(oldest)) : null,
      };
    },

    byStatus() {
      const rows = db.prepare('SELECT status, COUNT(*) AS c FROM posts WHERE is_hidden = 0 GROUP BY status').all();
      const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.c)]));
      return Object.values(STATUSES).map((s) => ({ ...s, count: map[s.key] || 0 }));
    },

    byType() {
      const rows = db.prepare('SELECT type, COUNT(*) AS c FROM posts WHERE is_hidden = 0 GROUP BY type').all();
      const map = Object.fromEntries(rows.map((r) => [r.type, Number(r.c)]));
      return Object.values(TYPES).map((t) => ({ ...t, count: map[t.key] || 0 }));
    },

    byCategory() {
      return db
        .prepare(
          `SELECT c.id, c.slug, c.name, c.icon, c.color,
                  COUNT(p.id) AS total,
                  SUM(CASE WHEN p.status IN ('abierta','en_tramite') THEN 1 ELSE 0 END) AS pendientes,
                  SUM(CASE WHEN p.status = 'resuelta' THEN 1 ELSE 0 END) AS resueltas,
                  COALESCE(SUM(p.support_count), 0) AS supports
           FROM categories c
           LEFT JOIN posts p ON p.category_id = c.id AND p.is_hidden = 0
           WHERE c.is_active = 1
           GROUP BY c.id
           ORDER BY total DESC, c.sort_order`
        )
        .all()
        .map((r) => ({ ...r, total: Number(r.total), pendientes: Number(r.pendientes), resueltas: Number(r.resueltas), supports: Number(r.supports) }));
    },

    byEntity() {
      return db
        .prepare(
          `SELECT COALESCE(NULLIF(responsible_entity, ''), 'Sin especificar') AS entity, COUNT(*) AS total,
                  SUM(CASE WHEN status IN ('abierta','en_tramite') THEN 1 ELSE 0 END) AS pendientes
           FROM posts WHERE is_hidden = 0 GROUP BY entity ORDER BY total DESC`
        )
        .all()
        .map((r) => ({ ...r, total: Number(r.total), pendientes: Number(r.pendientes) }));
    },

    byMonth(months = 12) {
      const created = db
        .prepare(
          `SELECT strftime('%Y-%m', created_at) AS ym, COUNT(*) AS c FROM posts
           WHERE is_hidden = 0 AND created_at >= date('now', 'start of month', ?) GROUP BY ym`
        )
        .all(`-${months - 1} months`);
      const resolved = db
        .prepare(
          `SELECT strftime('%Y-%m', resolved_at) AS ym, COUNT(*) AS c FROM posts
           WHERE is_hidden = 0 AND resolved_at IS NOT NULL AND resolved_at >= date('now', 'start of month', ?) GROUP BY ym`
        )
        .all(`-${months - 1} months`);
      const cMap = Object.fromEntries(created.map((r) => [r.ym, Number(r.c)]));
      const rMap = Object.fromEntries(resolved.map((r) => [r.ym, Number(r.c)]));
      const out = [];
      const now = new Date();
      for (let i = months - 1; i >= 0; i -= 1) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        out.push({
          ym,
          label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
          created: cMap[ym] || 0,
          resolved: rMap[ym] || 0,
        });
      }
      return out;
    },
  };
}
