#!/usr/bin/env bash
#
# Configura por dónde manda el foro sus correos y lo comprueba enviando uno.
#
# Solo se usan para una cosa: el enlace de «he olvidado mi contraseña». Mientras
# esto no esté puesto, quien olvide la suya depende de que se la cambies tú a
# mano desde el panel.
#
# Uso, en el servidor:  cd /opt/foro && bash scripts/correo.sh
#
# Se puede volver a ejecutar las veces que haga falta: solo toca las líneas del
# correo en el .env y nunca borra nada de la carpeta data/.

set -euo pipefail
cd "$(dirname "$0")/.."

rojo()   { printf '\033[31m%s\033[0m\n' "$*"; }
verde()  { printf '\033[32m%s\033[0m\n' "$*"; }
gris()   { printf '\033[90m%s\033[0m\n' "$*"; }
titulo() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
abortar() { echo; rojo "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || abortar 'Ejecuta esto como root:  sudo bash scripts/correo.sh'
[ -f .env ] || abortar 'Aquí no hay un foro instalado (falta el .env). La primera vez se usa scripts/instalar.sh.'

# Los valores van entre comillas simples en el .env; una comilla dentro rompería
# el fichero. Es más honesto rechazarla que dejar un .env corrupto.
sin_comillas() { case "$1" in *"'"*) return 1 ;; *) return 0 ;; esac; }

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
      rojo '  Esto no puede quedar vacío.'
    elif ! sin_comillas "$respuesta"; then
      rojo "  No uses comillas simples ( ' ). Escríbelo sin ellas."
    else
      printf -v "$destino" '%s' "$respuesta"
      return 0
    fi
  done
}

# Pregunta una dirección de correo. Quita espacios, la pasa a minúsculas y
# comprueba que al menos tenga forma de dirección: un paseo de más aquí ahorra
# un «no me llega» que luego cuesta media hora encontrar.
preguntar_correo() {
  local destino="$1" texto="$2" defecto="${3:-}" valor=''
  while true; do
    preguntar valor "$texto" "$defecto"
    valor="$(printf '%s' "$valor" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
    if printf '%s' "$valor" | grep -qE '^[^@]+@[^@.]+\.[^@]+$'; then
      printf -v "$destino" '%s' "$valor"
      return 0
    fi
    rojo "  «$valor» no tiene forma de dirección de correo. Repásala."
  done
}

# Lee un valor del .env, con o sin comillas.
leer_env() {
  sed -n "s/^$1=['\"]\{0,1\}\([^'\"]*\)['\"]\{0,1\}[[:space:]]*$/\1/p" .env | head -1
}

# Cambia (o añade) una línea del .env sin tocar el resto.
poner_env() {
  local clave="$1" valor="${2:-}" escapado
  escapado="${valor//\'/\'\\\'\'}"
  grep -v "^${clave}=" .env > .env.nuevo || true
  printf "%s='%s'\n" "$clave" "$escapado" >> .env.nuevo
  cat .env.nuevo > .env
  rm -f .env.nuevo
  chmod 600 .env
}

DOMINIO="$(leer_env DOMINIO)"
ADMIN="$(leer_env ADMIN_EMAIL)"
ACTUAL="$(leer_env CORREO_PROVEEDOR)"

# Con --probar solo se manda otro correo de prueba, sin tocar la configuración.
# Sirve cuando el envío falló por algo de fuera (una dirección IP por autorizar,
# un remitente sin confirmar) y no hay que volver a escribir la clave.
if [ "${1:-}" = '--probar' ]; then
  [ -n "$(leer_env CORREO_PROVEEDOR)" ] || abortar 'Todavía no hay correo configurado. Ejecuta:  bash scripts/correo.sh'
  titulo 'Prueba de envío'
  preguntar_correo DESTINO '¿A qué dirección te mando el correo de prueba?' "$(leer_env ADMIN_EMAIL)"
  gris "Se lo mando a: $DESTINO"
  echo
  if docker compose exec -T -e "DESTINO_PRUEBA=$DESTINO" foro \
       node --disable-warning=ExperimentalWarning scripts/probar-correo.mjs; then
    echo
    verde 'Enviado. Mira tu buzón (y la carpeta de spam, por si acaso).'
    exit 0
  fi
  echo
  rojo 'Sigue sin salir. El motivo está en la línea de arriba.'
  exit 1
fi

titulo 'Correo del foro'
if [ -n "$ACTUAL" ]; then
  gris "Ahora mismo envía con: $ACTUAL  (remitente: $(leer_env CORREO_REMITENTE))"
else
  gris 'Ahora mismo el foro no envía correos.'
fi
cat <<'FIN'

¿Por dónde quieres que salgan?

  1) Una cuenta de Gmail                  gratis, lo más sencillo
  2) El buzón de tu dominio u otro        el que ya tengas contratado
  3) Brevo                                gratis, 300 correos al día
  4) Por ninguno: dejar de enviar         vuelve a como estaba

FIN

OPCION=''
while true; do
  read -r -p 'Escribe 1, 2, 3 o 4: ' OPCION </dev/tty || true
  case "$OPCION" in
    1|2|3|4) break ;;
    *) rojo '  Tiene que ser 1, 2, 3 o 4.' ;;
  esac
done

case "$OPCION" in
  1)
    cat <<'FIN'

