import { escapeHtml } from '../utils/text.js';

/*
 * Envío de correo. El foro solo manda correos a quien los pide: el enlace para
 * recuperar la contraseña. No hay boletines ni avisos automáticos.
 *
 * No hace falta instalar nada: se habla con el proveedor por su API de internet.
 * Se elige en el .env con CORREO_PROVEEDOR:
 *
 *   smtp     El buzón de correo que ya tengas: el de tu dominio, el de Gmail,
 *            el de Hostinger. Los correos salen desde tu propia cuenta.
 *   brevo    Brevo (antes Sendinblue). Gratis hasta 300 correos al día.
 *   resend   Resend. Gratis hasta 3.000 correos al mes.
 *   consola  No envía nada: escribe el correo en el registro del servidor.
 *            Sirve para probar en el ordenador de casa.
 *
 * Vacío o sin clave, el foro se comporta como antes: no ofrece la recuperación
 * y le dice al vecino que escriba a la administración.
 *
 * Lo que NO se puede hacer es enviar desde el servidor sin pasar por ningún
 * buzón: el puerto que usan los correos entre servidores viene cerrado en casi
 * todos los alojamientos, y Gmail y Outlook tiran a la basura lo que llega de
 * una máquina recién estrenada y sin historial.
 */

const TIEMPO_MAXIMO_MS = 15000;

const PROVEEDORES = {
  brevo: {
    nombre: 'Brevo',
    url: 'https://api.brevo.com/v3/smtp/email',
    cabeceras: (clave) => ({ 'api-key': clave, 'content-type': 'application/json', accept: 'application/json' }),
    cuerpo: ({ remitente, nombre, para, asunto, texto, html, responderA }) => ({
      sender: { email: remitente, name: nombre },
      to: [{ email: para }],
      ...(responderA ? { replyTo: { email: responderA } } : {}),
      subject: asunto,
      textContent: texto,
      htmlContent: html,
    }),
  },
  resend: {
    nombre: 'Resend',
    url: 'https://api.resend.com/emails',
    cabeceras: (clave) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' }),
    cuerpo: ({ remitente, nombre, para, asunto, texto, html, responderA }) => ({
      from: `${nombre} <${remitente}>`,
      to: [para],
      ...(responderA ? { reply_to: responderA } : {}),
      subject: asunto,
      text: texto,
      html,
    }),
  },
};

/* Puertos del correo saliente:
     465  va cifrado desde el primer momento
     587  empieza en claro y se cifra enseguida (STARTTLS); es el más habitual */
const PUERTO_CIFRADO_DIRECTO = 465;

/** Traduce los fallos de un buzón propio (SMTP) a algo que se entienda. */
function explicarSmtp(err) {
  const codigo = String(err?.code || '');
  const respuesta = String(err?.response || err?.message || '');
  if (codigo === 'EAUTH' || /535|534|password not accepted/i.test(respuesta)) {
    return `El buzón rechaza el usuario o la contraseña (CORREO_USUARIO / CORREO_CLAVE). Con Gmail hace falta una «contraseña de aplicación», no la de siempre. Detalle: ${respuesta}`;
  }
  if (codigo === 'ETIMEDOUT' || codigo === 'ESOCKET' || codigo === 'ECONNREFUSED' || codigo === 'ECONNECTION') {
    return `No se ha podido conectar con el servidor de correo. Revisa CORREO_SERVIDOR y CORREO_PUERTO, y que el alojamiento no tenga cerrada la salida. Detalle: ${respuesta || codigo}`;
  }
  if (/550|553|relay|not permitted/i.test(respuesta)) {
    return `El buzón no deja enviar con ese remitente. CORREO_REMITENTE suele tener que ser la misma dirección de CORREO_USUARIO. Detalle: ${respuesta}`;
  }
  return `El buzón de correo ha fallado: ${respuesta || codigo || 'sin detalle'}`;
}

/** Traduce los fallos del proveedor a algo que se entienda en el registro. */
function explicar(estado, payload) {
  const detalle = payload?.message || payload?.error?.message || payload?.name || '';
  // Brevo bloquea por omisión las peticiones que llegan desde una dirección IP
  // que no ha visto antes, y contesta con el mismo código que una clave mala.
  // Sin distinguirlo, el aviso mandaba a generar otra clave, que no arregla nada.
  if (/unrecogni[sz]ed IP|authori[sz]ed_ips|unknown IP/i.test(detalle)) {
    // Sin el último carácter no numérico se colaría el punto final de la frase.
    const ip = detalle.match(/IP address ([0-9a-fA-F.:]*[0-9a-fA-F])/)?.[1] || 'la de este servidor';
    return `El proveedor no conoce la dirección de este servidor (${ip}) y la bloquea. No hace falta cambiar la clave: entra en https://app.brevo.com/security/authorised_ips y añade esa dirección a la lista. Detalle: ${detalle}`;
  }
  if (estado === 401 || estado === 403) {
    return `El proveedor de correo rechaza la clave (CORREO_CLAVE). Genera una nueva y vuelve a ponerla en el .env. Detalle: ${detalle || 'sin detalle'}`;
  }
  // Un 400 puede ser por el remitente o por el destinatario. Decirlo mal manda a
  // revisar el panel del proveedor cuando lo que hay es una dirección mal escrita.
  if (/\bin to\b|to\.email|recipient|destinatar/i.test(detalle)) {
    return `El proveedor dice que la dirección de destino no es válida. Repásala letra a letra: lo más habitual es una errata en el dominio, por ejemplo «gmial» en vez de «gmail». Detalle: ${detalle}`;
  }
  if (estado === 422 || estado === 400) {
    return `El proveedor no acepta el remitente «CORREO_REMITENTE». Suele ser que falta verificarlo en su panel. Detalle: ${detalle || 'sin detalle'}`;
  }
  if (estado === 429) return 'Se ha agotado el cupo de correos del proveedor por hoy.';
  return `El proveedor de correo ha respondido ${estado}. ${detalle}`;
}

