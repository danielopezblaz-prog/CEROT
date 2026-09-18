/**
 * Genera un secreto de sesión largo y aleatorio para el fichero .env.
 * Uso: npm run secreto
 */
import crypto from 'node:crypto';

const secreto = crypto.randomBytes(48).toString('hex');
console.log('\nPega esta línea en el fichero .env del servidor:\n');
console.log(`SESSION_SECRET=${secreto}\n`);
console.log('Si lo cambias más adelante, todos los vecinos tendrán que volver a entrar.\n');
