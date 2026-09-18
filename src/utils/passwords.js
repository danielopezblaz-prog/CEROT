import { scrypt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';

const scryptAsync = promisify(scrypt);

/**
 * Parámetros de scrypt. Con estos valores cada comprobación cuesta unos 70 ms
 * y 17 MB de memoria, lo que encarece muchísimo un ataque por fuerza bruta con
 * tarjetas gráficas. A diferencia de bcrypt en JavaScript, scrypt es nativo y
 * se ejecuta fuera del hilo principal: varios accesos a la vez van en paralelo
 * y el foro sigue respondiendo al resto de visitantes.
 */
const PARAMS = { N: 16384, r: 8, p: 2, keylen: 64, maxmem: 96 * 1024 * 1024 };
const PREFIJO = 'scrypt';

function serializar(salt, key) {
  return [PREFIJO, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Cifra una contraseña. Versión bloqueante, solo para el arranque y los scripts. */
export function hashPasswordSync(password) {
  const salt = randomBytes(16);
  const key = scryptSync(String(password), salt, PARAMS.keylen, PARAMS);
  return serializar(salt, key);
}

/** Cifra una contraseña sin bloquear el foro. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, PARAMS.keylen, PARAMS);
  return serializar(salt, key);
}

/** ¿Es un cifrado antiguo de bcrypt que conviene renovar al entrar? */
export function needsUpgrade(stored) {
  return typeof stored === 'string' && stored.startsWith('$2');
}

/**
 * Comprueba una contraseña. Entiende el formato nuevo y el bcrypt anterior,
 * para que las cuentas creadas antes del cambio sigan funcionando.
 */
export async function verifyPassword(password, stored) {
  const hash = String(stored ?? '');
  if (needsUpgrade(hash)) {
    return bcrypt.compare(String(password ?? ''), hash);
  }
  const partes = hash.split('$');
  if (partes.length !== 6 || partes[0] !== PREFIJO) return false;
  const [, n, r, p, saltB64, keyB64] = partes;
  const opciones = { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem };
  if (!Number.isFinite(opciones.N) || !Number.isFinite(opciones.r) || !Number.isFinite(opciones.p)) return false;
  let esperado;
  let obtenido;
  try {
    esperado = Buffer.from(keyB64, 'base64');
    obtenido = await scryptAsync(String(password ?? ''), Buffer.from(saltB64, 'base64'), esperado.length, opciones);
  } catch {
    return false;
  }
  // Comparación de tiempo constante: no revela cuántos bytes coincidían.
  return esperado.length === obtenido.length && timingSafeEqual(esperado, obtenido);
}

/** Cifrado de referencia para igualar el tiempo cuando el correo no existe. */
export const DUMMY_HASH = hashPasswordSync('cuenta-que-no-existe');
