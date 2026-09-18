export function wantsJson(req) {
  return req.xhr || req.get('x-requested-with') === 'fetch' || (req.get('accept') || '').includes('application/json');
}

export function attachUser(users) {
  return (req, res, next) => {
    req.user = null;
    const id = req.session?.userId;
    if (id) {
      const user = users.findById(id);
      if (user && !user.is_banned) {
        req.user = user;
      } else {
        req.session.userId = null;
      }
    }
    res.locals.user = req.user;
    res.locals.isMod = Boolean(req.user && ['moderador', 'admin'].includes(req.user.role));
    res.locals.isAdmin = Boolean(req.user && req.user.role === 'admin');
    next();
  };
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Necesitas iniciar sesión.' });
  req.flash('info', 'Inicia sesión para continuar.');
  const next_ = req.method === 'GET' ? req.originalUrl : req.get('referer') || '/';
  return res.redirect(`/acceder?next=${encodeURIComponent(next_)}`);
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (roles.includes(req.user.role)) return next();
    const err = new Error('No tienes permisos para acceder a esta página.');
    err.status = 403;
    return next(err);
  };
}

export function isMod(user) {
  return Boolean(user && ['moderador', 'admin'].includes(user.role));
}

export function canEditPost(user, post) {
  if (!user || !post) return false;
  return isMod(user) || post.author_id === user.id;
}

export function canDeleteComment(user, comment) {
  if (!user || !comment) return false;
  return isMod(user) || comment.author_id === user.id;
}
