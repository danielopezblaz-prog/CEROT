import session from 'express-session';

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
/** Margen para no reescribir la caducidad de la sesión en cada petición. */
const TOUCH_INTERVAL = 30 * 60 * 1000;

/** Almacén de sesiones sobre la propia base de datos SQLite (sin dependencias externas). */
export class SqliteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.stmts = {
      get: db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?'),
      set: db.prepare(
        'INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires'
      ),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires < ?'),
    };
    this.touched = new Map();
    this.timer = setInterval(() => this.cleanup(), 15 * 60 * 1000);
    this.timer.unref();
  }

  expiresOf(sess) {
    const exp = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    return Number.isFinite(exp) ? exp : Date.now() + TWO_WEEKS;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.stmts.set.run(sid, JSON.stringify(sess), this.expiresOf(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  /**
   * Renueva la caducidad de la sesión. Se llama en cada petición, así que solo
   * escribe de verdad cuando la fecha se mueve más de media hora. Sin esto,
   * cada visita a una página provocaría una escritura en la base de datos.
   */
  touch(sid, sess, cb) {
    try {
      const nuevo = this.expiresOf(sess);
      const ultimo = this.touched.get(sid) ?? 0;
      if (nuevo - ultimo > TOUCH_INTERVAL) {
        this.stmts.touch.run(nuevo, sid);
        this.touched.set(sid, nuevo);
        if (this.touched.size > 5000) this.touched.clear();
      }
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.stmts.destroy.run(sid);
      this.touched.delete(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  cleanup() {
    try {
      this.stmts.cleanup.run(Date.now());
    } catch {
      /* ignorar */
    }
  }
}

export function createSessionMiddleware(db, config) {
  return session({
    store: new SqliteStore(db),
    name: 'vereda.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: config.trustProxy,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: TWO_WEEKS,
    },
  });
}
