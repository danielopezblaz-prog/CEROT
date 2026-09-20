import { escapeHtml } from '../utils/text.js';

/*
 * Envío de correo. El foro solo manda correos a quien los pide: el enlace para
 * recuperar la contraseña. No hay boletines ni avisos automáticos.
 *
 * No hace falta instalar nada: se habla con el proveedor por su API de internet.
 * Se elige en el .env con CORREO_PROVEEDOR:
 *
 *   brevo    Brevo (antes Sendinblue). Gratis hasta 300 correos al día.
 *   resend   Resend. Gratis hasta 3.000 correos al mes.
 *   consola  No envía nada: escribe el correo en el registro del servidor.
 *            Sirve para probar en el ordenador de casa.
 *
 * Vacío o sin clave, el foro se comporta como antes: no ofrece la recuperación
 * y le dice al vecino que escriba a la administración.
 */

const TIEMPO_MAXIMO_MS = 15000;

const PROVEEDORES = {
  brevo: {
    nombre: 'Brevo',
    url: 'https://api.brevo.com/v3/smtp/email',
    cabeceras: (clave) => ({ 'api-key': clave, 'content-type': 'application/json', accept: 'application/json' }),
    cuerpo: ({ remitente, nombre, para, asunto, texto, html }) => ({
      sender: { email: remitente, name: nombre },
      to: [{ email: para }],
      subject: asunto,
      textContent: texto,
      htmlContent: html,
    }),
  },
  resend: {
    nombre: 'Resend',
    url: 'https://api.resend.com/emails',
    cabeceras: (clave) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' }),
    cuerpo: ({ remitente, nombre, para, asunto, texto, html }) => ({
      from: `${nombre} <${remitente}>`,
      to: [para],
      subject: asunto,
      text: texto,
      html,
    }),
  },
};

/** Traduce los fallos del proveedor a algo que se entienda en el registro. */
function explicar(estado, payload) {
  const detalle = payload?.message || payload?.error?.message || payload?.name || '';
  if (estado === 401 || estado === 403) {
    return `El proveedor de correo rechaza la clave (CORREO_CLAVE). Genera una nueva y vuelve a ponerla en el .env. Detalle: ${detalle || 'sin detalle'}`;
  }
  if (estado === 422 || estado === 400) {
    return `El proveedor no acepta el remitente «CORREO_REMITENTE». Suele ser que falta verificarlo en su panel. Detalle: ${detalle || 'sin detalle'}`;
  }
  if (estado === 429) return 'Se ha agotado el cupo de correos del proveedor por hoy.';
  return `El proveedor de correo ha respondido ${estado}. ${detalle}`;
}

export function createMailService(config) {
  const { proveedor, clave, remitente, nombre } = config.correo;
  const ajustes = PROVEEDORES[proveedor];
  // «consola» funciona siempre; los demás necesitan clave y remitente.
  const activo = proveedor === 'consola' || Boolean(ajustes && clave && remitente);

  return {
    activo,
    proveedor,
    remitente,
    // Nombre para el aviso de privacidad: el vecino tiene derecho a saber por
    // dónde pasa su correo electrónico.
    nombreProveedor: ajustes?.nombre || '',

    /** Envía un correo. Devuelve true si el proveedor lo ha aceptado. */
    async enviar({ para, asunto, texto, html }) {
      if (!activo) throw new Error('El envío de correo no está configurado (CORREO_PROVEEDOR en el .env).');
      if (proveedor === 'consola') {
        console.log(`\n[correo] Para: ${para}\n[correo] Asunto: ${asunto}\n${texto}\n`);
        return true;
      }
      const respuesta = await fetch(config.correo.url || ajustes.url, {
        method: 'POST',
        headers: ajustes.cabeceras(clave),
        body: JSON.stringify(ajustes.cuerpo({ remitente, nombre, para, asunto, texto, html })),
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
      if (!respuesta.ok) {
        let payload = null;
        try {
          payload = await respuesta.json();
        } catch {
          /* el proveedor no siempre responde en JSON */
        }
        throw new Error(explicar(respuesta.status, payload));
      }
      return true;
    },
  };
}

/**
 * El correo con el enlace para recuperar la contraseña. Va en texto y en HTML:
 * los programas de correo antiguos, y los que bloquean el formato, enseñan el
 * texto, donde el enlace también aparece entero.
 */
export function correoDeRecuperacion({ site, enlace, nombre, minutos }) {
  const foro = `${site.brand} ${site.name}`;
  const asunto = `Recupera tu contraseña · ${foro}`;
  const saludo = nombre ? `Hola, ${nombre}:` : 'Hola:';
  const texto = [
    saludo,
    '',
    `Alguien ha pedido una contraseña nueva para tu cuenta del foro vecinal de ${site.name}.`,
    'Si has sido tú, abre este enlace y elige una contraseña nueva:',
    '',
    enlace,
    '',
    `El enlace caduca en ${minutos} minutos y solo se puede usar una vez.`,
    '',
    'Si no has sido tú, no hace falta que hagas nada: tu contraseña sigue siendo la misma.',
    '',
    '--',
    foro,
    site.contactEmail ? `Escríbenos a ${site.contactEmail} si necesitas ayuda.` : '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f4f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;padding:28px;" cellpadding="0" cellspacing="0">
      <tr><td>
        <p style="margin:0 0 4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#0f5c4c;font-weight:700;">${escapeHtml(foro)}</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">Elige una contraseña nueva</h1>
        <p style="margin:0 0 12px;font-size:16px;line-height:1.55;">${escapeHtml(saludo)}</p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.55;">Alguien ha pedido una contraseña nueva para tu cuenta del foro vecinal de ${escapeHtml(site.name)}. Si has sido tú, pulsa el botón:</p>
        <p style="margin:0 0 20px;"><a href="${escapeHtml(enlace)}" style="display:inline-block;background:#0f5c4c;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700;font-size:16px;">Poner una contraseña nueva</a></p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475569;">Si el botón no funciona, copia y pega esta dirección en el navegador:<br><span style="word-break:break-all;color:#0f5c4c;">${escapeHtml(enlace)}</span></p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475569;">El enlace caduca en ${minutos} minutos y solo se puede usar una vez.</p>
        <p style="margin:0;font-size:14px;line-height:1.55;color:#475569;"><strong>Si no has sido tú</strong>, no hace falta que hagas nada: tu contraseña sigue siendo la misma.</p>
      </td></tr>
    </table>
    ${site.contactEmail ? `<p style="max-width:520px;margin:16px auto 0;font-size:13px;color:#64748b;text-align:center;">¿Necesitas ayuda? Escríbenos a <a href="mailto:${escapeHtml(site.contactEmail)}" style="color:#0f5c4c;">${escapeHtml(site.contactEmail)}</a>.</p>` : ''}
  </td></tr></table>
</body></html>`;

  return { asunto, texto, html };
}
