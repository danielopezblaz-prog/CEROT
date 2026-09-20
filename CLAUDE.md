# Foro Vecinal · Vereda de los Estudiantes (Leganés)

Aplicación web para que los vecinos publiquen incidencias del barrio, las apoyen,
sigan su estado y saquen informes para el Ayuntamiento. Incluye un directorio de
comercios del barrio con sus ofertas y catálogos.

**Dominio previsto:** `veredadelosestudiantes.es` (aún sin registrar en el DNS a
fecha de 18/09/2026). Todavía no está en producción.

---

## Arrancar y trabajar

En este ordenador **no hay Node instalado globalmente**. Hay un Node 24 portátil:

```bash
tools/node/node.exe --disable-warning=ExperimentalWarning src/server.js
```

El aviso hay que silenciarlo siempre porque `node:sqlite` es experimental.
Para el usuario, `Iniciar.cmd` lo arranca con doble clic.

| Comando | Para qué |
|---|---|
| `npm start` | Arranca el foro |
| `npm run dev` | Igual, recargando al cambiar `src/` |
| `npm test` | 54 pruebas (node:test, base de datos en memoria) |
| `npm run rastreo` | Recorre las 186 páginas con 3 perfiles y avisa de las rotas |
| `npm run carga` | Mide peticiones por segundo, incluido el directo con 300 conexiones |
| `npm run exportar` | Copia estática navegable en `export/` (ver README) |
| `npm run icons` | Regenera los PNG desde `public/img/logo.svg` |
| `npm run secreto` | Genera el `SESSION_SECRET` para producción |
| `npm run admin:password` | Restablece una contraseña desde la consola |

Antes de dar nada por bueno: `npm test` **y** `npm run rastreo`. El segundo pilla
las plantillas rotas, que las pruebas no ven.

---

## Cómo está montado

Node 24 + Express 5 + EJS + **`node:sqlite`** (la SQLite que trae Node; no hay
módulos nativos porque `better-sqlite3` no compila en este equipo). Sin framework
de cliente: las páginas se pintan en el servidor y el JavaScript solo añade
detalles.

```
src/server.js        Arranque, repaso de seguridad, apagado limpio
src/app.js           Express: seguridad (Helmet/CSP), orden de middlewares, rutas
src/config.js        Lee el .env
src/db/              Esquema, migraciones (schema_version) y contenido de ejemplo
src/services/        Acceso a datos, uno por entidad
src/services/events.js  Bus de avisos en vivo (en memoria, no toca la base)
src/routes/          HTTP: index, auth, posts, businesses, admin, api, live, planos (mapa)
src/utils/seo.js     Lo que se le cuenta a Google: fichas schema.org (JSON-LD) y textos
src/services/correo.js       Envío de correo (buzón propio por SMTP, o Brevo/Resend por su API)
src/services/recuperacion.js Enlaces de «he olvidado mi contraseña»
src/middleware/      Sesiones (SQLite), CSRF, subida de fotos, límites, errores
src/views/           Plantillas EJS
public/              CSS, JS, fuentes, iconos, service worker, manifiesto
data/                Base de datos, fotos y caché de planos del mapa. NO se sube a ningún sitio.
```

---

## Decisiones que no se cambian sin preguntar al usuario

Son suyas y algunas tienen consecuencias legales:

1. **Facebook siempre manual.** Hay un botón en el panel de moderación. Nunca se
   publica solo. Lo eligió él tras avisarle del riesgo de mandar contenido de
   vecinos sin moderar a una página pública.
2. **Apellidos y teléfonos nunca son públicos.** En pantalla se ve «Nombre I.»
   (nombre + inicial). El resto solo lo ve la administración.
3. **El foro no es un canal oficial del Ayuntamiento** y lo dice en el pie de
   todas las páginas. No se quita.
4. **`data/` contiene datos personales de vecinos.** No se comparte, no se sube a
   ningún repositorio, no se mete en capturas ni en copias de ejemplo.
5. **Interfaz y comentarios del código, en castellano.** Incluidos los nombres de
   variables nuevos. El usuario lee el código.
6. **Estado del barrio e Informe son privados.** Solo los ve la moderación
   (moderador/a o administrador/a), que decide qué compartir y cuándo. Sin enlaces
   para los vecinos, fuera de robots.txt, y la API de estadísticas también cerrada.
   Lo pidió él el 18/09/2026.

---

## Trampas de este proyecto (comprobadas, cuestan horas)

- **CSP:** `worker-src 'self'` es imprescindible o el service worker no se
  registra y la app deja de poder instalarse. `script-src` va sin `unsafe-inline`:
  no puede haber ni un `<script>` incrustado en las plantillas.
- **`[hidden]` no basta.** Varias clases fijan `display` (`.badge-count`), así que
  hay una regla `[hidden] { display: none !important; }` al final del CSS.
- **La versión de los ficheros** (`?v=`) sale de la fecha de modificación, en
  `src/middleware/locals.js`. Si se vuelve a atar al arranque, la app instalada se
  queda con los estilos viejos.
- **El directo y la compresión:** `compression()` lleva un filtro que excluye
  `text/event-stream`. Sin él, los avisos se quedan en el búfer.
