#!/usr/bin/env bash
#
# Instalador del foro en un servidor Ubuntu.
#
# Hace todo lo que describe DESPLIEGUE.md: instala Docker si falta, abre el
# cortafuegos, pregunta los cuatro datos que solo sabe el usuario, escribe el
# fichero .env y arranca el foro con HTTPS.
#
# Uso, dentro de la carpeta del proyecto en el servidor:
#
#   bash scripts/instalar.sh
#
# Se puede volver a ejecutar sin miedo: si ya hay un .env, pregunta antes de
# tocarlo, y nunca borra la carpeta data/ con los datos de los vecinos.

set -euo pipefail

DOMINIO_POR_DEFECTO='veredadelosestudiantes.es'

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
titulo() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

abortar() { echo; rojo "$*"; exit 1; }

# Los valores van entre comillas simples en el .env, así que una comilla simple
# dentro del valor rompería el fichero. Es más honesto rechazarla que escribir
# un .env corrupto que luego falla sin explicar por qué.
sin_comillas() {
  case "$1" in
    *"'"*) return 1 ;;
    *) return 0 ;;
  esac
}

preguntar() {
  # preguntar <variable> <texto> [valor por defecto]
  local destino="$1" texto="$2" defecto="${3:-}" respuesta=''
  while true; do
    if [ -n "$defecto" ]; then
      read -r -p "$texto [$defecto]: " respuesta </dev/tty || true
      respuesta="${respuesta:-$defecto}"
    else
      read -r -p "$texto: " respuesta </dev/tty || true
    fi
    respuesta="$(printf '%s' "$respuesta" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [ -z "$respuesta" ]; then
      rojo "  Esto no puede quedar vacío."
    elif ! sin_comillas "$respuesta"; then
      rojo "  No uses comillas simples ( ' ). Escríbelo sin ellas."
    else
      printf -v "$destino" '%s' "$respuesta"
      return 0
    fi
  done
}

preguntar_contrasena() {
  local destino="$1" primera='' segunda=''
  while true; do
    read -r -s -p "Contraseña para tu cuenta de administrador: " primera </dev/tty || true
    echo
    read -r -s -p "Repítela para confirmar: " segunda </dev/tty || true
    echo
    if [ "$primera" != "$segunda" ]; then
      rojo "  No coinciden. Prueba otra vez."
    elif [ "${#primera}" -lt 8 ]; then
      rojo "  Tiene que tener 8 caracteres como mínimo."
    elif ! printf '%s' "$primera" | grep -qE '^[A-Za-z0-9._@!%*+-]+$'; then
      rojo "  Usa solo letras, números y estos símbolos:  . _ @ ! % * + -"
    elif printf '%s' "$primera" | grep -qE '^[0-9]+$'; then
      rojo "  No puede ser solo números."
    else
      printf -v "$destino" '%s' "$primera"
      return 0
    fi
  done
}

# ---------------------------------------------------------------- comprobaciones

[ "$(id -u)" -eq 0 ] || abortar 'Ejecuta esto como root:  sudo bash scripts/instalar.sh'
[ -f docker-compose.yml ] || abortar 'Ejecuta esto desde la carpeta del foro:  cd /opt/foro && bash scripts/instalar.sh'
# El instalador pregunta cosas, así que necesita una terminal de verdad. Sin
# ella las preguntas se quedarían en bucle sin que se entienda por qué.
[ -r /dev/tty ] || abortar 'Esto hay que ejecutarlo escribiéndolo en una terminal, no de forma automática.'

titulo 'Docker'
if docker compose version >/dev/null 2>&1; then
  verde "Docker ya está instalado: $(docker --version)"
else
  echo 'Docker no está. Instalándolo (tarda un par de minutos)...'
  curl -fsSL https://get.docker.com | sh
  docker compose version >/dev/null 2>&1 || abortar 'Docker se ha instalado pero "docker compose" no responde. Párate aquí y cuéntamelo.'
  verde 'Docker instalado.'
fi

