# Foro Vecinal · Vereda de los Estudiantes

Plataforma web independiente para que los vecinos de **Vereda de los Estudiantes (Leganés)** publiquen las incidencias y gestiones pendientes del barrio, las apoyen, hagan seguimiento de las reclamaciones oficiales y generen informes con datos para presentar al Ayuntamiento.

> Lo que pasa en el barrio, contado por sus vecinos.

| Portada | Detalle de una incidencia | Informe para el Ayuntamiento |
|---|---|---|
| ![Portada](docs/capturas/portada.png) | ![Detalle](docs/capturas/detalle.png) | ![Informe](docs/capturas/informe.png) |

Más capturas en `docs/capturas/` (directorio de negocios, listado con miniaturas de mapa, mapa del barrio, estadísticas, formulario de publicación, panel de moderación).

Diseño propio sin dependencias externas: tipografía Manrope autoalojada, iconos vectoriales por categoría, miniaturas de mapa de OpenStreetMap en las tarjetas, ilustración del barrio en la cabecera y marcadores personalizados en el mapa.

---

## Qué incluye

**Para los vecinos**
- Publicaciones de cuatro tipos: **incidencia**, **propuesta**, **aviso** y **pregunta**, clasificadas en 14 categorías (limpieza, alumbrado, aceras, parques, seguridad, ruido, tráfico, transporte, obras, trámites, agua, servicios públicos, animales, otros).
- Fotos (hasta 4 por publicación, optimizadas automáticamente), ubicación exacta en el mapa, organismo responsable y **número de registro de la reclamación oficial**.
- Botón **«Me afecta / lo apoyo»** para sumar apoyos, comentarios e **historial de estados**: abierta → en trámite → resuelta / cerrada, con notas.
- Compartir por **WhatsApp**, Telegram, X, Facebook o correo, con vista previa (Open Graph) al pegar el enlace en un grupo.
- **Mapa del barrio** con todas las incidencias, **Estado del barrio** con estadísticas y evolución mensual, y **Informe** imprimible / PDF / CSV para llevar al Ayuntamiento, al Pleno o a los medios.
- Página de **recursos**: cómo reclamar paso a paso, teléfonos y enlaces oficiales.
- **App para el móvil**: se instala desde el propio navegador, sin pasar por ninguna tienda.
  Icono en la pantalla de inicio, pantalla completa, barra de secciones abajo, accesos directos
  y aviso claro cuando no hay cobertura. Instrucciones en `/app`.
- **Todo se actualiza solo**: los comentarios, los apoyos y los cambios de estado aparecen en
  el momento, sin tocar nada. Y también se sigue por RSS.

**Comercio del barrio**
- **Directorio de negocios** con ficha completa: logotipo, portada, galería de fotos, descripción, horario semanal, teléfono, WhatsApp, web y redes, y ubicación en el mapa.
- Etiqueta de **abierto ahora** o **cerrado** calculada en tiempo real sobre el horario, con la hora a la que abre o cierra.
- **Catálogo de productos con fotos**: subida múltiple, precio, disponibilidad, destacados y orden propio. Se ve en una cuadrícula ampliable en la ficha del negocio.
- Los comercios publican sus **ofertas, eventos y novedades**, con precio destacado, imagen y fechas de vigencia. Todo se recoge en una portada de **ofertas del día**.
- Alta abierta a cualquier vecino, **con aprobación previa** de la moderación para evitar spam y negocios inventados.

**Para quien lo gestiona**
- Roles: vecino/a, moderador/a, administrador/a.
- Panel de moderación: denuncias de contenido, ocultar / fijar / eliminar publicaciones, gestión de usuarios (roles, bloqueo, restablecer contraseñas), copia de seguridad descargable y borrado del contenido de ejemplo.
- **Compartir en Facebook** con un clic desde el panel, con opción de retirar lo publicado. Opcional y siempre manual; ver el apartado correspondiente más abajo.
- Seguridad: contraseñas cifradas (scrypt), sesiones en servidor, protección CSRF, límites de peticiones contra spam y fuerza bruta, cabeceras de seguridad (Helmet + CSP), validación de subidas.
- **Sin base de datos externa**: usa la SQLite integrada en Node.js. Todo vive en la carpeta `data/` (un fichero de base de datos + las fotos).

---

## Arrancar en tu ordenador (Windows)

En esta carpeta ya hay una copia portátil de Node.js 24 en `tools/node`, así que **no hace falta instalar nada**.

