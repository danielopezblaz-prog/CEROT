import crypto from 'node:crypto';

/*
 * Enlaces para recuperar la contraseña.
 *
 * En la base de datos NO se guarda el enlace, sino su huella (un resumen que no
 * se puede deshacer). Así, si alguien llegara a ver la base de datos, no podría
 * entrar en ninguna cuenta con lo que hay dentro. El enlace de verdad solo
 * existe en el correo del vecino.
 *
 * Cada enlace caduca en una hora y solo vale una vez.
 */

const MINUTOS_VALIDO = 60;
const MAXIMO_POR_HORA = 5; // para que nadie use el foro para llenarle el buzón a otro
const HORAS_QUE_SE_GUARDAN = 48; // después se borran, usados o no

const huella = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function createRecoveryService(db) {
  const insertar = db.prepare(
    `INSERT INTO password_resets (user_id, token_hash, expires_at, ip)
     VALUES (?, ?, datetime('now', '+${MINUTOS_VALIDO} minutes'), ?)`
  );
  const porHuella = db.prepare(
    `SELECT r.id, r.user_id, r.used_at, r.expires_at
     FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > datetime('now') AND u.is_banned = 0`
  );

  return {
    minutosValido: MINUTOS_VALIDO,

    /**
     * Crea un enlace para un vecino y devuelve el token que va en el correo.
     * Devuelve null si ya ha pedido demasiados en la última hora.
     */
    crear(userId, ip = null) {
      const recientes = db
        .prepare("SELECT COUNT(*) AS c FROM password_resets WHERE user_id = ? AND created_at > datetime('now', '-1 hour')")
        .get(userId).c;
      if (recientes >= MAXIMO_POR_HORA) return null;
      const token = crypto.randomBytes(32).toString('base64url');
      insertar.run(userId, huella(token), ip ? String(ip).slice(0, 60) : null);
      return token;
    },

    /** Devuelve la petición si el enlace sigue valiendo; si no, null. */
    buscar(token) {
      if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
      return porHuella.get(huella(token)) || null;
    },

    /**
     * Da el enlace por usado y anula los demás de esa persona: si pidió varios
     * porque no le llegaba el correo, los antiguos dejan de servir.
     */
    consumir(token) {
      const peticion = this.buscar(token);
      if (!peticion) return null;
      db.transaction(() => {
        db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(peticion.id);
        db.prepare('DELETE FROM password_resets WHERE user_id = ? AND id <> ?').run(peticion.user_id, peticion.id);
      })();
      return peticion;
    },

    /** Borra lo caducado. Se llama al arrancar y una vez al día. */
    limpiar() {
      return db
        .prepare(`DELETE FROM password_resets WHERE created_at < datetime('now', '-${HORAS_QUE_SE_GUARDAN} hours')`)
        .run().changes;
    },
  };
}