titulo 'Cortafuegos'
if command -v ufw >/dev/null 2>&1; then
  # OpenSSH primero: si se activa el cortafuegos sin permitirlo, te quedas
  # fuera del servidor y hay que entrar por la consola del panel.
  ufw allow OpenSSH   >/dev/null 2>&1 || true
  ufw allow 80/tcp    >/dev/null 2>&1 || true
  ufw allow 443/tcp   >/dev/null 2>&1 || true
  ufw --force enable  >/dev/null 2>&1 || true
  verde 'Puertos 80 y 443 abiertos, y tu acceso por SSH a salvo.'
else
  echo 'No hay ufw en este servidor. Si tu proveedor tiene cortafuegos propio,'
  echo 'asegúrate de abrir los puertos 80 y 443.'
fi

# ------------------------------------------------------------------------ .env

titulo 'Configuración'

if [ -f .env ]; then
  echo 'Ya existe un fichero .env en este servidor.'
  read -r -p '¿Lo rehacemos desde cero? Se perderá lo que tuviera. (s/N): ' respuesta </dev/tty || true
  case "${respuesta:-n}" in
    s|S|si|SI|Si|sí|Sí)
      cp .env ".env.anterior.$(date +%Y%m%d-%H%M%S)"
      echo 'Guardada una copia del anterior por si acaso.'
      ;;
    *)
      echo 'Dejo el .env como está y paso a arrancar el foro.'
      SALTAR_ENV=1
      ;;
  esac
fi

if [ -z "${SALTAR_ENV:-}" ]; then
  echo 'Cuatro datos y ya está. Los tres primeros son para tu cuenta; el último'
  echo 'es obligatorio por el RGPD, porque el foro guarda teléfonos de vecinos.'
  echo

  preguntar DOMINIO 'Dominio del foro' "$DOMINIO_POR_DEFECTO"
  preguntar ADMIN_EMAIL 'Tu correo (con él entrarás como administrador)'
  preguntar_contrasena ADMIN_PASSWORD
  echo
  preguntar LEGAL_OWNER 'Quién responde legalmente del foro (tu nombre o el de la asociación)'
  preguntar CONTACT_EMAIL 'Correo de contacto para los vecinos' "$ADMIN_EMAIL"

  # El secreto de las sesiones se genera aquí mismo, en el servidor: así no pasa
  # por ningún chat, correo ni pantalla.
  SESSION_SECRET="$(openssl rand -hex 48)"

  # Se escribe línea a línea y entre comillas simples, para que ningún símbolo
  # raro de una contraseña rompa el fichero.
  {
    printf "# Generado por scripts/instalar.sh el %s\n" "$(date '+%d/%m/%Y a las %H:%M')"
    printf "# Este fichero lleva contraseñas. No lo subas a ningún repositorio.\n\n"
    printf "DOMINIO='%s'\n" "$DOMINIO"
    printf "BASE_URL='https://%s'\n" "$DOMINIO"
    printf "NODE_ENV='production'\n"
    printf "TRUST_PROXY='1'\n\n"
    printf "SESSION_SECRET='%s'\n\n" "$SESSION_SECRET"
    printf "ADMIN_EMAIL='%s'\n" "$ADMIN_EMAIL"
    printf "ADMIN_PASSWORD='%s'\n\n" "$ADMIN_PASSWORD"
    printf "SITE_NAME='Vereda de los Estudiantes'\n"
    printf "SITE_BRAND='Foro Vecinal'\n"
    printf "MUNICIPALITY='Leganés'\n"
    printf "LEGAL_OWNER='%s'\n" "$LEGAL_OWNER"
    printf "CONTACT_EMAIL='%s'\n\n" "$CONTACT_EMAIL"
    printf "SEED_DEMO='false'\n\n"
    printf "MAP_CENTER_LAT='40.3215'\n"
    printf "MAP_CENTER_LNG='-3.756'\n"
    printf "MAP_ZOOM='15'\n\n"
    printf "MAX_UPLOAD_MB='8'\n"
    printf "MAX_IMAGES_PER_POST='4'\n"
    printf "LIMITE_VIVO='240'\n\n"
    printf "# Compartir en Facebook: opcional, se rellena desde el README.\n"
    printf "FACEBOOK_PAGE_ID=''\n"
    printf "FACEBOOK_PAGE_TOKEN=''\n\n"
    printf "PERMITIR_INSEGURO='0'\n"
  } > .env
  chmod 600 .env
  verde 'Configuración escrita en .env (solo la puede leer root).'
