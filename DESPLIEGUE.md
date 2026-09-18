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
2. **Cambia la contraseña** desde «Mi perfil».
3. **Borra el fichero del primer acceso**:
   ```bash
   rm data/PRIMER-ACCESO.txt
   ```
4. **Mira el recuadro del panel**: «Antes de abrir el foro al barrio» te dice si
   queda algo pendiente. Desaparece solo cuando está todo.
5. **Pruébalo desde el móvil**: entra al dominio, instálalo como app (menú del
   navegador → «Instalar aplicación») y publica una incidencia de prueba. Luego
   bórrala.

---

## 7. Copias de seguridad

Todo lo que importa está en la carpeta `data/`: la base de datos y las fotos.
Una tarea diaria que la copie fuera del servidor:

```bash
sudo crontab -e
```

```
0 4 * * * cd /opt/foro && tar czf /var/backups/foro-$(date +\%F).tar.gz data/ && find /var/backups -name 'foro-*.tar.gz' -mtime +30 -delete
```

Copia la base de datos a las 4 de la mañana y guarda los últimos 30 días. Y de
vez en cuando, **bájate una copia a tu ordenador**: una copia que solo vive en el
mismo servidor no es una copia de seguridad.

> `data/` contiene datos personales de vecinos. No la subas a ningún repositorio
> ni la compartas por correo.

---

## Actualizar el foro más adelante

```bash
cd /opt/foro
git pull            # o vuelve a subir los ficheros
docker compose up -d --build
```

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

---

## Lo que todavía no tiene

**Recuperación de contraseña por correo.** Si un vecino la olvida, hoy solo puede
resolverlo un administrador a mano desde el panel. Con cientos de vecinos vas a
recibir esa petición cada semana, así que conviene resolverlo pronto: hace falta
una cuenta de envío de correo (Brevo, Resend o el SMTP de tu hosting), que en el
volumen de un barrio es gratis.
