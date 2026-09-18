/**
 * Bus de eventos en vivo.
 *
 * Cuando alguien publica, comenta, apoya o cambia un estado, aquí se anuncia y
 * todos los vecinos que tengan el foro abierto se enteran al momento, sin
 * recargar. Es memoria del proceso: no toca la base de datos y no guarda nada
 * permanente, así que un reinicio simplemente vacía el historial reciente.
 *
 * Cada evento lleva un `alcance`:
 *   - `publico`     lo puede ver cualquiera (una incidencia nueva, un comentario).
 *   - `moderacion`  solo moderadores y administración (denuncias, altas pendientes).
 */

const HISTORIAL_MAX = 300;

export function createEventsService({ maxClientes = 3000 } = {}) {
  let siguienteId = 1;
  const historial = [];
  const clientes = new Set();

  const puedeVer = (cliente, evento) => evento.alcance === 'publico' || cliente.alcance === 'moderacion';

  return {
    /** Anuncia un evento a quien esté conectado. Devuelve el evento con su id. */
    publicar(tipo, datos = {}, { alcance = 'publico' } = {}) {
      const evento = { id: siguienteId, tipo, alcance, ts: Date.now(), ...datos };
      siguienteId += 1;
      historial.push(evento);
      if (historial.length > HISTORIAL_MAX) historial.shift();
      for (const cliente of clientes) {
        if (puedeVer(cliente, evento)) {
          try {
            cliente.enviar(evento);
          } catch {
            // Si la conexión ya está rota, se limpiará sola al cerrarse.
          }
        }
      }
      return evento;
    },

    /**
     * Apunta a un cliente. Devuelve la función para darlo de baja, o `null` si
     * ya hay demasiadas conexiones abiertas (mejor rechazar que quedarse sin aire).
     */
    suscribir(cliente) {
      if (clientes.size >= maxClientes) return null;
      clientes.add(cliente);
      return () => clientes.delete(cliente);
    },

    /** Eventos posteriores a `id`, para que quien se reconecte no se pierda nada. */
    desde(id, cliente) {
      const ultimo = Number(id);
      if (!Number.isFinite(ultimo) || ultimo <= 0) return [];
      return historial.filter((e) => e.id > ultimo && puedeVer(cliente, e));
    },

    /** Id del último evento anunciado (0 si todavía no ha pasado nada). */
    ultimoId() {
      return siguienteId - 1;
    },

    conectados() {
      return clientes.size;
    },

    lleno() {
      return clientes.size >= maxClientes;
    },

    /** Cierra todas las conexiones. Se usa al apagar el servidor. */
    cerrarTodo() {
      for (const cliente of clientes) {
        try {
          cliente.cerrar();
        } catch {
          // da igual: el proceso se está apagando
        }
      }
      clientes.clear();
    },
  };
}
