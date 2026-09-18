import express from 'express';
import { liveLimiter } from '../middleware/limits.js';

/* Cada arranque tiene su identificador. Si el cliente se reconecta y ve uno
   distinto, sabe que el servidor se ha reiniciado y que los números de evento
   han vuelto a empezar, así que no intenta recuperar lo que se perdió. */
const ARRANQUE = Math.random().toString(36).slice(2, 10);

const LATIDO_MS = 25000;
const VIDA_MAX_MS = 30 * 60 * 1000;

export function liveRoutes({ services }) {
  const router = express.Router();

  router.get('/eventos', liveLimiter, (req, res) => {
    const alcance = req.user && ['moderador', 'admin'].includes(req.user.role) ? 'moderacion' : 'publico';

    if (services.events.lleno()) {
      res.set('Retry-After', '60');
      return res.status(503).json({ error: 'Hay demasiadas conexiones en vivo abiertas. Inténtalo en un minuto.' });
    }

    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // `no-transform` evita que un proxy intermedio comprima o recorte el flujo.
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // Nginx guarda en un búfer lo que no se lo pida expresamente.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    req.socket?.setTimeout?.(0);
    res.socket?.setNoDelay?.(true);

    const escribir = (texto) => {
      if (!res.writableEnded) res.write(texto);
    };
    const enviar = (evento) => escribir(`id: ${evento.id}\nevent: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`);

    const cliente = { alcance, enviar, cerrar: () => res.end() };
    const baja = services.events.suscribir(cliente);
    if (!baja) {
      res.status(503).end();
      return undefined;
    }

    // Si se corta la conexión, que el navegador reintente en 5 segundos.
    escribir('retry: 5000\n\n');
    escribir(`event: hola\ndata: ${JSON.stringify({ arranque: ARRANQUE, ultimoId: services.events.ultimoId(), alcance })}\n\n`);

    // Lo ocurrido mientras el cliente estaba desconectado, si no se ha reiniciado el servidor.
    const desde = req.get('Last-Event-ID') || req.query.desde;
    if (desde && (!req.query.arranque || req.query.arranque === ARRANQUE)) {
      for (const evento of services.events.desde(desde, cliente)) enviar(evento);
    }

    const latido = setInterval(() => escribir(': latido\n\n'), LATIDO_MS);
    // Las conexiones no se eternizan: a la media hora se cierran y el navegador
    // vuelve a conectar solo. Así no se acumulan sockets olvidados.
    const caducidad = setTimeout(() => res.end(), VIDA_MAX_MS);

    const limpiar = () => {
      clearInterval(latido);
      clearTimeout(caducidad);
      baja();
    };
    res.on('close', limpiar);
    res.on('error', limpiar);
    return undefined;
  });

  return router;
}