1. Haz doble clic en **`Iniciar.cmd`**.
2. Se abrirá una ventana negra (déjala abierta) y el navegador en <http://localhost:3000>.
3. **Primer acceso**: la primera vez se crea el usuario administrador. Su correo y contraseña aparecen en la ventana negra y se guardan en `data/PRIMER-ACCESO.txt`. Entra con ellos, cambia la contraseña en **Mi perfil** y borra ese fichero.
4. El foro arranca con **contenido de ejemplo** (publicaciones y vecinos ficticios marcados como «Ejemplo») para que veas cómo funciona. Cuando quieras abrirlo a los vecinos, bórralo desde **Panel → Eliminar contenido de ejemplo**.

Para apagarlo, cierra la ventana negra. Los datos se conservan en `data/`.

Desde una consola (cualquier sistema con Node.js 22.13 o superior):

```bash
npm install
npm start
```

---

## Configuración

Copia `.env.example` como `.env` y ajusta lo que necesites:

| Variable | Para qué sirve | Valor por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `BASE_URL` | Dirección pública sin barra final. Imprescindible para que funcionen las vistas previas de WhatsApp, el RSS y los enlaces del informe | `http://localhost:3000` |
| `SESSION_SECRET` | Clave de las sesiones. Si se deja vacía se genera y guarda en `data/.session-secret` | *(generada)* |
| `DATA_DIR` | Carpeta de datos y fotos | `./data` |
| `SITE_NAME`, `SITE_BRAND`, `MUNICIPALITY`, `SITE_DESCRIPTION` | Nombre del barrio, marca, municipio y descripción | Vereda de los Estudiantes / Foro Vecinal / Leganés |
| `CONTACT_EMAIL` | Correo de contacto que se muestra en normas, legal y acceso | *(vacío)* |
| `LEGAL_OWNER` | Titular que aparece en el aviso legal y la privacidad (asociación o persona) | *(vacío)* |
| `MAP_CENTER_LAT`, `MAP_CENTER_LNG`, `MAP_ZOOM` | Centro y zoom del mapa | 40.3215 / -3.7560 / 15 |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Primer administrador (solo se usa si no hay usuarios). Contraseña vacía = se genera una | admin@vereda.local |
| `MAX_UPLOAD_MB`, `MAX_IMAGES_PER_POST` | Límite de tamaño por foto y de fotos por publicación | 8 / 4 |
| `SEED_DEMO` | Crear contenido de ejemplo en el primer arranque | `true` |
| `TRUST_PROXY` | Pon `1` si hay un proxy inverso delante (Caddy, Nginx, Railway, Render…) | `0` |
| `NODE_ENV` | Pon `production` en Internet (activa caché de plantillas, cookies seguras y HSTS con HTTPS) | `development` |

---

## Ponerlo en Internet para todo el barrio

La guía completa está en **[DESPLIEGUE.md](DESPLIEGUE.md)**: apuntar el DNS, preparar el
servidor, configurar, arrancar y las copias de seguridad. Unos 40 minutos la primera vez.

En resumen, con un servidor propio (un VPS de 4–6 € al mes sobra):

```bash
cp .env.produccion.example .env   # y rellenarlo
docker compose up -d --build
```

Eso levanta el foro y un proxy (Caddy) que consigue el certificado de HTTPS él solo y lo
renueva sin que nadie se acuerde. El foro no asoma directamente a internet: todo pasa por
el proxy. Los datos y las fotos quedan en `data/`.

### En plataformas gestionadas (Railway, Fly.io, Render…)

El `Dockerfile` funciona tal cual. Dos requisitos: montar un **volumen persistente** en
`/data` (si no, las fotos y la base de datos se pierden en cada despliegue) y definir las
variables de `.env.produccion.example`, con `BASE_URL` apuntando al dominio y `TRUST_PROXY=1`.

### Qué no hacer

Un PC en casa con el puerto abierto funciona, pero depende de que esté siempre encendido y
expone tu red doméstica. Y la mayoría de los **alojamientos compartidos** que se venden con
el dominio solo sirven HTML y PHP: ahí cabe la copia estática (`npm run exportar`), pero no
el foro, que necesita Node.

---

## Negocios del barrio

La sección de comercio local vive en `/negocios`, con las ofertas dentro, en `/negocios/ofertas`. Las direcciones antiguas `/locales` y `/ofertas` redirigen solas. No necesita ninguna configuración: funciona desde el primer arranque.

