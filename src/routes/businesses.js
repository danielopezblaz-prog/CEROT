import express from 'express';
import { requireAuth, isMod } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { postLimiter } from '../middleware/limits.js';
import { cleanString, toFloat, toInt } from '../utils/text.js';
import { isIsoDate } from '../utils/filters.js';
import { BUSINESS_CATEGORY_MAP, BUSINESS_CATEGORIES, OFFER_TYPES } from '../utils/constants.js';
import { hoursFromForm, parseHours, emptyHours } from '../utils/hours.js';
import { fichaNegocio, migas, textoPlano } from '../utils/seo.js';

const MAX_GALLERY = 8;
const MAX_PRODUCTS = 60;
const BULK_PRODUCTS = 20;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Medidas de las fotos de producto: cuadradas, para que la cuadrícula quede uniforme. */
const PRODUCT_IMAGE = { width: 900, height: 900, fit: 'cover', thumb: { width: 440, height: 440 } };

/** Convierte a array los campos de un formulario que se repiten por filas. */
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Normaliza una URL escrita por el usuario, aceptando solo http y https. */
function cleanUrl(value, max = 200) {
  const raw = cleanString(value, max);
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

/** Deja el nombre de usuario de Instagram sin arroba ni URL. */
function cleanHandle(value) {
  const raw = cleanString(value, 60).replace(/^@+/, '');
  const m = raw.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = m ? m[1] : raw;
  return /^[A-Za-z0-9._]{1,40}$/.test(handle) ? handle : '';
}

function cleanPhone(value) {
  const raw = cleanString(value, 25).replace(/[^\d+\s]/g, '').trim();
  return raw.replace(/\s+/g, ' ').slice(0, 20);
}

export function validateBusiness(body) {
  const values = {
    name: cleanString(body.nombre, 80),
    category: BUSINESS_CATEGORY_MAP[body.categoria] ? body.categoria : '',
    shortDesc: cleanString(body.resumen, 140),
    description: cleanString(body.descripcion, 3000),
    address: cleanString(body.direccion, 160),
    lat: toFloat(body.lat),
    lng: toFloat(body.lng),
    phone: cleanPhone(body.telefono),
    whatsapp: cleanPhone(body.whatsapp),
    email: cleanString(body.email, 120),
    website: cleanUrl(body.web),
    instagram: cleanHandle(body.instagram),
    facebook: cleanUrl(body.facebook),
    hours: hoursFromForm(body),
  };
  const errors = [];
  if (values.name.length < 2) errors.push('Escribe el nombre del negocio.');
  if (!values.category) errors.push('Elige a qué se dedica el negocio.');
  if (values.shortDesc.length < 10) errors.push('Escribe una frase breve que describa el negocio (al menos 10 caracteres).');
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) errors.push('El correo de contacto no es válido.');
  const hasLat = values.lat !== null && values.lat >= 35 && values.lat <= 44;
  const hasLng = values.lng !== null && values.lng >= -10 && values.lng <= 5;
  if (!hasLat || !hasLng) {
    values.lat = null;
    values.lng = null;
  }
  return { values, errors };
}

export function validateOffer(body) {
  const values = {
    type: OFFER_TYPES[body.tipo] ? body.tipo : 'oferta',
    title: cleanString(body.titulo, 120),
    body: cleanString(body.cuerpo, 1500),
    priceText: cleanString(body.precio, 60),
    startsOn: isIsoDate(body.desde) ? String(body.desde) : '',
    endsOn: isIsoDate(body.hasta) ? String(body.hasta) : '',
    eventTime: TIME_RE.test(String(body.hora ?? '')) ? String(body.hora) : '',
  };
  const errors = [];
  if (values.title.length < 4) errors.push('Escribe un título para la publicación.');
  if (values.type === 'evento' && !values.startsOn) errors.push('Un evento necesita una fecha.');
  if (values.startsOn && values.endsOn && values.endsOn < values.startsOn) {
    errors.push('La fecha de fin no puede ser anterior a la de inicio.');
  }
  if (values.type === 'evento' && values.startsOn && !values.endsOn) values.endsOn = values.startsOn;
  if (values.type !== 'evento') values.eventTime = '';
  return { values, errors };
}