fi

# -------------------------------------------------------------------- arranque

# En producción el foro se niega a arrancar si sigue en el disco el fichero con
# la contraseña inicial. Es a propósito, pero la primera vez pilla por sorpresa:
# el contenedor se reinicia una y otra vez sin que se vea el motivo.
if [ -f data/PRIMER-ACCESO.txt ]; then
  titulo 'Atención'
  echo 'Queda en el servidor el fichero data/PRIMER-ACCESO.txt, con la contraseña'
  echo 'inicial. Mientras esté ahí, el foro NO arranca: es una protección adrede.'
  echo
  read -r -p '¿Ya entraste y cambiaste la contraseña? Si es así lo borro. (s/N): ' respuesta </dev/tty || true
  case "${respuesta:-n}" in
    s|S|si|SI|Si|sí|Sí) rm -f data/PRIMER-ACCESO.txt; verde 'Borrado.' ;;
    *) abortar 'Entra en el foro, cambia la contraseña en «Mi perfil» y vuelve a ejecutar esto.' ;;
  esac
fi

# El foro corre dentro del contenedor como el usuario «node» (identificador
# 1000), no como root. La carpeta data/ del servidor se monta encima de la del
# contenedor, y Docker la crea a nombre de root: el foro no podría escribir sus
# fotos ni su base de datos y se caería con «permission denied» al arrancar.
# Hay que preparar la carpeta aquí fuera, antes de levantarlo.
titulo 'Carpeta de datos'
mkdir -p data
chown -R 1000:1000 data
verde 'data/ preparada para que el foro pueda escribir en ella.'

titulo 'Arrancando el foro'
echo 'La primera vez tarda unos minutos: hay que construirlo y pedir el'
echo 'certificado de HTTPS a Let'"'"'s Encrypt.'
echo

docker compose up -d --build

# No basta con que el contenedor exista: hay que ver que sigue vivo unos
# segundos después. Si se cae, el usuario tiene que enterarse aquí y ahora,
# no descubrirlo cuando el navegador no cargue.
echo
echo 'Comprobando que el foro se mantiene en pie...'
sleep 12
ESTADO="$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null || true)"
echo "$ESTADO"
if printf '%s' "$ESTADO" | grep -qiE 'foro +(restarting|exited|dead)'; then
  rojo '
El foro no consigue arrancar. Esto es lo último que ha dicho:'
  echo
  docker compose logs --tail 30 foro || true
  abortar 'Cópiame esas líneas y te digo qué pasa. Suele ser algo que falta en el .env.'
fi
verde 'El foro está en marcha.'

# Vale tanto si el .env lo escribió este instalador (con comillas) como si lo
# rellenó alguien a mano a partir de .env.produccion.example (sin ellas).
DOMINIO_FINAL="$(sed -n "s/^DOMINIO=['\"]\{0,1\}\([^'\"]*\)['\"]\{0,1\}[[:space:]]*$/\1/p" .env | head -1)"
DOMINIO_FINAL="${DOMINIO_FINAL:-$DOMINIO_POR_DEFECTO}"

titulo 'Listo'
verde "Abre https://${DOMINIO_FINAL} en el navegador."
cat <<'FIN'

Si sale un aviso de certificado, espera un minuto y recarga: Caddy puede
tardar un poco en conseguirlo la primera vez.

Lo que toca ahora, en este orden:

  1. Entra en el foro con el correo y la contraseña que acabas de poner.
  2. Cambia la contraseña desde «Mi perfil».
  3. Borra el fichero de la contraseña inicial:

         cd /opt/foro && rm data/PRIMER-ACCESO.txt

     NO TE SALTES ESTE PASO. Mientras ese fichero exista, el foro se negará
     a arrancar la próxima vez que se reinicie el servidor, y parecerá que
     se ha roto sin motivo. Es una protección a propósito: ese fichero lleva
     tu contraseña escrita en claro.

  4. Mira el recuadro «Antes de abrir el foro al barrio» en el Panel:
     te dice si queda algo pendiente y desaparece solo cuando está todo.

Para ver qué está pasando por dentro:   docker compose logs -f
Para actualizar el foro más adelante:   git pull && docker compose up -d --build

FIN