### Cómo se da de alta un negocio

1. El responsable del negocio **crea su cuenta** de vecino como cualquier otra persona.
2. Entra en **Negocios → Dar de alta mi negocio** y rellena la ficha: nombre, a qué se dedica, una frase de presentación, descripción, dirección con punto en el mapa, contacto, horario semanal, logotipo, portada y galería.
3. El negocio queda en estado **pendiente**. Solo lo ven su responsable y la moderación, así que puede seguir completándolo mientras espera.
4. La moderación lo revisa en **Panel → Negocios** y pulsa **Publicar**. A partir de ahí aparece en el directorio, en el mapa y en los buscadores.

La moderación puede **suspender** un negocio indicando el motivo, que se muestra a su responsable, o **eliminarlo**. Un moderador que dé de alta un negocio lo publica directamente, sin pasar por la cola.

### Ofertas, eventos y novedades

Desde la ficha de su negocio, el responsable publica tres tipos de cosas:

| Tipo | Para qué | Fechas |
|---|---|---|
| **Oferta** | Un descuento o precio especial | Desde y hasta, opcionales |
| **Evento** | Una actividad concreta | Fecha obligatoria, con hora opcional |
| **Novedad** | Algo nuevo que contar | Desde y hasta, opcionales |

Todo lo vigente aparece en `/negocios/ofertas` y en la portada del foro. Una publicación con fecha de fin desaparece sola al día siguiente, así que el directorio no acumula ofertas caducadas. Si no pones fechas, se queda hasta que la borres. El último día de una oferta se marca en rojo como «Último día».

### Fotos de productos

Cada negocio tiene un **catálogo** en **Negocios → su ficha → Fotos de productos**, con hasta 60 artículos. Se llega también desde el botón lateral de la ficha.

Hay dos formas de añadir:

- **Subir varias fotos de golpe.** Hasta 20 a la vez. Cada foto crea un producto sin nombre y la página avisa de cuántos quedan por nombrar. Es lo más rápido para quien tiene el móvil lleno de fotos del escaparate.
- **Añadir un producto** con nombre, precio, descripción y foto de una vez.

Debajo está el catálogo en forma de lista editable: se cambian todos los nombres, precios y descripciones y se guarda con un solo botón. Cada fila permite además:

| Acción | Qué hace |
|---|---|
| Pulsar la miniatura | Cambia la foto de ese producto, se ve al momento |
| **Disponible** | Desmarcarlo lo oculta a los vecinos sin borrarlo, útil para lo que se acaba |
| **Destacado** | Lo coloca el primero del catálogo |
| Flechas | Cambian el orden |
| Papelera | Lo elimina, y borra su foto del disco |

Las fotos se recortan a cuadrado, 900 por 900 píxeles, con una miniatura de 440. En la ficha pública salen en una cuadrícula y se amplían al pulsarlas. Un producto sin foto se muestra con un recuadro de relleno, y en el directorio, si el negocio no tiene foto de portada, se usa la de su primer producto.

### El horario y la etiqueta de «abierto ahora»

El horario se guarda por días, con hasta dos tramos cada uno para poder reflejar el cierre del mediodía. La etiqueta de abierto o cerrado se calcula con la hora de Madrid, y en la ficha los días con el mismo horario se agrupan solos: «Lunes a viernes: 07:00 a 14:00 y 17:00 a 20:30».

En el formulario hay un botón para copiar el horario del lunes al resto de días laborables, que ahorra la mayor parte del trabajo.

### Categorías de comercio

Hay dieciséis, cada una con su color y su icono: alimentación, panadería, bares y restaurantes, cafeterías, peluquería, moda, farmacia, salud, ferretería, papelería, deportes, servicios profesionales, talleres, academias, mascotas y otros. Se editan en `BUSINESS_CATEGORIES`, dentro de [src/utils/constants.js](src/utils/constants.js). Si añades una nueva, añade también su icono `biz-<slug>` en [src/utils/icons.js](src/utils/icons.js), o usará el genérico.

### Consejos para que funcione

- **Aprueba con criterio.** Comprueba que el negocio existe en el barrio y que quien lo da de alta tiene relación con él. Es lo que separa un directorio útil de un tablón de spam.
- **Recuerda a los comercios que publiquen.** Un directorio con horarios pero sin ofertas se consulta una vez; con ofertas del día se consulta cada semana.
- **No cobres por aparecer.** En cuanto haya dinero de por medio dejará de ser un proyecto vecinal y tendréis obligaciones fiscales y de publicidad.