Antes de seguir necesitas dos cosas de esa cuenta de Gmail:

  1. La verificación en dos pasos activada
     https://myaccount.google.com/security
  2. Una «contraseña de aplicación», que son 16 letras
     https://myaccount.google.com/apppasswords

Ojo: la contraseña de aplicación NO es la contraseña con la que entras en Gmail.
FIN
    echo
    preguntar_correo USUARIO 'Dirección de Gmail del foro (por ejemplo foro.vereda@gmail.com)'
    preguntar CLAVE 'Contraseña de aplicación (las 16 letras; puedes pegarla con espacios)'
    CLAVE="${CLAVE// /}"
    if [ "${#CLAVE}" -ne 16 ]; then
      rojo "  Aviso: las contraseñas de aplicación suelen tener 16 letras y esta tiene ${#CLAVE}."
      rojo '  Si no funciona, vuelve a ejecutar este script y pégala de nuevo.'
    fi
    poner_env CORREO_PROVEEDOR 'smtp'
    poner_env CORREO_SERVIDOR 'smtp.gmail.com'
    poner_env CORREO_PUERTO '587'
    poner_env CORREO_USUARIO "$USUARIO"
    poner_env CORREO_CLAVE "$CLAVE"
    poner_env CORREO_REMITENTE "$USUARIO"
    ;;
  2)
    echo
    gris 'Si es el buzón de tu dominio en Hostinger: smtp.hostinger.com, puerto 465.'
    echo
    preguntar SERVIDOR 'Servidor de correo saliente' 'smtp.hostinger.com'
    preguntar PUERTO 'Puerto (465 cifrado, 587 el habitual)' '465'
    preguntar_correo USUARIO 'Dirección de correo completa'
    preguntar CLAVE 'Contraseña de ese buzón'
    poner_env CORREO_PROVEEDOR 'smtp'
    poner_env CORREO_SERVIDOR "$SERVIDOR"
    poner_env CORREO_PUERTO "$PUERTO"
    poner_env CORREO_USUARIO "$USUARIO"
    poner_env CORREO_CLAVE "$CLAVE"
    poner_env CORREO_REMITENTE "$USUARIO"
    ;;
  3)
    cat <<'FIN'

Antes de seguir necesitas dos cosas de Brevo (https://www.brevo.com):

  1. El remitente verificado
     Senders, Domains & Dedicated IPs -> Senders -> Add a sender
     Te mandan un correo de confirmación: ábrelo y pulsa el enlace.
  2. La clave
     Tu nombre (arriba a la derecha) -> SMTP & API -> API Keys
     Empieza por «xkeysib-» y solo se enseña una vez.
FIN
    echo
    preguntar CLAVE 'Clave de Brevo (xkeysib-...)'
    preguntar_correo REMITENTE 'Dirección verificada en Brevo, desde la que saldrán los correos'
    poner_env CORREO_PROVEEDOR 'brevo'
    poner_env CORREO_CLAVE "$CLAVE"
    poner_env CORREO_REMITENTE "$REMITENTE"
    poner_env CORREO_SERVIDOR ''
    poner_env CORREO_USUARIO ''
    ;;
  4)
    poner_env CORREO_PROVEEDOR ''
    poner_env CORREO_CLAVE ''
    poner_env CORREO_SERVIDOR ''
    poner_env CORREO_USUARIO ''
    poner_env CORREO_REMITENTE ''
    ;;
esac

titulo 'Aplicando el cambio'
docker compose up -d --build foro

echo
echo 'Esperando a que el foro vuelva a responder...'
for intento in $(seq 1 18); do
  sleep 5
  codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k --resolve "${DOMINIO}:443:127.0.0.1" "https://${DOMINIO}/api/salud" 2>/dev/null || true)"
  [ "$codigo" = '200' ] && break
done
if [ "${codigo:-}" != '200' ]; then
  rojo 'El foro no responde. Esto es lo último que ha dicho:'
  docker compose logs --tail 30 --since 3m foro || true
  abortar 'Cópiame las líneas de arriba.'
fi

if [ "$OPCION" = '4' ]; then
  echo
  verde 'Listo. El foro ya no envía correos.'
  echo 'En la pantalla de acceso, a quien olvide su contraseña se le dirá que escriba a la administración.'
  exit 0
fi

titulo 'Prueba de envío'
preguntar_correo DESTINO '¿A qué dirección te mando el correo de prueba?' "${ADMIN:-}"
gris "Se lo mando a: $DESTINO"
echo
if docker compose exec -T -e "DESTINO_PRUEBA=$DESTINO" foro \
     node --disable-warning=ExperimentalWarning scripts/probar-correo.mjs; then
  echo
  verde 'Enviado. Mira tu buzón (y la carpeta de spam, por si acaso).'
  echo "Cuando te llegue, los vecinos ya pueden recuperar su contraseña en https://${DOMINIO}/recuperar"
else
  echo
  rojo 'No ha salido. El motivo está en la línea de arriba.'
  echo
  echo 'Los datos han quedado guardados. Cuando arregles lo que diga, NO hace falta'
  echo 'volver a meter la clave: basta con repetir solo la prueba de envío con'
  echo
  echo "  cd $(pwd) && bash scripts/correo.sh --probar"
  echo
  exit 1
fi
