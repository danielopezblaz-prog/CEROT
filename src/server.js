/* El grupo de hilos de Node atiende el cifrado de contraseñas y el recorte de
   fotos. Con más hilos, varios vecinos pueden entrar y subir imágenes a la vez.
   Hay que fijarlo antes de que se use nada de eso. */
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '8';

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { createApp } from './app.js';
import { launchChecklist } from './utils/security.js';

const { app, db, seed, services } = createApp(config);

/* Repaso de seguridad al arrancar. En producción, servir sin HTTPS o dejar el
   fichero de la contraseña inicial en el disco impide el arranque, salvo que se
   pida expresamente lo contrario con PERMITIR_INSEGURO=1. */
const check = launchChecklist(config, services);
if (check.pending.length) {
  const line = '─'.repeat(64);
  console.log(`\n${line}\n  REPASO DE SEGURIDAD: ${check.pending.length} punto(s) pendiente(s)\n${line}`);
  for (const item of check.pending) {
    console.log(`  ${item.critical ? '[IMPRESCINDIBLE]' : '[recomendado]  '} ${item.label}`);
    console.log(`      ${item.help}`);
  }
  console.log(`${line}\n`);
}
if (config.isProduction && check.blockers.length && process.env.PERMITIR_INSEGURO !== '1') {
  console.error('  El foro NO arranca en modo producción con puntos imprescindibles sin resolver.');
  console.error('  Resuélvelos, o arranca con PERMITIR_INSEGURO=1 si sabes lo que haces.\n');
  process.exit(1);
}

if (seed.adminCreated) {
  // Guarda las credenciales iniciales en un fichero privado (carpeta data/) para que no se pierdan.
  const file = path.join(config.dataDir, 'PRIMER-ACCESO.txt');
  try {
    fs.writeFileSync(
      file,
      [
        'PRIMER ACCESO AL FORO VECINAL',
        '================================',
        `Dirección:   ${config.baseUrl}/acceder`,
        `Correo:      ${seed.adminCreated.email}`,
        `Contraseña:  ${seed.adminCreated.password}`,
        '',
        'Entra con estos datos, cambia la contraseña desde "Mi perfil" y borra este fichero.',
        'Este fichero NO es accesible desde la web, pero no lo compartas.',
        '',
      ].join('\r\n'),
      { mode: 0o600 }
    );
  } catch {
    /* si no se puede escribir, las credenciales se muestran igualmente en consola */
  }
}

const server = app.listen(config.port, () => {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log(`  ${config.site.brand} · ${config.site.name}`);
  console.log(`  Servidor en marcha: http://localhost:${config.port}`);
  console.log(`  Datos y fotos en:   ${config.dataDir}`);
  console.log(`  Entorno:            ${config.env}`);
  console.log(line);
  if (seed.adminCreated) {
    console.log('\n  PRIMER ADMINISTRADOR CREADO (guarda estos datos):');
    console.log(`    Correo:      ${seed.adminCreated.email}`);
    console.log(`    Contraseña:  ${seed.adminCreated.password}`);
    if (seed.adminCreated.generated) {
      console.log('    (Contraseña generada automáticamente. Cámbiala desde "Mi perfil" tras entrar.)');
    }
    console.log(`    También guardados en: ${path.join(config.dataDir, 'PRIMER-ACCESO.txt')}`);
    console.log(`\n${line}`);
  }
  if (seed.demoCreated) {
    console.log('  Se ha creado contenido de ejemplo. Bórralo desde Panel > "Eliminar contenido de ejemplo".');
    console.log(line);
  }
  console.log('');
});

function shutdown(signal) {
  console.log(`\n[${signal}] Cerrando el servidor...`);
  // Las conexiones en vivo están abiertas a propósito: si no se cierran a mano,
  // el servidor se queda esperándolas y no termina de apagarse.
  services.events.cerrarTodo();
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignorar */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