## Compartir en Facebook

El foro puede publicar una incidencia en la página de Facebook del barrio con un clic desde el panel de moderación. **Nunca publica solo**: alguien del equipo decide qué se comparte, porque de la página de Facebook responde quien la administra y ahí acabaría cualquier insulto o dato personal que un vecino escriba antes de que la moderación lo vea.

Es opcional. Si no configuras nada, el botón simplemente no aparece.

### Lo que se puede y lo que no

| | |
|---|---|
| Página de Facebook | Sí |
| Perfil personal | No, Meta lo cerró en 2018 |
| Grupo de Facebook | No, Meta lo cerró en 2024 |
| Grupo de WhatsApp | No existe forma legal de automatizarlo |

### Requisitos previos

- Una **página** de Facebook del foro o de la asociación, y que tú seas administrador.
- El foro publicado en internet con una dirección real en `BASE_URL`. Si sigue en `localhost`, Facebook no puede leer el título ni la foto del enlace y la publicación saldrá sin la tarjeta de vista previa.

### Conseguir el identificador y el token

1. Entra en <https://developers.facebook.com/apps> y crea una aplicación de tipo **Empresa**. Déjala en **modo desarrollo**: mientras solo publique en tu propia página no necesitas pasar la revisión de Meta.
2. Abre el **Explorador de la API Graph**, en Herramientas del panel de la aplicación.
3. Selecciona tu aplicación y pide estos permisos: `pages_show_list`, `pages_manage_posts` y `pages_read_engagement`. Genera el token de usuario y concede el acceso a tu página cuando te lo pregunte.
4. Cambia ese token de corta duración por uno de larga duración. Sustituye los tres valores por los tuyos:

```bash
curl -s "https://graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id=TU_APP_ID&client_secret=TU_APP_SECRET&fb_exchange_token=EL_TOKEN_CORTO"
```

5. Con el token largo que te devuelve, pide el token de la página. Este último ya no caduca:

```bash
curl -s "https://graph.facebook.com/v25.0/me/accounts?access_token=EL_TOKEN_LARGO"
```

6. De la respuesta copia el `id` de tu página y su `access_token`, y ponlos en el fichero `.env`:

```
FACEBOOK_PAGE_ID=123456789012345
FACEBOOK_PAGE_TOKEN=EAAG...
```

7. Reinicia el foro. En **Panel → Resumen** verás que la difusión aparece como configurada.

### Cómo se usa

En cada publicación, tanto en su página como en la lista del panel, aparece el botón **Compartir en Facebook**. Pide confirmación antes de publicar. Una vez compartida, el botón cambia a **Ver en Facebook** y se añade otro para **retirarla**, que la borra también de Facebook. Esto último importa: si compartes algo que luego resulta llevar datos personales, puedes quitarlo desde el propio foro.

El texto que se publica lleva el tipo, el estado, la categoría, el título, un resumen, la ubicación, los apoyos y el enlace al foro. Si quieres cambiar ese formato, edita la función `composeMessage` en [src/services/facebook.js](src/services/facebook.js).

### Si deja de funcionar

El token de la página no caduca por sí solo, pero se invalida si cambias la contraseña de Facebook, si revocas el acceso a la aplicación o si dejas de ser administrador de la página. En ese caso el foro te avisará con un mensaje claro y solo hay que repetir los pasos 3 a 6.

## La app del móvil

El foro **es** la app. No hay dos programas distintos: la misma dirección, instalada desde
el navegador, se comporta como una aplicación nativa. La página `/app` lo explica a los
vecinos paso a paso, y hay un botón para instalarla en el pie de todas las páginas.

- **Android (Chrome):** sale un botón de instalar; si no, menú ⋮ → «Instalar aplicación».
- **iPhone (Safari):** compartir → «Añadir a pantalla de inicio». En iPhone solo funciona
  desde Safari, es una limitación de Apple.

Qué gana quien la instala:

- Abre a pantalla completa, sin barra del navegador, con la barra de secciones abajo.
- **Sin cobertura** no da un error feo: enseña una pantalla propia y vuelve sola al recuperarla.
  Lo ya visto (estilos, iconos, fotos y mapas) sigue disponible.