export function createMailService(config) {
  const { proveedor, clave, remitente, nombre, servidor, puerto, usuario } = config.correo;
  /* Los correos pueden salir de una dirección que no recibe nada, por ejemplo
     foro@tudominio.es sin buzón contratado. Para que una respuesta no se pierda,
     se dirige al correo de contacto del foro cuando es otro distinto. */
  const responderA = config.site.contactEmail && config.site.contactEmail !== remitente ? config.site.contactEmail : '';
  const ajustes = PROVEEDORES[proveedor];
  const esSmtp = proveedor === 'smtp';
  // «consola» funciona siempre; el buzón propio necesita servidor y cuenta; los
  // demás, clave y remitente.
  const activo =
    proveedor === 'consola' ||
    (esSmtp ? Boolean(servidor && usuario && clave && remitente) : Boolean(ajustes && clave && remitente));

  /* El buzón propio se abre la primera vez que hace falta y se reutiliza: así
     no se paga la conexión en cada correo ni se carga la librería si no se usa. */
  let transporte = null;
  async function abrirBuzon() {
    if (!transporte) {
      const { default: nodemailer } = await import('nodemailer');
      transporte = nodemailer.createTransport({
        host: servidor,
        port: puerto,
        secure: puerto === PUERTO_CIFRADO_DIRECTO,
        requireTLS: puerto !== PUERTO_CIFRADO_DIRECTO,
        auth: { user: usuario, pass: clave },
        connectionTimeout: TIEMPO_MAXIMO_MS,
        greetingTimeout: TIEMPO_MAXIMO_MS,
        socketTimeout: TIEMPO_MAXIMO_MS,
        // Solo lo usan las pruebas automáticas, para hablar con un buzón fingido.
        ...(config.correo.opciones || {}),
      });
    }
    return transporte;
  }

  return {
    activo,
    proveedor,
    remitente,
    // Nombre para el aviso de privacidad: el vecino tiene derecho a saber por
    // dónde pasa su correo electrónico.
    nombreProveedor: esSmtp ? servidor : ajustes?.nombre || '',
    responderA,

    /** Envía un correo. Devuelve true si el proveedor lo ha aceptado. */
    async enviar({ para, asunto, texto, html }) {
      if (!activo) throw new Error('El envío de correo no está configurado (CORREO_PROVEEDOR en el .env).');
      if (proveedor === 'consola') {
        console.log(`\n[correo] Para: ${para}\n[correo] Asunto: ${asunto}\n${texto}\n`);
        return true;
      }
      if (esSmtp) {
        try {
          const buzon = await abrirBuzon();
          await buzon.sendMail({
            from: { name: nombre, address: remitente },
            to: para,
            ...(responderA ? { replyTo: responderA } : {}),
            subject: asunto,
            text: texto,
            html,
          });
          return true;
        } catch (err) {
          throw new Error(explicarSmtp(err));
        }
      }
      const respuesta = await fetch(config.correo.url || ajustes.url, {
        method: 'POST',
        headers: ajustes.cabeceras(clave),
        body: JSON.stringify(ajustes.cuerpo({ remitente, nombre, para, asunto, texto, html, responderA })),
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

/** Correo de prueba, para comprobar desde el servidor que el envío funciona. */
export function correoDePrueba({ site }) {
  const foro = `${site.brand} ${site.name}`;
  return {
    asunto: `Prueba de envío · ${foro}`,
    texto: [
      'Esto es una prueba.',
      '',
      `Si estás leyendo este correo, el foro de ${site.name} ya puede enviarlos.`,
      'A partir de ahora, un vecino que olvide su contraseña podrá recuperarla',
      'él solo desde la pantalla de acceso, sin pedírtela a ti.',
      '',
      'No hace falta que contestes.',
      '',
      '--',
      foro,
    ].join('\n'),
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f4f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;padding:28px;" cellpadding="0" cellspacing="0"><tr><td>
      <p style="margin:0 0 4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#0f5c4c;font-weight:700;">${escapeHtml(foro)}</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">El envío de correo funciona</h1>
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;">Si estás leyendo esto, el foro de ${escapeHtml(site.name)} ya puede enviar correos.</p>
      <p style="margin:0;font-size:16px;line-height:1.55;">A partir de ahora, un vecino que olvide su contraseña podrá recuperarla él solo desde la pantalla de acceso, sin pedírtela a ti.</p>
    </td></tr></table>
  </td></tr></table>
</body></html>`,
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
