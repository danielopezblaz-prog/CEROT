# Poner el foro en el dominio

Guía de principio a fin. Al terminar, cualquier vecino entra desde su móvil
escribiendo el dominio, y puede instalarse el foro como aplicación.

Cuenta unos **40 minutos** la primera vez.

---

## Lo que hace falta

| | |
|---|---|
| **Dominio** | Ya lo tienes. |
| **Servidor** | Un VPS pequeño basta: 1 núcleo, 1 GB de memoria, 20 GB de disco. Desde unos 4–6 € al mes (Hetzner, Clouding, OVH, IONOS…). |
| **Acceso al servidor** | Por SSH, con el usuario que te dé el proveedor. |
| **Acceso al DNS** | El panel donde compraste el dominio. |

> **Un PC de casa no vale** para esto. Funciona, pero depende de que esté siempre
> encendido y abre tu red doméstica a internet. Para algo que va a usar el barrio
> entero, un servidor sale por menos de lo que cuesta un café a la semana.

---

## 1. Apuntar el dominio al servidor

En el panel de tu dominio, crea un registro **A**:

| Tipo | Nombre | Valor |
|---|---|---|
| A | `@` | la IP del servidor |
| A | `www` | la IP del servidor |

El primero hace que funcione `veredadelosestudiantes.es`. El segundo, que quien
escriba `www.veredadelosestudiantes.es` acabe en la misma página: el `Caddyfile`
incluido lo redirige al dominio a secas, para que los enlaces que comparten los
vecinos no se dupliquen.

El cambio tarda entre unos minutos y un par de horas. Compruébalo desde tu
ordenador antes de seguir:

```bash
nslookup veredadelosestudiantes.es
```

Tiene que responder con la IP del servidor. **No sigas hasta que lo haga**: si el
dominio todavía no apunta bien, Let's Encrypt fallará al dar el certificado y hay
un límite de intentos por día.

---

## 2. Preparar el servidor

Entra por SSH e instala Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

Abre los puertos 80 y 443 en el cortafuegos (si usas `ufw`):

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow OpenSSH && sudo ufw enable
```

---

## 3. Subir el foro

Copia el proyecto al servidor **sin** las carpetas `node_modules/`, `tools/`,
`data/` ni `export/`. Con `scp` desde tu ordenador, o con `git clone` si lo tienes
en un repositorio.

El proyecto tiene que quedar en una carpeta del servidor, por ejemplo `/opt/foro`.

---

## 4. Configurar

Genera el secreto de las sesiones **en tu ordenador**:

```bash
npm run secreto
```

En el servidor, copia la plantilla y rellénala:

```bash
cp .env.produccion.example .env
nano .env
```

Lo que no puede quedar vacío:

- `DOMINIO` y `BASE_URL` — con tu dominio de verdad.
- `SESSION_SECRET` — la línea que acabas de generar.
- `ADMIN_EMAIL` y `ADMIN_PASSWORD` — tu primer acceso.
- `LEGAL_OWNER` y `CONTACT_EMAIL` — **obligatorio por el RGPD**, porque el foro
  guarda nombres, apellidos y teléfonos. Tiene que constar quién responde de esos
  datos y a dónde escribir para pedir acceso, rectificación o borrado.

---

## 5. Arrancar

Primero prepara la carpeta donde el foro guardará la base de datos y las
fotos. El foro corre dentro del contenedor como un usuario sin privilegios,
y si esa carpeta pertenece a `root` no podrá escribir en ella:

```bash
mkdir -p data && chown -R 1000:1000 data
```

Y ahora sí:

```bash
docker compose up -d --build
```

Eso levanta dos cosas: el foro y un proxy (Caddy) que pide el certificado de
HTTPS él solo y lo renueva sin que nadie se acuerde.

Mira que todo haya ido bien:

```bash
docker compose logs -f
```

Busca en los mensajes de Caddy la línea del certificado. Cuando aparezca, abre
`https://veredadelosestudiantes.es` en el navegador. Debería salir el foro, vacío.

---

## 6. Los cinco minutos siguientes

1. **Entra** con el correo y la contraseña que pusiste en `.env`.
2. **Cambia la contraseña** desde «Mi perfil». Al hacerlo, el fichero con la
   contraseña inicial (`data/PRIMER-ACCESO.txt`) se borra solo.
3. **Mira el recuadro del panel**: «Antes de abrir el foro al barrio» te dice si
   queda algo pendiente. Desaparece solo cuando está todo.
4. **Pruébalo desde el móvil**: entra al dominio, instálalo como app (menú del
   navegador → «Instalar aplicación») y publica una incidencia de prueba. Luego
   bórrala.

---

## 7. Copias de seguridad