- **Se actualiza sola.** Cuando cambias algo en el servidor, la app avisa con un botón
  «Hay una versión nueva» en vez de quedarse anclada a la anterior.
- **Accesos directos**: mantener pulsado el icono ofrece publicar una incidencia, abrir el
  mapa o ver los negocios.
- **Compartir al foro**: en Android, al compartir un texto o un enlace desde otra app, el foro
  aparece entre los destinos y el formulario se abre ya relleno.

### ¿Y estar en Google Play o en la App Store?

No hace falta para nada de lo anterior, y ahorra las cuotas de desarrollador (25 € una vez en
Google, 99 € al año en Apple), las revisiones y las actualizaciones a mano. Si algún día
interesa aparecer en las tiendas, esta misma app se empaqueta con Bubblewrap (Android) o
con un contenedor WebView (iOS) sin rehacer nada.

## Todo al día, sin recargar

El servidor avisa a quien tenga el foro abierto en cuanto pasa algo. Sin recargar la página:

| Lo que pasa | Lo que ve el vecino |
|---|---|
| Alguien comenta una incidencia | El comentario aparece abajo, resaltado un momento, y sube el contador |
| Alguien la apoya | Sube el número de apoyos |
| Cambia el estado | Cambia la etiqueta y la barra de progreso, y sale un aviso |
| Hay publicaciones nuevas en el listado | Un aviso flotante «N publicaciones nuevas · Ver» |
| Llega una denuncia o un negocio por aprobar | El contador rojo del panel sube al instante (solo lo ve la moderación) |
| Se cae la conexión | Un aviso «Sin conexión», y todo se pone al día solo al volver |

Nada se recarga por sorpresa: si estás escribiendo un comentario, no se pierde. Los avisos
que exigen recargar la página son botones que pulsas tú.

**Editar a la vez.** Si dos personas (el autor y un moderador, por ejemplo) editan la misma
publicación, la segunda en guardar no pisa a la primera: el foro avisa de que ha cambiado
mientras tanto y le devuelve su texto para que lo revise.

**Doble toque.** En el móvil es fácil pulsar «Publicar» dos veces. El botón se bloquea tras
el primer envío, así que no salen comentarios ni publicaciones duplicados.

## Una copia para enseñar el foro

```bash
npm run exportar
```

Genera en `export/` una **copia estática y navegable** del foro con su contenido de
ejemplo. Se abre `export/index.html` con doble clic, sin servidor ni internet, y se
clica por ella igual que en local. Sirve para enseñársela a la asociación de vecinos,
a un comercio o a quien tenga que dar el visto bueno antes de abrirla.

- **Funciona**: navegar entre las 30 páginas, los mapas (las teselas de OpenStreetMap
  van dentro del fichero), las galerías de fotos, el menú del móvil y la barra inferior.
- **No funciona**: entrar, publicar, comentar, filtrar ni buscar. Al pulsarlos, la copia
  lo dice con un aviso en vez de dar un error.
- **Nunca lleva datos reales.** La exportación arranca el foro con una base de datos
  temporal y contenido de ejemplo; los datos de `data/` no se tocan.

Si la copia va a vivir en un dominio, pásaselo para que los botones de compartir y las
etiquetas de WhatsApp y Facebook lleven la dirección buena:

```bash
DOMINIO=https://veredadelosestudiantes.es npm run exportar
```

Esa copia se sube tal cual a **cualquier** alojamiento, incluso a los planes compartidos
que solo sirven HTML: se arrastra el contenido de `export/` a la carpeta pública
(`public_html`, `htdocs` o como la llame tu proveedor) y ya está en el dominio.

Las teselas del mapa se guardan en `tools/.teselas-cache.json` la primera vez, para no
volver a pedírselas a OpenStreetMap en cada exportación.

## Cuánta gente aguanta

El foro trae dos herramientas para comprobarlo tú mismo, sin instalar nada:

```bash
npm run rastreo
```

Arranca el foro en memoria, crea contenido de prueba y **recorre todos los enlaces** con tres perfiles: visitante, vecino registrado y moderación. Avisa de cualquier página rota. Ahora mismo recorre 186 páginas sin un solo fallo.

```bash
npm run carga
```

Lanza el foro en un proceso aparte y lo bombardea a peticiones. Estas son las cifras medidas en un portátil corriente, con cincuenta visitas simultáneas:

