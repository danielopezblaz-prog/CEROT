import { STATUSES, TYPES } from '../utils/constants.js';
import { excerpt } from '../utils/text.js';

const TIMEOUT_MS = 15000;

/**
 * Texto que se publica en Facebook. Edita esta función para cambiar el estilo.
 * En Facebook no hay negritas ni enlaces con texto, así que se usa texto plano;
 * los pocos símbolos sirven para dar estructura visual a la publicación.
 */
export function composeMessage(post, url, site) {
  const status = STATUSES[post.status]?.label ?? post.status;
  const type = TYPES[post.type]?.label ?? post.type;
  const lines = [];

  lines.push(`${type.toUpperCase()} · ${status.toUpperCase()} · ${post.category_name}`);
  lines.push('');
  lines.push(post.title);
  lines.push('');
  lines.push(excerpt(post.body, 400));
  lines.push('');
  if (post.location_text) lines.push(`📍 ${post.location_text}`);
  if (post.support_count > 0) {
    lines.push(`👍 ${post.support_count} ${post.support_count === 1 ? 'vecino la apoya' : 'vecinos la apoyan'}`);
  }
  if (post.official_reference) lines.push(`📄 Reclamación oficial nº ${post.official_reference}`);
  lines.push('');
  lines.push('Apoya, comenta o cuenta tu caso en el foro vecinal:');
  lines.push(url);
  lines.push('');
  lines.push(`${hashtag(site.name)} ${hashtag(site.municipality)}`);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function hashtag(text) {
  const clean = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return clean ? `#${clean}` : '';
}

/** Traduce los errores de la API de Meta a algo que un vecino pueda entender. */
function friendlyError(payload, httpStatus) {
  const err = payload?.error ?? {};
  const code = Number(err.code);
  if (code === 190) {
    return 'El token de Facebook ha caducado o ha dejado de ser válido. Genera uno nuevo y actualiza FACEBOOK_PAGE_TOKEN.';
  }
  if (code === 10 || code === 200 || code === 299) {
    return 'Facebook rechaza la publicación por falta de permisos. Revisa que la aplicación tenga concedido pages_manage_posts y que sigas siendo administrador de la página.';
  }
  if (code === 100) {
    return `Facebook no acepta los datos enviados. Revisa el identificador de la página. Detalle: ${err.message || 'sin detalle'}`;
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return 'Facebook ha limitado temporalmente las publicaciones de esta aplicación. Espera un rato e inténtalo de nuevo.';
  }
  if (err.message) return `Facebook ha devuelto un error: ${err.message}`;
  return `Facebook ha devuelto un error inesperado (código HTTP ${httpStatus}).`;
}

export function createFacebookService(config) {
  const fb = config.facebook;

  async function call(path, params, method = 'POST') {
    const body = new URLSearchParams({ ...params, access_token: fb.token });
    const url = `${fb.apiBase}/${fb.apiVersion}/${path}`;
    let res;
    let payload;
    try {
      res = await fetch(method === 'POST' ? url : `${url}?${body}`, {
        method,
        body: method === 'POST' ? body : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      payload = await res.json();
    } catch (cause) {
      const message =
        cause?.name === 'TimeoutError'
          ? 'Facebook ha tardado demasiado en responder. Inténtalo de nuevo en unos minutos.'
          : 'No se ha podido conectar con Facebook. Comprueba la conexión a internet del servidor.';
      throw Object.assign(new Error(message), { status: 502, cause });
    }
    if (!res.ok || payload?.error) {
      throw Object.assign(new Error(friendlyError(payload, res.status)), { status: 502, graph: payload?.error });
    }
    return payload;
  }

  return {
    get enabled() {
      return fb.enabled;
    },

    get pageId() {
      return fb.pageId;
    },

    /** Publica una entrada del foro en la página de Facebook. Devuelve { id, url }. */
    async share(post) {
      if (!fb.enabled) {
        throw Object.assign(new Error('La conexión con Facebook no está configurada.'), { status: 400 });
      }
      const link = `${config.baseUrl}/incidencias/${post.slug}`;
      const message = composeMessage(post, link, config.site);
      const data = await call(`${fb.pageId}/feed`, { message, link });
      const id = String(data.id ?? '');
      if (!id) {
        throw Object.assign(new Error('Facebook no ha devuelto el identificador de la publicación.'), { status: 502 });
      }
      return { id, url: `https://www.facebook.com/${id}` };
    },

    /** Borra de Facebook una publicación compartida antes. */
    async remove(externalId) {
      if (!fb.enabled) {
        throw Object.assign(new Error('La conexión con Facebook no está configurada.'), { status: 400 });
      }
      await call(String(externalId), {}, 'DELETE');
      return true;
    },
  };
}
