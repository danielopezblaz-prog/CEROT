/**
 * Mensajes de un solo uso guardados en sesión (para mostrarlos tras una redirección).
 * Uso: req.flash('success', 'Publicado'); en la vista: getFlash()
 */
export function flash(req, res, next) {
  req.flash = (type, message) => {
    if (!req.session) return;
    if (!Array.isArray(req.session.flash)) req.session.flash = [];
    req.session.flash.push({ type, message });
  };
  res.locals.getFlash = () => {
    const messages = Array.isArray(req.session?.flash) ? req.session.flash : [];
    if (req.session) delete req.session.flash;
    return messages;
  };
  next();
}