| Escenario | Peticiones por segundo | Mediana | 95 % por debajo de |
|---|---|---|---|
| Portada | 191 | 246 ms | 327 ms |
| Listado de incidencias | 226 | 207 ms | 283 ms |
| Directorio de negocios | 233 | 202 ms | 268 ms |
| Datos del mapa | 803 | 45 ms | 139 ms |
| Iniciar sesión | 59 | 161 ms | 214 ms |
| Navegar mientras otros entran | 180 | 128 ms | 217 ms |
| Portada con 300 conexiones en vivo abiertas | 210 | 178 ms | 252 ms |

Y el directo, medido en la misma prueba: con **300 vecinos conectados a la vez**, un
comentario nuevo llega **a los 300 en 9 milisegundos**, y el servidor sigue sirviendo
páginas al mismo ritmo que sin nadie conectado.

Doscientas páginas por segundo son unos **doce mil vecinos navegando a la vez** si cada uno mira una página cada minuto. El barrio tiene menos de ocho mil habitantes, así que sobra de largo. En un servidor de verdad las cifras serán parecidas o mejores.

Si algún día se quedara corto, el orden de actuación es: poner una caché delante con Caddy o Cloudflare, servir las fotos desde un almacenamiento externo y, solo entonces, plantearse varios procesos.

### Por qué aguanta

- **Base de datos.** SQLite en modo WAL, que permite leer mientras se escribe, con la sincronización ajustada y parte del fichero leída por memoria.
- **Sesiones.** La caducidad solo se reescribe cada media hora, en vez de en cada visita. Eso quitó una escritura en disco por página.
- **Contraseñas.** Se cifran con scrypt, que es nativo y se ejecuta fuera del hilo principal. Antes, con bcrypt en JavaScript, cada acceso congelaba el foro entero unos 280 ms y solo cabían cuatro accesos por segundo. Ahora caben cincuenta y el resto de visitantes ni se entera.
- **Consultas.** Las categorías se guardan en memoria y los recuentos del directorio ya no calculan datos que no se usan.
- **Fotos y contraseñas en paralelo.** El grupo de hilos de Node se amplía a ocho, así que varios vecinos pueden entrar y subir imágenes a la vez.

Las cuentas creadas antes de este cambio siguen funcionando: al entrar, su contraseña se pasa sola al formato nuevo sin que el vecino note nada.

### Qué cuesta mantener el directo

Cada vecino con el foro abierto mantiene **una** conexión permanente con el servidor.
No consulta cada pocos segundos: se queda a la escucha y el servidor le habla cuando
hay algo. Una conexión en reposo no gasta procesador y ocupa unos pocos kilobytes.

- Solo se conecta la pestaña que estás mirando. Si dejas la pestaña de fondo un minuto,
  suelta la conexión y sigue enterándose a través de las demás pestañas abiertas.
- Cada conexión se renueva sola cada media hora, para que no se acumulen sockets olvidados.
- El tope está en 3.000 conexiones simultáneas y 240 por red en un cuarto de hora.
  El segundo se cambia con `LIMITE_VIVO` si hace falta (por ejemplo si todo el barrio
  sale a Internet por la misma IP).
- `GET /api/salud` dice cuántas hay abiertas ahora mismo, para vigilarlo desde fuera.

Detrás de un proxy hay que dejar pasar el flujo sin guardarlo en un búfer. Caddy lo hace
solo; con nginx hace falta `proxy_buffering off;` para `/api/eventos`. El foro ya envía
la cabecera `X-Accel-Buffering: no` para pedirlo.

## Seguridad y puesta en marcha

### Antes de abrir el foro: la lista del panel

Al entrar como administrador, el panel muestra un recuadro **«Antes de abrir el foro al barrio»** con lo que falta por resolver. Desaparece solo cuando está todo hecho. Los mismos avisos salen en la consola al arrancar.

Dos puntos son **imprescindibles** y, en modo producción, el foro **no arranca** sin ellos:

1. **Servir por HTTPS.** `BASE_URL` debe empezar por `https://`. Sin cifrado, las contraseñas de los vecinos viajan en claro por la red.
2. **Borrar `data/PRIMER-ACCESO.txt`.** Es el fichero con la contraseña inicial de administración. Entra, cámbiala en Mi perfil y bórralo.

Si necesitas arrancar igualmente, por ejemplo para una prueba interna, usa `PERMITIR_INSEGURO=1`. No lo dejes puesto.

### Qué protege el foro por dentro

