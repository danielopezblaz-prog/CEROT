import { wantsJson } from './auth.js';

export function notFound(req, res) {
  if (wantsJson(req)) return res.status(404).json({ error: 'No encontrado' });
  res.status(404);
  return res.render('pages/error', {
    pageMeta: { title: 'Página no encontrada' },
    status: 404,
    message: 'La página que buscas no existe o se ha eliminado.',
  });
}

export function errorHandler(config) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = Number(err.status || err.statusCode || 500);
    if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return;
    const message =
      status < 500
        ? err.message
        : 'Se ha producido un error inesperado. Si el problema continúa, avisa al administrador del foro.';
    if (wantsJson(req)) return res.status(status).json({ error: message });
    res.status(status);
    return res.render('pages/error', {
      pageMeta: { title: status === 403 ? 'Acceso no permitido' : 'Error' },
      status,
      message,
      details: config.isProduction ? null : err.stack,
    });
  };
}
