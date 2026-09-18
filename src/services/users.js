import { displayName } from '../utils/text.js';
import { hashPassword, hashPasswordSync, verifyPassword, needsUpgrade, DUMMY_HASH } from '../utils/passwords.js';

const PUBLIC_COLS = 'id, name, first_name, last_name, phone, email, role, is_banned, is_demo, created_at, last_login_at';

export function createUsersService(db) {
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const byId = db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`);
  const insert = db.prepare(
    'INSERT INTO users (name, first_name, last_name, phone, email, password_hash, role, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const service = {
    count() {
      return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    },
    countActive() {
      return db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_banned = 0').get().c;
    },
    findByEmail(email) {
      return byEmail.get(String(email || '').trim());
    },
    findById(id) {
      return byId.get(id);
    },
    /**
     * Crea una cuenta. El nombre público se calcula a partir del nombre y el
     * apellido; `name` solo se pasa a mano para cuentas técnicas o de ejemplo.
     */
    create({ name, firstName = '', lastName = '', phone = '', email, password, role = 'vecino', isDemo = false }) {
      const hash = hashPasswordSync(password);
      const publicName = (name || displayName(firstName, lastName) || '').trim();
      const info = insert.run(
        publicName, firstName.trim() || null, lastName.trim() || null, phone.trim() || null,
        email.trim().toLowerCase(), hash, role, isDemo
      );
      return byId.get(Number(info.lastInsertRowid));
    },
    /**
     * Comprobar la contraseña cuesta unos 70 ms de cálculo. Es asíncrono a
     * propósito: así se hace en el grupo de hilos y varios vecinos pueden
     * entrar a la vez sin que el foro deje de responder al resto.
     */
    async verify(email, password) {
      const user = byEmail.get(String(email || '').trim());
      if (!user) {
        // Se comprueba igualmente contra un cifrado falso para que fallar tarde
        // lo mismo que acertar y no se pueda adivinar qué correos existen.
        await verifyPassword(password, DUMMY_HASH);
        return null;
      }
      if (!(await verifyPassword(password, user.password_hash))) return null;
      // Las cuentas anteriores al cambio de algoritmo se renuevan al entrar.
      if (needsUpgrade(user.password_hash)) {
        try {
          await service.setPassword(user.id, password);
        } catch {
          /* si falla, la cuenta sigue funcionando con el cifrado antiguo */
        }
      }
      return user;
    },
    async verifyById(id, password) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!user) return null;
      return (await verifyPassword(password, user.password_hash)) ? user : null;
    },
    touchLogin(id) {
      db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
    },
    async setPassword(id, password) {
      const hash = await hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    },
    /** Versión que no cede el turno. Solo para los scripts de consola. */
    setPasswordSync(id, password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPasswordSync(password), id);
    },
    setName(id, name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), id);
    },

    /** Actualiza los datos personales y recalcula el nombre público. */
    setProfile(id, { firstName, lastName, phone }) {
      db.prepare('UPDATE users SET name = ?, first_name = ?, last_name = ?, phone = ? WHERE id = ?').run(
        displayName(firstName, lastName), firstName.trim(), lastName.trim(), phone.trim() || null, id
      );
    },
    setRole(id, role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    },
    setBanned(id, banned) {
      db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(banned ? 1 : 0, id);
      if (banned) db.prepare("DELETE FROM sessions WHERE sess LIKE ?").run(`%"userId":${Number(id)}%`);
    },
    countAdmins() {
      return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_banned = 0").get().c;
    },
    list({ q = '', page = 1, perPage = 25 } = {}) {
      const like = `%${q}%`;
      const where = q ? 'WHERE name LIKE ? OR email LIKE ?' : '';
      const params = q ? [like, like] : [];
      const total = db.prepare(`SELECT COUNT(*) AS c FROM users ${where}`).get(...params).c;
      const items = db
        .prepare(
          `SELECT ${PUBLIC_COLS},
             (SELECT COUNT(*) FROM posts WHERE author_id = users.id) AS post_count,
             (SELECT COUNT(*) FROM comments WHERE author_id = users.id) AS comment_count
           FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
        )
        .all(...params, perPage, (page - 1) * perPage);
      return { items, total, page, pages: Math.max(1, Math.ceil(total / perPage)) };
    },
    recent(limit = 5) {
      return db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY created_at DESC LIMIT ?`).all(limit);
    },
  };

  return service;
}