| Frente a | Qué hace |
|---|---|
| Robo de contraseñas | Se guardan cifradas con scrypt, que además de lento exige memoria y encarece los ataques con tarjetas gráficas. Nunca en claro; no se pueden recuperar, solo restablecer |
| Contraseñas fáciles | Se rechazan las más usadas del mundo, las de solo números y las que contienen tu nombre o tu correo |
| Fuerza bruta | Doce intentos fallidos de acceso por cuarta de hora y conexión. Entrar bien no gasta cupo |
| Suplantación de formularios | Cada formulario lleva un testigo único de sesión. Sin él, la petición se rechaza |
| Robo de sesión | La cookie es `HttpOnly` y `SameSite=Lax`, y en HTTPS viaja solo cifrada. Al entrar se renueva el identificador de sesión |
| Inyección de código en la página | Política de contenidos estricta: ningún script incrustado, `object-src` a cero y los formularios solo pueden enviarse al propio foro |
| Robo de clics | `frame-ancestors` y `X-Frame-Options` impiden meter el foro en un marco ajeno |
| Redirecciones engañosas | Todos los destinos de redirección se validan: solo rutas internas |
| Ficheros maliciosos | Solo se aceptan imágenes, se vuelven a codificar con sharp y se guardan con un nombre generado por el servidor. Nunca se ejecuta lo que sube el usuario |
| Inyección SQL | Todas las consultas van con parámetros, sin concatenar texto |
| Espionaje del navegador | `Permissions-Policy` deja fuera cámara, micrófono, pagos y sensores. Solo se pide la ubicación, y únicamente si el vecino la ofrece |
| Fugas por error | Los detalles técnicos de los errores solo se muestran en modo desarrollo |
| Saturación | Límites por conexión al publicar, comentar, registrarse y consultar la API, y topes de tamaño en formularios y fotos |

### Mantenimiento

Revisa las dependencias de vez en cuando. Si aparece algo, actualiza y vuelve a pasar las pruebas:

```bash
npm audit
```

```bash
npm test
```

Actualiza también Node.js cuando salga una versión nueva de la serie con soporte a largo plazo.

### Copias de seguridad y datos personales

Ahora el foro guarda apellidos y teléfonos. La carpeta `data/` es información personal de tus vecinos: guárdala como guardarías una agenda de papel con los teléfonos del barrio. No la subas a un repositorio, no la compartas por WhatsApp y bórrala de los sitios donde no haga falta.

## Copias de seguridad

Toda la información está en la carpeta `data/`:

- `data/foro.sqlite` (y sus ficheros `-wal` / `-shm`): publicaciones, usuarios, comentarios…
- `data/uploads/`: fotos.

Copia esa carpeta con regularidad. Desde **Panel → Descargar copia de seguridad** obtienes una copia consistente de la base de datos sin parar el servidor. Para restaurar, para el servidor y sustituye `data/foro.sqlite` por la copia.

---

## Cuentas y datos personales

Para participar hay que registrarse con **nombre, apellidos, teléfono, correo electrónico y contraseña**. La sesión se inicia después solo con el correo y la contraseña.

### Qué se ve y qué no

| Dato | Quién lo ve |
|---|---|
| Nombre e inicial del primer apellido, por ejemplo «Marta G.» | Todo el mundo, es el nombre con el que se firma en el foro |
| Apellidos completos | Solo la administración, en **Panel → Usuarios** |
| Teléfono | Solo la administración |
| Correo electrónico | Solo la administración |
| Contraseña | Nadie: se guarda cifrada con bcrypt y no se puede recuperar, solo restablecer |

Pedir apellidos y teléfono desanima a quien viene a molestar y permite comprobar que quien publica es del barrio. Mostrar solo la inicial evita exponer el apellido completo de un vecino en una página pública indexada por los buscadores.

El teléfono admite nueve dígitos españoles, con o sin prefijo `+34`, y se guarda con el formato `612 34 56 78`. También acepta números internacionales con prefijo.

Cada persona puede corregir sus datos en **Mi perfil**. Las cuentas creadas antes de este cambio siguen funcionando; al entrar en su perfil verán los campos nuevos vacíos y podrán completarlos.

### Obligación legal

Guardar teléfonos y apellidos convierte al foro en responsable de datos personales. Antes de abrirlo al barrio:

- Rellena `LEGAL_OWNER` y `CONTACT_EMAIL` en el fichero `.env`, porque la política de privacidad los usa.
- No compartas la carpeta `data/` ni las copias de seguridad con nadie ajeno a la administración.
- Atiende las peticiones de borrado: cuando alguien pida que borres su cuenta, hazlo.

## Moderación y roles

- **Vecino/a**: publica, apoya, comenta, edita y borra lo suyo, denuncia contenido.
- **Moderador/a**: además ve el panel, revisa denuncias, oculta / muestra / fija / elimina cualquier publicación o comentario y cambia estados.
- **Administrador/a**: además gestiona usuarios (roles, bloqueo, contraseñas), borra el contenido de ejemplo y descarga copias.

Para nombrar moderadores: **Panel → Usuarios → Rol**. Recomendación: *ocultar* antes que *eliminar*; lo oculto solo lo ven su autor y la moderación y se puede recuperar.

### Recuperar el acceso de administración

Con el servidor parado, desde la carpeta del proyecto:

```bash
node --disable-warning=ExperimentalWarning scripts/reset-password.js correo@del-admin.es
```

(En Windows con el Node portátil: `tools\node\node.exe --disable-warning=ExperimentalWarning scripts\reset-password.js correo@del-admin.es`.) Muestra una contraseña nueva y desbloquea la cuenta si estaba bloqueada.

---

## Personalización

| Qué | Dónde |
|---|---|
| Nombre del barrio, municipio, textos de contacto, centro del mapa | `.env` |
| Categorías (nombre, icono, color) | `src/utils/constants.js` → `CATEGORY_SEED`. Las nuevas se crean al reiniciar; las existentes no se renombran automáticamente |
| Organismos responsables y motivos de denuncia | `src/utils/constants.js` |
| Teléfonos, enlaces y pasos para reclamar | `src/data/recursos.js` |
| Normas, «Sobre el foro», aviso legal, privacidad | `src/views/pages/rules.ejs`, `about.ejs`, `legal.ejs`, `privacy.ejs` |
| Colores y tipografía | `public/css/app.css` (variables en `:root`) |
| Logotipo | `public/img/logo.svg` y `favicon.svg`; luego `npm run icons` para regenerar los PNG |

---

## Estructura del proyecto

```
Iniciar.cmd            Arranque con doble clic (Windows)
src/server.js          Punto de entrada
src/app.js             Configuración de Express, seguridad y rutas
src/config.js          Lectura de .env
src/db/                Esquema SQLite, conexión y datos iniciales (seed.js)
src/services/          Acceso a datos: usuarios, publicaciones, comentarios, denuncias, estadísticas
src/services/events.js Bus de avisos en vivo (en memoria)
src/routes/            Rutas HTTP: portada/listados, autenticación, publicaciones, negocios, admin, API
src/middleware/        Sesiones, CSRF, subida de fotos, límites, errores
src/views/             Plantillas EJS (páginas, parciales, admin)
src/data/recursos.js   Contactos y pasos para reclamar
public/                CSS, JavaScript, imágenes
public/sw.js           Service worker: modo app, sin conexión y caché de fotos
public/manifest.webmanifest  Ficha de la app instalable (iconos, atajos, compartir)
public/js/live.js      Actualización en vivo en el navegador
public/js/pwa.js       Instalación y aviso de versión nueva
scripts/               Utilidades (iconos, contraseña, rastreo, carga, copia estática, secreto)
Caddyfile              Proxy con HTTPS automático para producción
DESPLIEGUE.md          Guía paso a paso para ponerlo en el dominio
.env.produccion.example  Plantilla de configuración del servidor
tests/                 Pruebas automáticas (npm test)
data/                  Base de datos y fotos (no se sube al repositorio)
tools/node/            Node.js portátil para Windows (no se sube al repositorio)
```

## Pruebas

```bash
npm test
```

Arranca la aplicación en memoria y comprueba páginas públicas, API, protección CSRF, registro,
inicio de sesión, publicación, apoyo, comentarios, cambio de estado, panel y borrado. También
el modo app (manifiesto, iconos, service worker, pantalla sin conexión, compartir desde el móvil)
y el directo (los avisos llegan, respetan quién puede verlos y no duplican comentarios).

```bash
npm run rastreo   # recorre todas las páginas con tres perfiles
npm run carga     # mide cuánta gente aguanta, incluido el directo
```

## Licencia

MIT. Úsalo, adáptalo y compártelo con otros barrios.