Todo lo que importa está en la carpeta `data/`: la base de datos y las fotos.
El instalador deja programada una copia **cada noche a las 4:00** en
`/var/backups/foro`, hecha con `scripts/copia.sh`: SQLite escribe una copia
consistente de la base de datos sin parar el foro, y se empaqueta junto con las
fotos. Se conservan los últimos 30 días. Para hacer una copia ahora mismo:

```bash
bash scripts/copia.sh
```

Y de vez en cuando, **bájate una copia a tu ordenador** (están en
`/var/backups/foro/`): una copia que solo vive en el mismo servidor no es una
copia de seguridad.

> `data/` contiene datos personales de vecinos. No la subas a ningún repositorio
> ni la compartas por correo.

---

## Actualizar el foro más adelante

```bash
cd /opt/foro && bash scripts/actualizar.sh
```

Hace una copia de seguridad, descarga la versión nueva, la construye y comprueba
que la web responde pasando por el candado. Si la versión nueva no responde,
**vuelve sola a la anterior** y te enseña el motivo para que lo cuentes.

Los vecinos que tengan la app instalada verán un aviso de «hay una versión nueva»
la próxima vez que la abran.

---

## Si algo no va

| Qué ves | Qué suele ser |
|---|---|
| El navegador no encuentra el dominio | El DNS todavía no ha llegado, o el registro A está mal. Comprueba con `nslookup`. |
| «Certificado no válido» o Caddy da error | El dominio no apuntaba al servidor cuando arrancó. Arregla el DNS y reinicia: `docker compose restart caddy`. |
| El foro no arranca y habla de «puntos imprescindibles» | Es el repaso de seguridad: te está diciendo qué falta en `.env`. Léelo, lo dice en castellano. |
| Los comentarios no aparecen solos | El proxy está guardando el flujo en un búfer. Con el `Caddyfile` incluido no pasa; si usas nginx, hace falta `proxy_buffering off;` para `/api/eventos`. |
| Todos los vecinos comparten el límite de peticiones | Falta `TRUST_PROXY=1` en `.env`. |
| `EACCES: permission denied, mkdir '/data/uploads'` | La carpeta `data/` pertenece a `root` y el foro corre como usuario sin privilegios. Arréglalo con `chown -R 1000:1000 data` y vuelve a levantarlo. |
| El mapa sale gris para todo el mundo | El servidor no llega a OpenStreetMap (los planos los pide el foro, no el navegador). En `docker compose logs foro` verás «No se ha podido obtener el plano». Suele ser un cortafuegos de salida o un proxy del proveedor. |
| El correo de recuperación no llega | Mira `docker compose logs --tail 50 foro`: el motivo sale en castellano. Casi siempre es que falta verificar el remitente en el proveedor, o que la clave `CORREO_CLAVE` ya no vale. Revisa también la carpeta de spam. |
| Brevo responde «unrecognised IP address» | Brevo bloquea las direcciones que no conoce. Añade la del servidor en <https://app.brevo.com/security/authorised_ips> y repite el envío con `bash scripts/correo.sh --probar`. La clave no tiene nada que ver. |
| El script dice «enviado» pero no llega nada | Brevo lo aceptó y falló después. Míralo en su panel, en **Transactional → Logs**: ahí pone si salió, si rebotó o si está retenido. Las cuentas nuevas suelen estar pendientes de activación las primeras horas. Repasa también que el remitente esté verificado y la dirección de destino bien escrita. |

---

## Después de abrir: que los vecinos puedan recuperar su contraseña

Hasta que no le digas al foro por qué buzón enviar, quien olvide su contraseña
tendrá que pedírtela a ti. Se arregla en diez minutos y **sin gastar nada**: con
una cuenta de Gmail nueva para el foro, o con una cuenta gratuita de Brevo.

```bash
cd /opt/foro && bash scripts/correo.sh
```

El script lo pregunta todo y manda un correo de prueba al terminar. Está explicado paso a paso en el README, apartado «Recuperar la
contraseña», incluido por qué el servidor no puede enviarlos él solo. El panel de
moderación te avisa mientras esté sin configurar.

---

## Después de abrir: que Google la encuentre

Todo lo técnico va ya dentro del foro (títulos, mapa del sitio, fichas para los
buscadores). Lo que falta se hace una sola vez: dar de alta el dominio en Google
Search Console y enviarle el mapa del sitio. Está explicado paso a paso en el
README, apartado «Aparecer en Google».

---

## Lo que todavía no tiene

**Avisos al móvil y modo oscuro.** Se han dejado fuera a propósito. El modo
oscuro a medias queda peor que no tenerlo, y los avisos push obligan a pedir
permiso al vecino en cuanto entra, que es justo lo contrario de lo que queremos
en el primer minuto.

**Publicar sin cuenta.** Hoy hay que registrarse para publicar. Es lo que
sostiene el valor del informe («esto lo firman 40 vecinos») y lo que permite
saber quién escribió qué si algo se tuerce.