- **Chrome sin ventana se cuelga** al capturar páginas, porque la conexión en vivo
  no termina nunca. `npm run exportar` ya lo resuelve por su cuenta.
- **En columna, `flex-basis` mide alto.** Al apilar `.filters` en el móvil, el
  buscador se estiraba a 260 px de alto.
- **`display: grid` en un `<li>`:** cada trozo de texto suelto cuenta como una
  casilla. El contenido va envuelto en un único `<span>`.
- **La cabecera tiene tres variantes** (`nav-guest`, `nav-user-in`, `nav-mod`) que
  se pliegan a 920, 1000 y 1140 px. Si se añade un enlace hay que **medir**
  `brand.right` contra `nav.left` a varios anchos, no mirar capturas.
- **El repaso de seguridad solo tumba el arranque por falta de HTTPS.** El fichero
  de la contraseña inicial (`data/PRIMER-ACCESO.txt`) sale en rojo en el panel pero
  no impide arrancar: en producción dejaba el contenedor reiniciándose sin fin
  tras cualquier actualización. Se borra solo cuando el administrador cambia su
  contraseña. Para actualizar en el servidor: `bash scripts/actualizar.sh`.
- **El mapa no habla con OpenStreetMap desde el navegador.** Los planos y la
  búsqueda de direcciones pasan por `/planos/…` (`src/routes/planos.js`), que los
  pide a OpenStreetMap y los guarda en `data/planos/` (caché: se puede borrar). El
  Relay privado de iCloud del iPhone cortaba las peticiones directas y el mapa se
  quedaba gris. La CSP ya no permite `tile.openstreetmap.org`: una URL externa en
  `map.js` o `app.js` la bloquea el navegador. Solo se sirven planos de la zona de
  Madrid y con tope por conexión.
- **Los enlaces de recuperación no se guardan**, solo su huella (sha256), en
  `password_resets`. Caducan en una hora, valen una vez y al usarlos se anulan
  los demás de esa persona y se cierran sus sesiones abiertas. La pantalla del
  enlace sobrescribe `canonicalUrl` para que el token no acabe en `og:url`.
  `/recuperar` contesta siempre lo mismo exista o no la cuenta.
- **El servidor no puede mandar correos por su cuenta.** El puerto 25 saliente
  viene cerrado en casi todos los alojamientos y Gmail descarta lo que llega de
  una IP sin historial. Por eso `CORREO_PROVEEDOR` es obligatorio: `smtp` (buzón
  propio, con `nodemailer`), `brevo`/`resend` (API con `fetch`) o `consola`.
- **SEO:** los bloques `<script type="application/ld+json">` no se ejecutan, así
  que la CSP sin `unsafe-inline` no los bloquea; son la única excepción a «ningún
  script incrustado». La dirección canónica solo conserva `categoria`, `tipo` y
  `pagina` (`src/middleware/locals.js`); el resto de filtros no crean páginas para
  Google y las búsquedas (`?q=`) llevan `noindex`. El mapa del sitio es
  `/sitemap.xml`, `robots.txt` apunta a él y la barra final redirige (301).
- **Escribir ficheros:** los heredocs de Bash largos fallan en este equipo
  («unexpected EOF»). Usa la herramienta Write para ficheros de cierto tamaño.

---

## Rendimiento (medido, no estimado)

Con 50 visitas simultáneas en un portátil corriente: portada 190 req/s, listados
226, mapa 797, acceso 59. Con **300 conexiones en vivo abiertas**, un comentario
llega a las 300 en 9–16 ms y la portada sigue a 206 req/s.

Las contraseñas usan **scrypt** nativo, no bcrypt: bcrypt en JavaScript bloqueaba
el hilo principal 280 ms por acceso y limitaba a 4 accesos por segundo. Las
cuentas antiguas se reconvierten solas al entrar.

---

## Estado y qué falta

Funcionando: publicaciones, apoyos, comentarios, estados con historial, mapa,
directorio de comercios con catálogos y ofertas, panel de moderación, informes,
app instalable (PWA) y actualización en vivo por SSE.

Pendiente antes de abrir al barrio:

- **Servidor y HTTPS.** Ver `DESPLIEGUE.md`. Sin HTTPS la app no se puede instalar.
- **`LEGAL_OWNER` y `CONTACT_EMAIL`** en el `.env`: obligatorio por el RGPD.
- **Cambiar la contraseña de administración** (al hacerlo se borra solo `data/PRIMER-ACCESO.txt`).
- **Borrar el contenido de ejemplo** desde el panel.
- **Configurar el envío de correo:** `bash scripts/correo.sh` en el servidor.
  Pregunta, guarda en el `.env`, reinicia y manda un correo de prueba. Sin ello,
  quien olvide su contraseña depende de que se la cambies tú a mano.

Opcionales que se han dejado fuera a propósito: avisos push al móvil y modo
oscuro (el CSS tiene el blanco escrito a mano en unos noventa sitios; hacerlo a
medias queda peor que no tenerlo).

---

## Cómo hablarle al usuario

No es programador. Explícale las cosas por lo que hacen, no por cómo están
hechas, y en castellano. Si algo no funciona o no se ha podido comprobar, dilo
claramente en vez de suavizarlo.
