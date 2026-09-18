#!/usr/bin/env bash
#
# Actualiza el foro en el servidor con red de seguridad:
#
#   1. hace una copia de seguridad (base de datos consistente y fotos),
#   2. descarga la versión nueva del repositorio,
#   3. la construye y la arranca,
#   4. comprueba que la web responde de verdad, pasando por Caddy y el candado,
#   5. y si no responde, vuelve a la versión anterior y la arranca.
#
# Uso, en el servidor:  cd /opt/foro && bash scripts/actualizar.sh

set -euo pipefail
cd "$(dirname "$0")/.."

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
titulo() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
abortar() { echo; rojo "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || abortar 'Ejecuta esto como root:  sudo bash scripts/actualizar.sh'
[ -f .env ] || abortar 'Aquí no hay un foro instalado (falta el .env). La primera vez se usa scripts/instalar.sh.'
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  abortar 'Hay ficheros del foro modificados a mano en este servidor. Así no puedo actualizar sin pisarlos: cuéntamelo antes.'
fi

# El dominio, del .env: vale con comillas (instalador) o sin ellas (a mano).
DOMINIO="$(sed -n "s/^DOMINIO=['\"]\{0,1\}\([^'\"]*\)['\"]\{0,1\}[[:space:]]*$/\1/p" .env | head -1)"
[ -n "$DOMINIO" ] || abortar 'No encuentro DOMINIO en el .env.'

# ¿Responde la web como la vería un vecino? Hasta minuto y medio de margen.
responde() {
  local intento codigo
  for intento in $(seq 1 18); do
    sleep 5
    codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k --resolve "${DOMINIO}:443:127.0.0.1" "https://${DOMINIO}/api/salud" 2>/dev/null || true)"
    [ "$codigo" = "200" ] && return 0
    if docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -qiE '^foro +(exited|dead)'; then return 1; fi
  done
  return 1
}

ANTES="$(git rev-parse HEAD)"

titulo 'Copia de seguridad'
bash scripts/copia.sh

titulo 'Descargando la versión nueva'
git fetch -q origin
NUEVO="$(git rev-parse '@{u}')"
if [ "$ANTES" = "$NUEVO" ]; then
  verde 'Ya tienes la última versión. No hay nada que actualizar.'
  exit 0
fi
git merge -q --ff-only "$NUEVO"
echo "De $(git rev-parse --short "$ANTES") a $(git rev-parse --short "$NUEVO"): $(git diff --shortstat "$ANTES" "$NUEVO")"

titulo 'Construyendo y arrancando la versión nueva'
docker compose up -d --build
echo
echo 'Comprobando que el foro responde en la web...'
if responde; then
  echo
  docker compose ps
  verde "Actualizado. El foro responde en https://${DOMINIO}."
  echo 'Los vecinos con la app instalada verán el aviso de versión nueva al abrirla.'
  exit 0
fi

titulo 'La versión nueva no responde: vuelvo a la anterior'
rojo 'Esto es lo último que ha dicho la versión nueva:'
docker compose logs --tail 30 --since 3m foro || true
echo
git reset -q --hard "$ANTES"
docker compose up -d --build
echo 'Comprobando que la versión anterior responde...'
if responde; then
  echo
  rojo "He vuelto a la versión anterior ($(git rev-parse --short "$ANTES")) y el foro responde."
  rojo 'Cópiame las líneas de arriba: ahí está el motivo del fallo de la versión nueva.'
  exit 1
fi
abortar 'Ni la versión nueva ni la anterior responden. Cópiame todo lo de arriba.'
