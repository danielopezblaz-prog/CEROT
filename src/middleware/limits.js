import { rateLimit } from 'express-rate-limit';
import { wantsJson } from './auth.js';

function limiter({ windowMs, limit, message, skipFailedRequests = false, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    skipFailedRequests,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      if (wantsJson(req)) return res.status(429).json({ error: message });
      res.status(429);
      return res.render('pages/error', {
        pageMeta: { title: 'Demasiadas peticiones' },
        status: 429,
        message,
      });
    },
  });
}

/* Solo cuentan los intentos fallidos: entrar bien no gasta cupo, así que una
   familia o un locutorio con la misma IP no se quedan fuera. */
export const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  skipSuccessfulRequests: true,
  message: 'Demasiados intentos de acceso fallidos. Espera 15 minutos y vuelve a intentarlo.',
});

/**
 * Dos límites para el registro. El primero cuenta solo las altas que salen bien,
 * para que equivocarse rellenando el formulario no bloquee a nadie. El segundo
 * pone un tope al total de intentos, para frenar el abuso automatizado.
 */
export const registerLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  skipFailedRequests: true,
  message: 'Se han creado demasiadas cuentas desde esta conexión. Inténtalo más tarde.',
});

export const registerAttemptsLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: 'Demasiados intentos de registro desde esta conexión. Espera un rato y vuelve a intentarlo.',
});

export const postLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  message: 'Has publicado muchas veces en poco tiempo. Espera un rato antes de publicar de nuevo.',
});

export const commentLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: 'Has comentado muchas veces en poco tiempo. Espera un rato.',
});

/* Cada visita al mapa o al directorio consulta la API. Un colegio o una oficina
   salen a internet con una sola dirección, así que el tope va holgado. */
export const apiLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 1800,
  message: 'Demasiadas peticiones desde esta conexión. Espera un momento.',
});

/* Recuperar la contraseña. Cada intento manda un correo de verdad y el cupo del
   proveedor es limitado, así que el tope va corto. */
export const recuperarLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  message: 'Se han pedido demasiados enlaces de recuperación desde esta conexión. Espera una hora y vuelve a intentarlo.',
});

/* Abrir el enlace recibido y guardar la contraseña nueva. Va más holgado porque
   equivocarse eligiendo la contraseña no debe dejar a nadie fuera. */
export const recuperarEnlaceLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: 'Demasiados intentos desde esta conexión. Espera un rato y vuelve a intentarlo.',
});

/* Planos del mapa. Una visita al mapa pide entre 20 y 60 planos, y moverse por el
   barrio, unas decenas más; el tope frena a quien quiera descargar planos en masa
   a través del foro (OpenStreetMap acabaría bloqueando al servidor). Responde en
   texto plano porque va por delante de las sesiones y de las plantillas. */
export const planosLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).type('text/plain').send('Demasiados planos pedidos desde esta conexión. Espera un momento.'),
});

/* Búsqueda de direcciones: cada una es una petición a Nominatim, que solo admite
   una por segundo para todo el foro. */
export const busquedaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Demasiadas búsquedas de direcciones desde esta conexión. Espera un momento.' }),
});

/* Conexiones en vivo (SSE). Cada una dura hasta media hora, así que un vecino
   abre dos o tres por hora. El tope es alto porque una IP compartida (un colegio,
   una comunidad con un único router) concentra muchas a la vez. */
export const liveLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LIMITE_VIVO || 240),
  message: 'Demasiadas conexiones en vivo desde esta red. Espera un momento.',
});
