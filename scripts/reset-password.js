/**
 * Restablece la contraseña de un usuario desde la consola (útil si pierdes el acceso de administración).
 * Uso: node --disable-warning=ExperimentalWarning scripts/reset-password.js correo@ejemplo.com [nueva-contraseña]
 * Si no se indica contraseña, se genera una aleatoria. Ejecutar con el servidor parado.
 */
import crypto from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { createUsersService } from '../src/services/users.js';

const [email, given] = process.argv.slice(2);
if (!email) {
  console.error('Uso: node scripts/reset-password.js correo@ejemplo.com [nueva-contraseña]');
  process.exit(1);
}

const db = openDatabase(config.dbFile);
const users = createUsersService(db);
const user = users.findByEmail(email);
if (!user) {
  console.error(`No existe ningún usuario con el correo ${email}`);
  process.exit(1);
}
const password = given || crypto.randomBytes(9).toString('base64url');
users.setPasswordSync(user.id, password);
if (user.is_banned) users.setBanned(user.id, false);
console.log(`Contraseña restablecida para ${user.name} <${user.email}> (${user.role})`);
console.log(`Nueva contraseña: ${password}`);
db.close();
