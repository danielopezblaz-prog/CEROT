/**
 * Manda un correo de prueba con la configuración que tenga el foro ahora mismo.
 * Lo usa scripts/correo.sh; también se puede lanzar a mano:
 *
 *   docker compose exec -e DESTINO_PRUEBA=tucorreo@ejemplo.com foro \
 *     node --disable-warning=ExperimentalWarning scripts/probar-correo.mjs
 */
import { config } from '../src/config.js';
import { createMailService, correoDePrueba } from '../src/services/correo.js';

const destino = String(process.env.DESTINO_PRUEBA || config.admin.email || '').trim();
const correo = createMailService(config);

if (!correo.activo) {
  console.error('El envío de correo no está configurado: falta CORREO_PROVEEDOR (y su clave) en el .env.');
  process.exit(2);
}
if (!destino) {
  console.error('No sé a quién mandar la prueba: pon DESTINO_PRUEBA con una dirección.');
  process.exit(2);
}

try {
  await correo.enviar({ para: destino, ...correoDePrueba({ site: config.site }) });
  const desde = correo.remitente ? ` desde ${correo.remitente}` : '';
  console.log(`Correo de prueba enviado a ${destino}${desde}.`);
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
