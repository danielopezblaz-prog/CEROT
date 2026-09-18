import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Genera el token por sesión y lo verifica en peticiones que modifican datos. */
export function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  if (SAFE_METHODS.has(req.method)) return next();
  // Los formularios con ficheros se verifican después de multer (ver verifyCsrf en la ruta).
  if (req.is('multipart/form-data')) return next();
  return verifyCsrf(req, res, next);
}

export function verifyCsrf(req, res, next) {
  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  const expected = String(req.session?.csrfToken || '');
  const ok =
    sent.length > 0 &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) {
    const err = new Error('La sesión ha caducado o el formulario no es válido. Vuelve a intentarlo.');
    err.status = 403;
    err.code = 'CSRF';
    return next(err);
  }
  return next();
}
