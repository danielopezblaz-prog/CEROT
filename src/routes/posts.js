import express from 'express';
import { requireAuth, canEditPost, canDeleteComment, isMod, wantsJson } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { postLimiter, commentLimiter } from '../middleware/limits.js';
import { cleanString, toFloat } from '../utils/text.js';
import { isIsoDate } from '../utils/filters.js';
import { STATUSES, TYPES, ENTITIES, REPORT_REASONS } from '../utils/constants.js';
import { fichaPublicacion, migas, textoPlano } from '../utils/seo.js';

/* Separador entre el texto compartido y su enlace. */
const SALTO = '\n\n';

export function validatePost(body, categories) {
  const values = {
    type: TYPES[body.tipo] ? body.tipo : 'incidencia',
    title: cleanString(body.titulo, 140),
    body: cleanString(body.cuerpo, 5000),
    categorySlug: cleanString(body.categoria, 40),
    locationText: cleanString(body.ubicacion, 160),
    lat: toFloat(body.lat),
    lng: toFloat(body.lng),
    responsibleEntity: ENTITIES.includes(body.organismo) ? body.organismo : '',
    officialClaim: Boolean(body.reclamacion_oficial),
    officialReference: cleanString(body.referencia, 60),
    officialClaimDate: isIsoDate(body.fecha_reclamacion) ? String(body.fecha_reclamacion) : '',
  };
  const errors = [];
  if (values.title.length < 8) errors.push('El título debe tener al menos 8 caracteres.');
  if (values.body.length < 20) errors.push('Describe lo que ocurre con un poco más de detalle (mínimo 20 caracteres).');
  const category = categories.bySlug(values.categorySlug);
  if (!category) errors.push('Elige una categoría.');
  const hasLat = values.lat !== null && values.lat >= 35 && values.lat <= 44;
  const hasLng = values.lng !== null && values.lng >= -10 && values.lng <= 5;
  if (!hasLat || !hasLng) {
    values.lat = null;
    values.lng = null;
  }
  if (!values.officialClaim) {
    values.officialReference = '';
    values.officialClaimDate = '';
  }
  return { values, errors, category };
}

