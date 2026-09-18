import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireRole } from '../middleware/auth.js';
import { cleanString, toInt } from '../utils/text.js';
import { ROLES, STATUSES, BUSINESS_STATUSES } from '../utils/constants.js';
import { safePath, launchChecklist } from '../utils/security.js';

export function adminRoutes({ config, db, services, uploader }) {
  const router = express.Router();
  router.use(requireRole('moderador', 'admin'));
  const adminOnly = requireRole('admin');

  router.get('/', (req, res) => {
    res.render('admin/dashboard', {
      pageMeta: { title: 'Panel de moderación' },
      stats: services.stats.overview(),
      pending: services.reports.listPending().slice(0, 5),
      pendingCount: services.reports.countPending(),
      recentUsers: services.users.recent(6),
      recentComments: services.comments.recent(6),
      businesses: {
        pending: services.businesses.list({ status: 'pendiente', perPage: 5, sort: 'recientes' }).items,
        pendingCount: services.businesses.countPending(),
        total: services.businesses.count({ status: 'activo' }),
        offers: services.offers.countCurrent(),
      },
      launch: launchChecklist(config, services),
      demoCount: services.posts.countDemo(),
      hiddenCount: services.posts.count({ includeHidden: true }) - services.posts.count({}),
      facebook: {
        enabled: services.facebook.enabled,
        count: services.shares.count(),
        recent: services.shares.recent(5),
      },
    });
  });

  router.get('/publicaciones', (req, res) => {
    const q = cleanString(req.query.q, 100);
    const status = STATUSES[req.query.estado] ? req.query.estado : '';
    const page = Math.max(1, toInt(req.query.pagina, 1));
    const result = services.posts.list({ q, status, page, perPage: 25, includeHidden: true, onlyDemo: req.query.demo === '1' });
    res.render('admin/posts', {
      pageMeta: { title: 'Publicaciones' },
      result,
      q,
      status,
      showDemo: req.query.demo === '1',
      shares: services.shares.forPosts(result.items.map((p) => p.id)),
    });
  });

  function postAction(action) {
    return async (req, res) => {
      const post = services.posts.getById(Number(req.params.id));
      if (!post) {
        const err = new Error('Publicación no encontrada');
        err.status = 404;
        throw err;
      }
      switch (action) {
        case 'ocultar':
          services.posts.setHidden(post.id, true);
          services.reports.reviewAllForTarget('post', post.id, req.user.id);
          req.flash('success', 'Publicación ocultada. Solo la moderación y su autor pueden verla.');
          break;
        case 'mostrar':
          services.posts.setHidden(post.id, false);
          req.flash('success', 'Publicación visible de nuevo.');
          break;
        case 'fijar':
          services.posts.setPinned(post.id, true);
          req.flash('success', 'Publicación fijada en la parte superior.');
          break;
        case 'desfijar':
          services.posts.setPinned(post.id, false);
          req.flash('success', 'Publicación desfijada.');
          break;
        case 'eliminar': {
          const files = services.posts.remove(post.id);
          await uploader.remove(files);
          req.flash('success', 'Publicación eliminada definitivamente.');
          break;
        }
        default:
          break;
      }
      services.events.publicar('publicacion:moderada', { postId: post.id, slug: post.slug, accion: action });
      return res.redirect(safePath(req.body.volver, '/admin/publicaciones'));
    };
  }
  for (const action of ['ocultar', 'mostrar', 'fijar', 'desfijar', 'eliminar']) {
    router.post(`/publicaciones/:id/${action}`, postAction(action));
  }

  /** Comparte una publicación en la página de Facebook. Siempre manual, nunca automático. */
  router.post('/publicaciones/:id/facebook', async (req, res, next) => {
    const volver = safePath(req.body.volver, '/admin/publicaciones');
    const post = services.posts.getById(Number(req.params.id));
    if (!post) {
      const err = new Error('Publicación no encontrada');
      err.status = 404;
      return next(err);
    }
    if (!services.facebook.enabled) {
      req.flash('error', 'La conexión con Facebook no está configurada. Revisa FACEBOOK_PAGE_ID y FACEBOOK_PAGE_TOKEN.');
      return res.redirect(volver);
    }
    if (post.is_hidden) {
      req.flash('error', 'No se puede compartir una publicación oculta. Muéstrala primero si quieres difundirla.');
      return res.redirect(volver);
    }
    if (services.shares.get(post.id)) {
      req.flash('info', 'Esta publicación ya se compartió en Facebook.');
      return res.redirect(volver);
    }
    try {
      const result = await services.facebook.share(post);
      services.shares.add({ postId: post.id, externalId: result.id, externalUrl: result.url, sharedBy: req.user.id });
      req.flash('success', 'Publicado en la página de Facebook.');
    } catch (err) {
      console.error('[facebook] error al compartir', err);
      req.flash('error', err.message);
    }
    return res.redirect(volver);
  });

  /** Retira de Facebook una publicación compartida. Útil si hay que rectificar. */
  router.post('/publicaciones/:id/facebook/eliminar', async (req, res) => {
    const volver = safePath(req.body.volver, '/admin/publicaciones');
    const postId = Number(req.params.id);
    const share = services.shares.get(postId);
    if (!share) {
      req.flash('error', 'Esta publicación no está compartida en Facebook.');
      return res.redirect(volver);
    }
    try {
      await services.facebook.remove(share.external_id);
      services.shares.remove(postId);
      req.flash('success', 'Retirada de Facebook.');
    } catch (err) {
      console.error('[facebook] error al retirar', err);
      req.flash(
        'error',
        `${err.message} Si ya la borraste a mano en Facebook, usa "Olvidar" para quitarla del registro del foro.`
      );
    }
    return res.redirect(volver);
  });

  /** Quita el registro negocio sin llamar a Facebook, para cuando ya se borró allí a mano. */
  router.post('/publicaciones/:id/facebook/olvidar', (req, res) => {
    services.shares.remove(Number(req.params.id));
    req.flash('success', 'Registro de Facebook eliminado del foro.');
    return res.redirect(safePath(req.body.volver, '/admin/publicaciones'));
  });

  /* ---------- Negocios del barrio ---------- */

  router.get('/negocios', (req, res) => {
    const q = cleanString(req.query.q, 100);
    const status = BUSINESS_STATUSES[req.query.estado] ? req.query.estado : '';
    const page = Math.max(1, toInt(req.query.pagina, 1));
    const result = services.businesses.list({ q, status, includeAll: !status, page, perPage: 25, sort: 'recientes' });
    res.render('admin/businesses', {
      pageMeta: { title: 'Negocios' },
      result,
      q,
      status,
      pendingCount: services.businesses.countPending(),
    });
  });

  function businessAction(action) {
    return async (req, res, next) => {
      const business = services.businesses.getById(Number(req.params.id));
      if (!business) {
        const err = new Error('Negocio no encontrado');
        err.status = 404;
        return next(err);
      }
      const note = cleanString(req.body.nota, 300);
      switch (action) {
        case 'aprobar':
          services.businesses.setStatus(business.id, 'activo', null);
          services.events.publicar('negocio:aprobado', { negocioId: business.id, slug: business.slug, nombre: business.name });
          services.events.publicar('pendientes', { negocios: services.businesses.countPending() }, { alcance: 'moderacion' });
          req.flash('success', `«${business.name}» ya está publicado en el directorio.`);
          break;
        case 'suspender':
          services.businesses.setStatus(business.id, 'suspendido', note || null);
          services.events.publicar('negocio:retirado', { negocioId: business.id, slug: business.slug, nombre: business.name });
          services.events.publicar('pendientes', { negocios: services.businesses.countPending() }, { alcance: 'moderacion' });
          req.flash('success', `«${business.name}» retirado del directorio.`);
          break;
        case 'eliminar': {
          const files = services.businesses.remove(business.id);
          await uploader.remove(files);
          req.flash('success', `«${business.name}» eliminado definitivamente.`);
          break;
        }
        default:
          break;
      }
      return res.redirect(safePath(req.body.volver, '/admin/negocios'));
    };
  }
  for (const action of ['aprobar', 'suspender', 'eliminar']) {
    router.post(`/negocios/:id/${action}`, businessAction(action));
  }

  router.get('/denuncias', (req, res) => {
    res.render('admin/reports', {
      pageMeta: { title: 'Denuncias' },
      pending: services.reports.listPending(),
      reviewed: services.reports.listReviewed(30),
    });
  });

  router.post('/denuncias/:id/revisar', (req, res) => {
    services.reports.review(Number(req.params.id), req.user.id);
    services.events.publicar('pendientes', { denuncias: services.reports.countPending() }, { alcance: 'moderacion' });
    req.flash('success', 'Denuncia marcada como revisada.');
    res.redirect('/admin/denuncias');
  });

  router.post('/denuncias/:id/ocultar', (req, res) => {
    const report = services.reports.getById(Number(req.params.id));
    if (!report) {
      const err = new Error('Denuncia no encontrada');
      err.status = 404;
      throw err;
    }
    if (report.target_type === 'post') services.posts.setHidden(report.target_id, true);
    else services.comments.setHidden(report.target_id, true);
    services.reports.reviewAllForTarget(report.target_type, report.target_id, req.user.id);
    services.events.publicar('pendientes', { denuncias: services.reports.countPending() }, { alcance: 'moderacion' });
    if (report.target_type === 'comment') services.events.publicar('comentario:fuera', { comentarioId: report.target_id });
    req.flash('success', 'Contenido ocultado y denuncias revisadas.');
    res.redirect('/admin/denuncias');
  });

  router.post('/comentarios/:id/ocultar', (req, res) => {
    services.comments.setHidden(Number(req.params.id), true);
    services.reports.reviewAllForTarget('comment', Number(req.params.id), req.user.id);
    services.events.publicar('pendientes', { denuncias: services.reports.countPending() }, { alcance: 'moderacion' });
    services.events.publicar('comentario:fuera', { comentarioId: Number(req.params.id) });
    req.flash('success', 'Comentario ocultado.');
    res.redirect(safePath(req.body.volver, '/admin'));
  });

  router.post('/comentarios/:id/mostrar', (req, res) => {
    services.comments.setHidden(Number(req.params.id), false);
    req.flash('success', 'Comentario visible de nuevo.');
    res.redirect(safePath(req.body.volver, '/admin'));
  });

  router.get('/usuarios', adminOnly, (req, res) => {
    const q = cleanString(req.query.q, 100);
    const page = Math.max(1, toInt(req.query.pagina, 1));
    const result = services.users.list({ q, page, perPage: 25 });
    res.render('admin/users', { pageMeta: { title: 'Usuarios' }, result, q });
  });

  router.post('/usuarios/:id/rol', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const role = ROLES[req.body.rol] ? req.body.rol : null;
    const target = services.users.findById(id);
    if (!target || !role) {
      req.flash('error', 'Usuario o rol no válido.');
    } else if (target.id === req.user.id && role !== 'admin' && services.users.countAdmins() <= 1) {
      req.flash('error', 'No puedes quitarte el rol de administración: eres la única persona administradora.');
    } else {
      services.users.setRole(id, role);
      req.flash('success', `${target.name} ahora es ${ROLES[role].toLowerCase()}.`);
    }
    res.redirect('/admin/usuarios');
  });

  router.post('/usuarios/:id/bloquear', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const target = services.users.findById(id);
    if (!target) {
      req.flash('error', 'Usuario no encontrado.');
    } else if (target.id === req.user.id) {
      req.flash('error', 'No puedes bloquear tu propia cuenta.');
    } else {
      services.users.setBanned(id, true);
      req.flash('success', `Cuenta de ${target.name} bloqueada.`);
    }
    res.redirect('/admin/usuarios');
  });

  router.post('/usuarios/:id/desbloquear', adminOnly, (req, res) => {
    services.users.setBanned(Number(req.params.id), false);
    req.flash('success', 'Cuenta desbloqueada.');
    res.redirect('/admin/usuarios');
  });

  router.post('/usuarios/:id/contrasena', adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const password = String(req.body.contrasena || '');
    const target = services.users.findById(id);
    if (!target) {
      req.flash('error', 'Usuario no encontrado.');
    } else if (password.length < 8) {
      req.flash('error', 'La contraseña debe tener al menos 8 caracteres.');
    } else {
      await services.users.setPassword(id, password);
      req.flash('success', `Contraseña de ${target.name} restablecida. Comunícasela por un canal seguro.`);
    }
    res.redirect('/admin/usuarios');
  });

  router.post('/demo/purgar', adminOnly, async (req, res) => {
    const files = [...services.businesses.purgeDemo(), ...services.posts.purgeDemo()];
    await uploader.remove(files);
    req.flash('success', 'Contenido de ejemplo eliminado. El foro está listo para los vecinos.');
    res.redirect('/admin');
  });

  router.get('/copia-seguridad', adminOnly, async (req, res, next) => {
    if (db.file === ':memory:') return res.status(400).send('Sin fichero de base de datos.');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const target = path.join(config.dataDir, `copia-${stamp}.sqlite`);
    try {
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      res.download(target, `foro-${stamp}.sqlite`, async () => {
        await fs.rm(target, { force: true });
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
