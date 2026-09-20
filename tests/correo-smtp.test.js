import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMailService, correoDeRecuperacion } from '../src/services/correo.js';
import { config } from '../src/config.js';

/*
 * Envío por el buzón propio (CORREO_PROVEEDOR=smtp). Aquí se levanta un buzón
 * fingido que habla el mismo idioma que uno de verdad, así que la prueba
 * recorre la conversación entera: saludo, contraseña, remitente, destinatario
 * y mensaje. No sale nada a internet.
 */
const recibidos = [];
let buzon;
let puerto;

/** Un servidor de correo de mentira, lo justo para poder contestar. */
function buzonFingido() {
  return net.createServer((socket) => {
    const sesion = { de: '', para: [], datos: '', usuario: '' };
    let enDatos = false;
    let pendiente = '';
    socket.write('220 buzon-de-prueba ESMTP\r\n');
    socket.on('data', (trozo) => {
      pendiente += trozo.toString('utf8');
      let corte;
      while ((corte = pendiente.indexOf('\r\n')) !== -1) {
        const linea = pendiente.slice(0, corte);
        pendiente = pendiente.slice(corte + 2);
        if (enDatos) {
          if (linea === '.') {
            enDatos = false;
            recibidos.push({ ...sesion });
            sesion.datos = '';
            socket.write('250 2.0.0 Mensaje aceptado\r\n');
          } else {
            // Un punto al principio de línea viaja duplicado; se deshace.
            sesion.datos += `${linea.startsWith('..') ? linea.slice(1) : linea}\n`;
          }
          continue;
        }
        const orden = linea.slice(0, 4).toUpperCase().trim();
        if (orden === 'EHLO' || orden === 'HELO') {
          socket.write('250-buzon-de-prueba\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
        } else if (orden === 'AUTH') {
          const partes = linea.split(' ');
          sesion.usuario = Buffer.from(partes[2] || '', 'base64').toString('utf8').split('\0').filter(Boolean).join(':');
          socket.write('235 2.7.0 Adelante\r\n');
        } else if (orden === 'MAIL') {
          sesion.de = linea.match(/<([^>]*)>/)?.[1] || '';
          socket.write('250 2.1.0 Vale\r\n');
        } else if (orden === 'RCPT') {
          sesion.para.push(linea.match(/<([^>]*)>/)?.[1] || '');
          socket.write('250 2.1.5 Vale\r\n');
        } else if (orden === 'DATA') {
          enDatos = true;
          socket.write('354 Escribe y termina con un punto\r\n');
        } else if (orden === 'QUIT') {
          socket.write('221 2.0.0 Adiós\r\n');
          socket.end();
        } else {
          socket.write('250 2.0.0 Vale\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });
}

/** Deshace los cortes de línea que el correo mete cada 76 caracteres. */
const sinCortes = (texto) => texto.replace(/=\n/g, '');

function servicio(extra = {}) {
  return createMailService({
    ...config,
    correo: {
      proveedor: 'smtp',
      servidor: '127.0.0.1',
      puerto,
      usuario: 'foro@ejemplo.es',
      clave: 'contrasena-de-aplicacion',
      remitente: 'foro@ejemplo.es',
      nombre: 'Foro Vecinal de Prueba',
      url: '',
      // Un buzón de verdad va cifrado; el fingido, por sencillez, no.
      opciones: { secure: false, requireTLS: false, ignoreTLS: true },
      ...extra,
    },
  });
}

before(async () => {
  buzon = buzonFingido();
  buzon.listen(0, '127.0.0.1');
  await new Promise((r) => buzon.once('listening', r));
  puerto = buzon.address().port;
});

after(() => buzon?.close());

test('el correo sale por el buzón propio, con su remitente y su enlace', async () => {
  const correo = servicio();
  assert.equal(correo.activo, true);
  assert.equal(correo.nombreProveedor, '127.0.0.1');

  const enlace = 'https://veredadelosestudiantes.es/recuperar/abc123-token_de-prueba';
  const mensaje = correoDeRecuperacion({ site: config.site, enlace, nombre: 'Marta', minutos: 60 });
  assert.equal(await correo.enviar({ para: 'marta@ejemplo.es', ...mensaje }), true);

  const entregado = recibidos.at(-1);
  assert.equal(entregado.usuario, 'foro@ejemplo.es:contrasena-de-aplicacion', 'se identifica con la cuenta del buzón');
  assert.equal(entregado.de, 'foro@ejemplo.es');
  assert.deepEqual(entregado.para, ['marta@ejemplo.es']);
  assert.match(entregado.datos, /^To: marta@ejemplo\.es$/m);
  assert.match(entregado.datos, /^From: .*<foro@ejemplo\.es>$/m);
  assert.ok(sinCortes(entregado.datos).includes(enlace), 'el enlace llega entero, sin partir');
  assert.match(entregado.datos, /Subject: .*(contrase|Recupera|=\?)/i);
});

test('sin servidor o sin cuenta, el buzón propio no se da por configurado', async () => {
  assert.equal(servicio({ servidor: '' }).activo, false);
  assert.equal(servicio({ usuario: '' }).activo, false);
  assert.equal(servicio({ clave: '' }).activo, false);
  assert.equal(servicio({ remitente: '' }).activo, false);
});

test('si el buzón no contesta, el motivo se explica en castellano', async () => {
  // Un puerto donde no hay nadie escuchando.
  const cerrado = servicio({ puerto: 1, opciones: { secure: false, requireTLS: false, ignoreTLS: true, connectionTimeout: 1500 } });
  await assert.rejects(
    () => cerrado.enviar({ para: 'marta@ejemplo.es', asunto: 'Hola', texto: 'Hola', html: '<p>Hola</p>' }),
    (err) => {
      assert.match(err.message, /No se ha podido conectar con el servidor de correo|buzón de correo ha fallado/);
      assert.match(err.message, /CORREO_SERVIDOR|CORREO_PUERTO|Detalle/);
      return true;
    }
  );
});