export function postRoutes({ config, services, uploader }) {
  const router = express.Router();

  const formLocals = (extra) => ({
    pageMeta: { title: extra.mode === 'edit' ? 'Editar publicación' : 'Nueva publicación', noindex: true },
    maxImages: config.upload.maxImages,
    maxMb: config.upload.maxMb,
    ...extra,
  });

  router.get('/incidencias/nueva', requireAuth, (req, res) => {
    // Al compartir algo desde el móvil hacia el foro, Android manda el título,
    // el texto y el enlace. Se aprovechan para no empezar con la hoja en blanco.
    const compartido = [cleanString(req.query.cuerpo, 5000), cleanString(req.query.enlace, 300)].filter(Boolean).join(SALTO);
    const values = {
      type: TYPES[req.query.tipo] ? req.query.tipo : 'incidencia',
      categorySlug: req.query.categoria || '',
      title: cleanString(req.query.titulo, 140),
      body: compartido,
    };
    res.render('pages/post-form', formLocals({ mode: 'new', values, errors: [], images: [] }));
  });

  router.post('/incidencias', requireAuth, postLimiter, uploader.images('imagenes'), verifyCsrf, async (req, res) => {
    const { values, errors, category } = validatePost(req.body, services.categories);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) {
      return res.status(422).render('pages/post-form', formLocals({ mode: 'new', values, errors, images: [] }));
    }
    const post = services.posts.create(
      {
        ...values,
        categoryId: category.id,
        status: values.officialClaim ? 'en_tramite' : 'abierta',
      },
      req.user.id
    );
    if (req.files?.length) {
      const stored = await uploader.store(req.files);
      services.posts.addImages(post.id, stored);
    }
    services.events.publicar('publicacion:nueva', {
      postId: post.id,
      slug: post.slug,
      titulo: post.title,
      tipo: values.type,
      categoria: category.name,
      categoriaSlug: category.slug,
      estado: post.status,
      autor: req.user.name,
    });
    req.flash('success', 'Publicado. Compártelo con tus vecinos para que lo apoyen.');
    return res.redirect(`/incidencias/${post.slug}`);
  });

  function loadPost(req, res, next) {
    const allowHidden = isMod(req.user);
    let post = services.posts.getBySlug(req.params.slug, { includeHidden: true });
    if (post && post.is_hidden && !allowHidden && post.author_id !== req.user?.id) post = null;
    if (!post) {
      const err = new Error('Publicación no encontrada');
      err.status = 404;
      return next(err);
    }
    req.post = post;
    return next();
  }

  router.get('/incidencias/:slug', loadPost, (req, res) => {
    const post = req.post;
    if (!req.user || req.user.id !== post.author_id) services.posts.incrementViews(post.id);
    const images = services.posts.images(post.id);
    const comments = services.comments.forPost(post.id, { includeHidden: isMod(req.user) });
    const history = services.posts.history(post.id);
    const related = services.posts
      .list({ categoryId: post.category_id, perPage: 4 })
      .items.filter((p) => p.id !== post.id)
      .slice(0, 3);
    res.render('pages/post', {
      pageMeta: {
        title: post.title,
        description: textoPlano(post.body, 160),
        image: images[0] ? `/uploads/${images[0].filename}` : null,
        type: 'article',
        noindex: Boolean(post.is_hidden),
        fichas: [
          fichaPublicacion(config, post, images, comments),
          migas(config, [['Inicio', '/'], ['Publicaciones', '/incidencias'], [post.category_name, `/incidencias?categoria=${post.category_slug}`], [post.title, `/incidencias/${post.slug}`]]),
        ],
      },
      post,
      images,
      comments,
      history,
      related,
      supported: services.posts.hasSupported(post.id, req.user?.id),
      share: isMod(req.user) ? services.shares.get(post.id) : null,
      canEdit: canEditPost(req.user, post),
      shareUrl: `${config.baseUrl}/incidencias/${post.slug}`,
      canDeleteComment: (c) => canDeleteComment(req.user, c),
    });
  });

  router.get('/incidencias/:slug/editar', requireAuth, loadPost, (req, res) => {
    if (!canEditPost(req.user, req.post)) return res.status(403).render('pages/error', { pageMeta: { title: 'Sin permiso', noindex: true }, status: 403, message: 'Solo el autor o la moderación pueden editar esta publicación.' });
    const p = req.post;
    const values = {
      type: p.type,
      title: p.title,
      body: p.body,
      categorySlug: p.category_slug,
      locationText: p.location_text || '',
      lat: p.lat,
      lng: p.lng,
      responsibleEntity: p.responsible_entity || '',
      officialClaim: Boolean(p.official_reference || p.official_claim_date),
      officialReference: p.official_reference || '',
      officialClaimDate: p.official_claim_date || '',
    };
    res.render('pages/post-form', formLocals({ mode: 'edit', post: p, values, errors: [], images: services.posts.images(p.id) }));
  });

  router.post('/incidencias/:slug/editar', requireAuth, loadPost, uploader.images('imagenes'), verifyCsrf, async (req, res) => {
    if (!canEditPost(req.user, req.post)) {
      const err = new Error('Solo el autor o la moderación pueden editar esta publicación.');
      err.status = 403;
      throw err;
    }
    const { values, errors, category } = validatePost(req.body, services.categories);
    if (req.uploadError) errors.push(req.uploadError);
    /* Dos personas pueden estar editando a la vez (el autor y un moderador).
       Si la publicación ha cambiado desde que se abrió el formulario, no se
       pisa el trabajo del otro: se avisa y se devuelve el texto escrito. */
    if (req.body.visto_en && req.body.visto_en !== req.post.updated_at) {
      errors.push('Alguien ha modificado esta publicación mientras la editabas. Revisa cómo está ahora y vuelve a guardar tus cambios.');
    }
    const existing = services.posts.images(req.post.id);
    if (existing.length + (req.files?.length || 0) > config.upload.maxImages) {
      errors.push(`Una publicación puede tener como máximo ${config.upload.maxImages} fotos.`);
    }
    if (errors.length) {
      return res.status(422).render('pages/post-form', formLocals({ mode: 'edit', post: req.post, values, errors, images: existing }));
    }
    const post = services.posts.update(req.post.id, { ...values, categoryId: category.id });
    services.events.publicar('publicacion:editada', { postId: post.id, slug: post.slug, titulo: post.title });
    if (req.files?.length) {
      const stored = await uploader.store(req.files);
      services.posts.addImages(post.id, stored);
    }
    req.flash('success', 'Publicación actualizada.');
    return res.redirect(`/incidencias/${post.slug}`);
  });

  router.post('/incidencias/:slug/eliminar', requireAuth, loadPost, async (req, res) => {
    if (!canEditPost(req.user, req.post)) {
      const err = new Error('No puedes eliminar esta publicación.');
      err.status = 403;
      throw err;
    }
    const files = services.posts.remove(req.post.id);
    await uploader.remove(files);
    req.flash('success', 'Publicación eliminada.');
    return res.redirect(isMod(req.user) && req.body.volver === 'admin' ? '/admin/publicaciones' : '/incidencias');
  });

  router.post('/incidencias/:slug/imagenes/:id/eliminar', requireAuth, loadPost, async (req, res) => {
    if (!canEditPost(req.user, req.post)) {
      const err = new Error('No puedes modificar esta publicación.');
      err.status = 403;
      throw err;
    }
    const img = services.posts.removeImage(Number(req.params.id), req.post.id);
    if (img) await uploader.remove([img.filename, img.thumb]);
    req.flash('success', 'Foto eliminada.');
    return res.redirect(`/incidencias/${req.post.slug}/editar`);
  });

  router.post('/incidencias/:slug/apoyar', requireAuth, loadPost, (req, res) => {
    const result = services.posts.toggleSupport(req.post.id, req.user.id);
    services.events.publicar('apoyo', { postId: req.post.id, slug: req.post.slug, apoyos: result.count });
    if (wantsJson(req)) return res.json(result);
    req.flash('success', result.supported ? 'Has apoyado esta publicación.' : 'Has retirado tu apoyo.');
    return res.redirect(`/incidencias/${req.post.slug}`);
  });

  router.post('/incidencias/:slug/estado', requireAuth, loadPost, (req, res) => {
    if (!canEditPost(req.user, req.post)) {
      const err = new Error('Solo el autor o la moderación pueden cambiar el estado.');
      err.status = 403;
      throw err;
    }
    const to = String(req.body.estado || '');
    if (!STATUSES[to]) {
      req.flash('error', 'Estado no válido.');
      return res.redirect(`/incidencias/${req.post.slug}`);
    }
    const note = cleanString(req.body.nota, 600);
    services.posts.changeStatus(req.post.id, to, { userId: req.user.id, note });
    services.events.publicar('estado', {
      postId: req.post.id,
      slug: req.post.slug,
      titulo: req.post.title,
      estado: to,
      etiqueta: STATUSES[to].label,
      color: STATUSES[to].color,
      por: req.user.name,
      nota: note,
    });
    req.flash('success', `Estado actualizado a «${STATUSES[to].label}».`);
    return res.redirect(`/incidencias/${req.post.slug}#historial`);
  });

  router.post('/incidencias/:slug/comentarios', requireAuth, commentLimiter, loadPost, (req, res) => {
    const body = cleanString(req.body.cuerpo, 2000);
    if (body.length < 2) {
      req.flash('error', 'El comentario está vacío.');
      return res.redirect(`/incidencias/${req.post.slug}#comentarios`);
    }
    if (req.post.status === 'cerrada' && !isMod(req.user)) {
      req.flash('error', 'Esta publicación está cerrada y no admite nuevos comentarios.');
      return res.redirect(`/incidencias/${req.post.slug}#comentarios`);
    }
    const id = services.comments.create(req.post.id, req.user.id, body);
    services.events.publicar('comentario:nuevo', {
      postId: req.post.id,
      slug: req.post.slug,
      titulo: req.post.title,
      comentarioId: id,
      autor: req.user.name,
    });
    req.flash('success', 'Comentario publicado.');
    return res.redirect(`/incidencias/${req.post.slug}#comentario-${id}`);
  });

  /**
   * Devuelve los comentarios publicados después de uno dado, ya pintados con el
   * mismo parcial que usa la página. Así lo que llega en vivo se ve exactamente
   * igual que lo que llega al recargar.
   */
  router.get('/incidencias/:slug/comentarios/nuevos', loadPost, (req, res, next) => {
    const desde = Number(req.query.desde) || 0;
    const todos = services.comments.forPost(req.post.id, { includeHidden: isMod(req.user) });
    const nuevos = todos.filter((c) => c.id > desde);
    const visibles = todos.filter((c) => !c.is_hidden).length;
    if (!nuevos.length) return res.json({ html: '', total: visibles, ultimo: desde });

    const pintar = (c) =>
      new Promise((resolve, reject) => {
        req.app.render(
          'partials/comment',
          { ...res.locals, c, post: req.post, canDeleteComment: (x) => canDeleteComment(req.user, x) },
          (err, html) => (err ? reject(err) : resolve(html))
        );
      });
    return Promise.all(nuevos.map(pintar))
      .then((partes) => res.json({ html: partes.join(''), total: visibles, ultimo: nuevos[nuevos.length - 1].id }))
      .catch(next);
  });

  router.post('/comentarios/:id/eliminar', requireAuth, (req, res) => {
    const comment = services.comments.getById(Number(req.params.id));
    if (!comment) {
      const err = new Error('Comentario no encontrado');
      err.status = 404;
      throw err;
    }
    if (!canDeleteComment(req.user, comment)) {
      const err = new Error('No puedes eliminar este comentario.');
      err.status = 403;
      throw err;
    }
    services.comments.remove(comment.id);
    services.events.publicar('comentario:fuera', { postId: comment.post_id, slug: comment.post_slug, comentarioId: comment.id });
    req.flash('success', 'Comentario eliminado.');
    return res.redirect(`/incidencias/${comment.post_slug}#comentarios`);
  });

  function handleReport(targetType) {
    return (req, res) => {
      const reason = REPORT_REASONS[req.body.motivo] ? req.body.motivo : 'otro';
      const details = cleanString(req.body.detalles, 500);
      let targetId;
      let slug;
      if (targetType === 'post') {
        targetId = req.post.id;
        slug = req.post.slug;
      } else {
        const comment = services.comments.getById(Number(req.params.id));
        if (!comment) {
          const err = new Error('Comentario no encontrado');
          err.status = 404;
          throw err;
        }
        targetId = comment.id;
        slug = comment.post_slug;
      }
      const created = services.reports.create({ targetType, targetId, reporterId: req.user.id, reason, details });
      if (created) {
        services.events.publicar(
          'denuncia',
          { tipo: targetType, slug, pendientes: services.reports.countPending() },
          { alcance: 'moderacion' }
        );
      }
      req.flash('success', created ? 'Gracias. La moderación revisará el contenido.' : 'Ya habías denunciado este contenido; está pendiente de revisión.');
      return res.redirect(`/incidencias/${slug}`);
    };
  }

  router.post('/incidencias/:slug/denunciar', requireAuth, loadPost, handleReport('post'));
  router.post('/comentarios/:id/denunciar', requireAuth, handleReport('comment'));

  return router;
}