export function businessRoutes({ config, services, uploader }) {
  const router = express.Router();

  const uploadBusiness = uploader.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'portada', maxCount: 1 },
    { name: 'galeria', maxCount: MAX_GALLERY },
  ]);

  const canManage = (user, business) => Boolean(user && business && (isMod(user) || business.owner_id === user.id));

  /* Direcciones antiguas, de cuando la sección se llamaba «locales». */
  router.get('/ofertas', (req, res) => res.redirect(301, '/negocios/ofertas'));
  router.get('/locales', (req, res) => res.redirect(301, '/negocios'));
  router.get('/locales/*resto', (req, res) => {
    const resto = Array.isArray(req.params.resto) ? req.params.resto.join('/') : req.params.resto;
    res.redirect(301, `/negocios/${resto}`);
  });

  /* ---------- Directorio ---------- */

  router.get('/negocios', (req, res) => {
    const q = cleanString(req.query.q, 100);
    const category = BUSINESS_CATEGORY_MAP[req.query.categoria] ? req.query.categoria : '';
    const sort = ['alfabetico', 'recientes', 'ofertas', 'visitas'].includes(req.query.orden) ? req.query.orden : 'alfabetico';
    const withOffers = req.query.ofertas === '1';
    const page = Math.max(1, toInt(req.query.pagina, 1));
    const result = services.businesses.list({ q, category, sort, withOffers, page, perPage: 12 });
    const counts = services.businesses.categoriesWithCounts();
    const qs = (over = {}) => {
      const p = new URLSearchParams();
      const merged = { q, categoria: category, orden: sort === 'alfabetico' ? '' : sort, ofertas: withOffers ? '1' : '', pagina: page, ...over };
      for (const [k, v] of Object.entries(merged)) {
        if (v === '' || v === null || v === undefined) continue;
        if (k === 'pagina' && Number(v) <= 1) continue;
        p.set(k, String(v));
      }
      const s = p.toString();
      return s ? `?${s}` : '';
    };
    res.render('pages/businesses', {
      pageMeta: {
        title: `Comercios y negocios de ${config.site.name}`,
        description: `Directorio de comercios, bares y servicios de ${config.site.name}, en ${config.site.municipality}: horarios, teléfonos, ofertas y eventos.`,
      },
      result,
      counts,
      filters: { q, category, sort, withOffers, page, isActive: Boolean(q || category || withOffers || sort !== 'alfabetico') },
      qs,
      mapCount: services.businesses.count({ q, category, withOffers, withLocation: true }),
      offersCount: services.offers.countCurrent(),
      myBusinesses: req.user ? services.businesses.ownedBy(req.user.id) : [],
    });
  });

  router.get('/negocios/ofertas', (req, res) => {
    const type = OFFER_TYPES[req.query.tipo] ? req.query.tipo : '';
    const category = BUSINESS_CATEGORY_MAP[req.query.categoria] ? req.query.categoria : '';
    const page = Math.max(1, toInt(req.query.pagina, 1));
    const result = services.offers.current({ type, category, page, limit: 24 });
    const qs = (over = {}) => {
      const p = new URLSearchParams();
      const merged = { tipo: type, categoria: category, pagina: page, ...over };
      for (const [k, v] of Object.entries(merged)) {
        if (v === '' || v === null || v === undefined) continue;
        if (k === 'pagina' && Number(v) <= 1) continue;
        p.set(k, String(v));
      }
      const s = p.toString();
      return s ? `?${s}` : '';
    };
    res.render('pages/offers', {
      pageMeta: {
        title: 'Ofertas y eventos del barrio',
        description: `Ofertas del día, eventos y novedades de los comercios de ${config.site.name}, en ${config.site.municipality}.`,
      },
      result,
      filters: { type, category, page, isActive: Boolean(type || category) },
      qs,
      businessCount: services.businesses.count({ status: 'activo' }),
    });
  });

  /* ---------- Alta y edición ---------- */

  const formLocals = (extra) => ({
    pageMeta: { title: extra.mode === 'edit' ? 'Editar negocio' : 'Dar de alta un negocio', noindex: true },
    categories: BUSINESS_CATEGORIES,
    maxGallery: MAX_GALLERY,
    maxMb: config.upload.maxMb,
    ...extra,
  });

  router.get('/negocios/nuevo', requireAuth, (req, res) => {
    res.render('pages/business-form', formLocals({ mode: 'new', values: { hours: emptyHours() }, errors: [], images: [], business: null }));
  });

  router.post('/negocios', requireAuth, postLimiter, uploadBusiness, verifyCsrf, async (req, res) => {
    const { values, errors } = validateBusiness(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) {
      return res.status(422).render('pages/business-form', formLocals({ mode: 'new', values, errors, images: [], business: null }));
    }
    // La moderación puede publicar directamente; el resto pasa por revisión.
    const status = isMod(req.user) ? 'activo' : 'pendiente';
    const business = services.businesses.create(values, req.user.id, { status });
    await saveBusinessFiles(business, req);
    if (status === 'activo') {
      services.events.publicar('negocio:aprobado', { negocioId: business.id, slug: business.slug, nombre: business.name });
    } else {
      // Solo la moderación ve que hay una ficha esperando.
      services.events.publicar(
        'pendientes',
        { negocios: services.businesses.countPending(), nombre: business.name },
        { alcance: 'moderacion' }
      );
    }
    req.flash(
      'success',
      status === 'activo'
        ? 'Negocio publicado en el directorio.'
        : 'Negocio enviado. La moderación lo revisará y lo publicará en cuanto pueda. Mientras tanto puedes seguir completando su ficha.'
    );
    return res.redirect(`/negocios/${business.slug}`);
  });

  async function saveBusinessFiles(business, req) {
    const files = req.files || {};
    if (files.logo?.[0]) {
      const logo = await uploader.storeOne(files.logo[0], { width: 400, height: 400, fit: 'cover' });
      services.businesses.setLogo(business.id, logo.filename);
    }
    if (files.portada?.[0]) {
      const cover = await uploader.storeOne(files.portada[0], { width: 1600, height: 700, fit: 'cover', thumb: { width: 720, height: 400 } });
      services.businesses.setCover(business.id, cover.filename, cover.thumb);
    }
    if (files.galeria?.length) {
      const room = Math.max(0, MAX_GALLERY - services.businesses.imageCount(business.id));
      const stored = await uploader.store(files.galeria.slice(0, room));
      if (stored.length) services.businesses.addImages(business.id, stored);
    }
  }

  function loadBusiness(req, res, next) {
    const business = services.businesses.getBySlug(req.params.slug);
    if (!business) {
      const err = new Error('Negocio no encontrado');
      err.status = 404;
      return next(err);
    }
    // Los negocios pendientes o suspendidos solo los ve su dueño y la moderación.
    if (business.status !== 'activo' && !canManage(req.user, business)) {
      const err = new Error('Negocio no encontrado');
      err.status = 404;
      return next(err);
    }
    req.business = business;
    return next();
  }

  router.get('/negocios/:slug', loadBusiness, (req, res) => {
    const business = req.business;
    if (!req.user || req.user.id !== business.owner_id) services.businesses.incrementViews(business.id);
    const manage = canManage(req.user, business);
    const hours = parseHours(business.hours);
    const categoria = (BUSINESS_CATEGORY_MAP[business.category] || { name: 'Comercio' }).name;
    res.render('pages/business', {
      pageMeta: {
        title: business.name,
        description: textoPlano(`${categoria} en ${config.site.name}, ${config.site.municipality}. ${business.short_desc || business.description || ''}`, 160),
        image: business.cover ? `/uploads/${business.cover}` : null,
        noindex: business.status !== 'activo',
        fichas: [
          fichaNegocio(config, business, hours),
          migas(config, [['Inicio', '/'], ['Negocios', '/negocios'], [categoria, `/negocios?categoria=${business.category}`], [business.name, `/negocios/${business.slug}`]]),
        ],
      },
      business,
      hours,
      images: services.businesses.images(business.id),
      offers: services.offers.forBusiness(business.id, { onlyCurrent: !manage }),
      products: services.products.forBusiness(business.id, { onlyAvailable: !manage }),
      canManage: manage,
      shareUrl: `${config.baseUrl}/negocios/${business.slug}`,
      related: services.businesses
        .list({ category: business.category, perPage: 4 })
        .items.filter((b) => b.id !== business.id)
        .slice(0, 3),
    });
  });

  router.get('/negocios/:slug/editar', requireAuth, loadBusiness, (req, res, next) => {
    if (!canManage(req.user, req.business)) {
      const err = new Error('Solo quien gestiona el negocio puede editarlo.');
      err.status = 403;
      return next(err);
    }
    const b = req.business;
    const values = {
      name: b.name, category: b.category, shortDesc: b.short_desc || '', description: b.description || '',
      address: b.address || '', lat: b.lat, lng: b.lng, phone: b.phone || '', whatsapp: b.whatsapp || '',
      email: b.email || '', website: b.website || '', instagram: b.instagram || '', facebook: b.facebook || '',
      hours: parseHours(b.hours),
    };
    return res.render('pages/business-form', formLocals({ mode: 'edit', business: b, values, errors: [], images: services.businesses.images(b.id) }));
  });

  router.post('/negocios/:slug/editar', requireAuth, loadBusiness, uploadBusiness, verifyCsrf, async (req, res, next) => {
    if (!canManage(req.user, req.business)) {
      const err = new Error('Solo quien gestiona el negocio puede editarlo.');
      err.status = 403;
      return next(err);
    }
    const { values, errors } = validateBusiness(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) {
      return res.status(422).render(
        'pages/business-form',
        formLocals({ mode: 'edit', business: req.business, values, errors, images: services.businesses.images(req.business.id) })
      );
    }
    const business = services.businesses.update(req.business.id, values);
    await saveBusinessFiles(business, req);
    req.flash('success', 'Ficha del negocio actualizada.');
    return res.redirect(`/negocios/${business.slug}`);
  });

  router.post('/negocios/:slug/imagenes/:id/eliminar', requireAuth, loadBusiness, async (req, res, next) => {
    if (!canManage(req.user, req.business)) {
      const err = new Error('No puedes modificar este negocio.');
      err.status = 403;
      return next(err);
    }
    const img = services.businesses.removeImage(Number(req.params.id), req.business.id);
    if (img) await uploader.remove([img.filename, img.thumb]);
    req.flash('success', 'Foto eliminada.');
    return res.redirect(`/negocios/${req.business.slug}/editar`);
  });

  router.post('/negocios/:slug/eliminar', requireAuth, loadBusiness, async (req, res, next) => {
    if (!canManage(req.user, req.business)) {
      const err = new Error('No puedes eliminar este negocio.');
      err.status = 403;
      return next(err);
    }
    const files = services.businesses.remove(req.business.id);
    await uploader.remove(files);
    req.flash('success', 'Negocio eliminado del directorio.');
    return res.redirect(isMod(req.user) && req.body.volver === 'admin' ? '/admin/negocios' : '/negocios');
  });

  /* ---------- Catálogo de productos ---------- */

  function requireManage(req, res, next) {
    if (!canManage(req.user, req.business)) {
      const err = new Error('Solo quien gestiona el negocio puede tocar su catálogo.');
      err.status = 403;
      return next(err);
    }
    return next();
  }

  const productsView = (req, extra = {}) => ({
    pageMeta: { title: `Productos de ${req.business.name}`, noindex: true },
    business: req.business,
    products: services.products.forBusiness(req.business.id),
    unnamed: services.products.countUnnamed(req.business.id),
    maxProducts: MAX_PRODUCTS,
    bulkMax: BULK_PRODUCTS,
    maxMb: config.upload.maxMb,
    errors: [],
    values: {},
    ...extra,
  });

  router.get('/negocios/:slug/productos', requireAuth, loadBusiness, requireManage, (req, res) =>
    res.render('pages/products', productsView(req))
  );

  /** Alta de un producto con su foto. */
  router.post('/negocios/:slug/productos', requireAuth, loadBusiness, requireManage, uploader.images('foto', 1), verifyCsrf, async (req, res) => {
    const errors = [];
    if (req.uploadError) errors.push(req.uploadError);
    const name = cleanString(req.body.nombre, 80);
    const priceText = cleanString(req.body.precio, 40);
    const description = cleanString(req.body.descripcion, 300);
    if (name.length < 2) errors.push('Escribe el nombre del producto.');
    if (services.products.count(req.business.id) >= MAX_PRODUCTS) {
      errors.push(`Has alcanzado el máximo de ${MAX_PRODUCTS} productos. Elimina alguno para añadir otro.`);
    }
    if (errors.length) {
      return res.status(422).render('pages/products', productsView(req, { errors, values: { name, priceText, description } }));
    }

    const product = services.products.create(req.business.id, { name, priceText, description });
    if (req.files?.[0]) {
      const img = await uploader.storeOne(req.files[0], PRODUCT_IMAGE);
      services.products.setImage(product.id, req.business.id, img.filename, img.thumb);
    }
    req.flash('success', `«${name}» añadido al catálogo.`);
    return res.redirect(`/negocios/${req.business.slug}/productos`);
  });

  /** Subida de varias fotos de golpe: crea un producto por foto, pendiente de nombrar. */
  router.post('/negocios/:slug/productos/varias', requireAuth, loadBusiness, requireManage, uploader.images('fotos', BULK_PRODUCTS), verifyCsrf, async (req, res) => {
    if (req.uploadError) {
      req.flash('error', req.uploadError);
      return res.redirect(`/negocios/${req.business.slug}/productos`);
    }
    const room = Math.max(0, MAX_PRODUCTS - services.products.count(req.business.id));
    const files = (req.files || []).slice(0, room);
    if (!files.length) {
      req.flash('error', room === 0 ? `Has alcanzado el máximo de ${MAX_PRODUCTS} productos.` : 'No has elegido ninguna foto.');
      return res.redirect(`/negocios/${req.business.slug}/productos`);
    }
    const stored = [];
    for (const f of files) stored.push(await uploader.storeOne(f, PRODUCT_IMAGE));
    services.products.createFromImages(req.business.id, stored);
    req.flash('success', `${stored.length} ${stored.length === 1 ? 'foto añadida' : 'fotos añadidas'}. Ponles nombre y precio abajo y guarda los cambios.`);
    return res.redirect(`/negocios/${req.business.slug}/productos#lista`);
  });

  /** Guarda de una vez los nombres, precios y estados de toda la tabla. */
  router.post('/negocios/:slug/productos/guardar', requireAuth, loadBusiness, requireManage, uploader.anyFiles(MAX_PRODUCTS), verifyCsrf, async (req, res) => {
    const ids = asArray(req.body.id).map((v) => toInt(v)).filter(Boolean);
    const names = asArray(req.body.nombre);
    const prices = asArray(req.body.precio);
    const descriptions = asArray(req.body.descripcion);
    const available = new Set(asArray(req.body.disponible).map(Number));
    const featured = new Set(asArray(req.body.destacado).map(Number));
    const existing = new Set(services.products.forBusiness(req.business.id).map((p) => p.id));

    const rows = ids
      .filter((id) => existing.has(id))
      .map((id, i) => ({
        id,
        name: cleanString(names[i], 80),
        priceText: cleanString(prices[i], 40),
        description: cleanString(descriptions[i], 300),
        isAvailable: available.has(id),
        isFeatured: featured.has(id),
      }));
    services.products.saveAll(req.business.id, rows);

    // Fotos sustituidas fila a fila: los campos se llaman foto_<id>
    for (const file of req.files || []) {
      const id = toInt(String(file.fieldname).replace('foto_', ''));
      if (!id || !existing.has(id)) continue;
      const previous = services.products.getById(id, req.business.id);
      const img = await uploader.storeOne(file, PRODUCT_IMAGE);
      services.products.setImage(id, req.business.id, img.filename, img.thumb);
      if (previous?.image) await uploader.remove([previous.image, previous.thumb]);
    }

    req.flash('success', req.uploadError ? `Cambios guardados, pero ${req.uploadError}` : 'Catálogo actualizado.');
    return res.redirect(`/negocios/${req.business.slug}/productos#lista`);
  });

  router.post('/negocios/:slug/productos/:id/eliminar', requireAuth, loadBusiness, requireManage, async (req, res) => {
    const files = services.products.remove(toInt(req.params.id), req.business.id);
    await uploader.remove(files);
    req.flash('success', 'Producto eliminado del catálogo.');
    return res.redirect(`/negocios/${req.business.slug}/productos#lista`);
  });

  router.post('/negocios/:slug/productos/:id/mover', requireAuth, loadBusiness, requireManage, (req, res) => {
    const direction = req.body.direccion === 'subir' ? 'subir' : 'bajar';
    services.products.move(toInt(req.params.id), req.business.id, direction);
    return res.redirect(`/negocios/${req.business.slug}/productos#lista`);
  });

  /* ---------- Ofertas, eventos y novedades ---------- */

  const offerLocals = (extra) => ({
    pageMeta: { title: extra.mode === 'edit' ? 'Editar publicación' : 'Nueva oferta o evento', noindex: true },
    maxMb: config.upload.maxMb,
    ...extra,
  });

  router.get('/negocios/:slug/publicaciones/nueva', requireAuth, loadBusiness, (req, res, next) => {
    if (!canManage(req.user, req.business)) {
      const err = new Error('Solo quien gestiona el negocio puede publicar.');
      err.status = 403;
      return next(err);
    }
    const type = OFFER_TYPES[req.query.tipo] ? req.query.tipo : 'oferta';
    return res.render('pages/offer-form', offerLocals({ mode: 'new', business: req.business, offer: null, values: { type }, errors: [] }));
  });

  router.post('/negocios/:slug/publicaciones', requireAuth, loadBusiness, postLimiter, uploader.images('imagen'), verifyCsrf, async (req, res, next) => {
    if (!canManage(req.user, req.business)) {
      const err = new Error('Solo quien gestiona el negocio puede publicar.');
      err.status = 403;
      return next(err);
    }
    const { values, errors } = validateOffer(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) {
      return res.status(422).render('pages/offer-form', offerLocals({ mode: 'new', business: req.business, offer: null, values, errors }));
    }
    const offer = services.offers.create(req.business.id, values);
    if (req.files?.[0]) {
      const img = await uploader.storeOne(req.files[0], { width: 1200, height: 800, fit: 'cover', thumb: { width: 640, height: 430 } });
      services.offers.setImage(offer.id, img.filename, img.thumb);
    }
    services.events.publicar('oferta:nueva', {
      negocio: req.business.name,
      negocioSlug: req.business.slug,
      titulo: values.title,
      tipo: values.type,
    });
    req.flash('success', `${OFFER_TYPES[values.type].label} publicada.`);
    return res.redirect(`/negocios/${req.business.slug}#publicaciones`);
  });

  function loadOffer(req, res, next) {
    const offer = services.offers.getById(Number(req.params.id));
    if (!offer || offer.business_id !== req.business.id) {
      const err = new Error('Publicación no encontrada');
      err.status = 404;
      return next(err);
    }
    if (!canManage(req.user, req.business)) {
      const err = new Error('Solo quien gestiona el negocio puede modificarla.');
      err.status = 403;
      return next(err);
    }
    req.offer = offer;
    return next();
  }

  router.get('/negocios/:slug/publicaciones/:id/editar', requireAuth, loadBusiness, loadOffer, (req, res) => {
    const o = req.offer;
    const values = {
      type: o.type, title: o.title, body: o.body || '', priceText: o.price_text || '',
      startsOn: o.starts_on || '', endsOn: o.ends_on || '', eventTime: o.event_time || '',
    };
    res.render('pages/offer-form', offerLocals({ mode: 'edit', business: req.business, offer: o, values, errors: [] }));
  });

  router.post('/negocios/:slug/publicaciones/:id/editar', requireAuth, loadBusiness, uploader.images('imagen'), verifyCsrf, loadOffer, async (req, res) => {
    const { values, errors } = validateOffer(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) {
      return res.status(422).render('pages/offer-form', offerLocals({ mode: 'edit', business: req.business, offer: req.offer, values, errors }));
    }
    services.offers.update(req.offer.id, values);
    if (req.files?.[0]) {
      if (req.offer.image) await uploader.remove([req.offer.image, req.offer.thumb]);
      const img = await uploader.storeOne(req.files[0], { width: 1200, height: 800, fit: 'cover', thumb: { width: 640, height: 430 } });
      services.offers.setImage(req.offer.id, img.filename, img.thumb);
    }
    req.flash('success', 'Publicación actualizada.');
    return res.redirect(`/negocios/${req.business.slug}#publicaciones`);
  });

  router.post('/negocios/:slug/publicaciones/:id/eliminar', requireAuth, loadBusiness, loadOffer, async (req, res) => {
    const files = services.offers.remove(req.offer.id);
    await uploader.remove(files);
    req.flash('success', 'Publicación eliminada.');
    return res.redirect(`/negocios/${req.business.slug}#publicaciones`);
  });

  return router;
}
