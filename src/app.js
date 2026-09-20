import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { ROOT_DIR } from './config.js';
import { openDatabase } from './db/index.js';
import { runSeed } from './db/seed.js';
import { createUsersService } from './services/users.js';
import { createCategoriesService } from './services/categories.js';
import { createPostsService } from './services/posts.js';
import { createCommentsService } from './services/comments.js';
import { createReportsService } from './services/reports.js';
import { createStatsService } from './services/stats.js';
import { createSharesService } from './services/shares.js';
import { createFacebookService } from './services/facebook.js';
import { createBusinessesService } from './services/businesses.js';
import { createOffersService } from './services/offers.js';
import { createProductsService } from './services/products.js';
import { createEventsService } from './services/events.js';
import { createMailService } from './services/correo.js';
import { createRecoveryService } from './services/recuperacion.js';
import { createSessionMiddleware } from './middleware/session.js';
import { flash } from './middleware/flash.js';
import { csrf } from './middleware/csrf.js';
import { attachUser } from './middleware/auth.js';
import { locals } from './middleware/locals.js';
import { createUploader } from './middleware/upload.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { indexRoutes } from './routes/index.js';
import { authRoutes } from './routes/auth.js';
import { postRoutes } from './routes/posts.js';
import { businessRoutes } from './routes/businesses.js';
import { adminRoutes } from './routes/admin.js';
import { apiRoutes } from './routes/api.js';
import { planosRoutes } from './routes/planos.js';
import { liveRoutes } from './routes/live.js';

export function createApp(config, { dbFile = config.dbFile } = {}) {
  const db = openDatabase(dbFile);
  const services = {
    users: createUsersService(db),
    categories: createCategoriesService(db),
    posts: createPostsService(db),
    comments: createCommentsService(db),
    reports: createReportsService(db),
    stats: createStatsService(db),
    shares: createSharesService(db),
    facebook: createFacebookService(config),
    businesses: createBusinessesService(db),
    offers: createOffersService(db),
    products: createProductsService(db),
    events: createEventsService(),
    correo: createMailService(config),
    recuperacion: createRecoveryService(db),
  };
  const seed = runSeed(db, services, config);
  // Los enlaces de recuperación caducados se borran solos.
  services.recuperacion.limpiar();
  setInterval(() => services.recuperacion.limpiar(), 24 * 60 * 60 * 1000).unref();
  const uploader = createUploader(config);
  const ctx = { config, db, services, uploader };

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT_DIR, 'src', 'views'));
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.disable('x-powered-by');
  if (config.isProduction) app.enable('view cache');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Sin 'unsafe-inline': no hay ni un solo script incrustado en las páginas.
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          // Las hojas de estilo son ficheros; lo único en línea son atributos style
          // con colores de categoría, que quedan permitidos aparte.
          styleSrc: ["'self'"],
          styleSrcAttr: ["'unsafe-inline'"],
          // Los planos del mapa y la búsqueda de direcciones pasan por el propio foro
          // (src/routes/planos.js): el navegador no habla con OpenStreetMap.
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          // Los formularios solo pueden enviarse a este mismo foro.
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: config.isProduction && config.baseUrl.startsWith('https') ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProduction && config.baseUrl.startsWith('https')
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    })
  );
  // El navegador no debe pedir cámara, micrófono ni pagos en nombre del foro.
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), accelerometer=()');
    next();
  });
  // La compresión no debe tocar el flujo de eventos en vivo: si lo guarda en un
  // búfer para comprimirlo, los avisos llegan tarde o no llegan.
  app.use(
    compression({
      filter: (req, res) =>
        !String(res.getHeader('Content-Type') || '').includes('text/event-stream') && compression.filter(req, res),
    })
  );

  // El service worker y el manifiesto mandan sobre el resto: si el navegador se
  // queda con una copia vieja, la app instalada nunca se entera de los cambios.
  app.use((req, res, next) => {
    if (req.path === '/sw.js' || req.path === '/manifest.webmanifest') res.set('Cache-Control', 'no-cache');
    next();
  });

  const staticOpts = { maxAge: config.isProduction ? '7d' : 0, etag: true };
  app.use('/vendor/leaflet', express.static(path.join(ROOT_DIR, 'node_modules', 'leaflet', 'dist'), { maxAge: '30d', immutable: true }));
  app.use(express.static(path.join(ROOT_DIR, 'public'), staticOpts));
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

  // Los planos del mapa van antes de sesiones y CSRF: cada vista pide decenas y no
  // necesitan nada de eso.
  app.use('/', planosRoutes(ctx));

  // Las páginas son dinámicas: que el navegador no reutilice HTML antiguo.
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Una sola dirección por página: «/incidencias/» manda a «/incidencias». Así
  // Google no reparte el valor de una página entre dos direcciones.
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.length > 1 && req.path.endsWith('/')) {
      const limpia = req.path.replace(/\/+$/, '') || '/';
      return res.redirect(301, limpia + req.originalUrl.slice(req.path.length));
    }
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '50kb' }));
  app.use(createSessionMiddleware(db, config));
  app.use(flash);
  app.use(attachUser(services.users));
  app.use(locals(config, services));
  app.use(csrf);

  app.use('/', indexRoutes(ctx));
  app.use('/', authRoutes(ctx));
  app.use('/', postRoutes(ctx));
  app.use('/', businessRoutes(ctx));
  app.use('/admin', adminRoutes(ctx));
  // La API no son páginas: que los buscadores no la indexen.
  app.use('/api', (req, res, next) => {
    res.set('X-Robots-Tag', 'noindex');
    next();
  });
  app.use('/api', liveRoutes(ctx));
  app.use('/api', apiRoutes(ctx));

  app.use(notFound);
  app.use(errorHandler(config));

  return { app, db, services, seed };
}
