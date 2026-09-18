#!/usr/bin/env bash
#
# Copia de seguridad del foro: la base de datos y las fotos de los vecinos.
#
# Deja un .tar.gz con la fecha en /var/backups/foro y conserva los últimos 30
# días. La base de datos se copia con la propia SQLite (VACUUM INTO) mientras el
# foro sigue funcionando, así que la copia es consistente aunque alguien esté
# publicando en ese momento.
#
# Uso, en el servidor:  bash scripts/copia.sh
# El instalador lo deja programado cada noche a las 4:00.

set -euo pipefail
cd "$(dirname "$0")/.."

DESTINO="${DESTINO_COPIAS:-/var/backups/foro}"
FECHA="$(date +%F)"
FICHERO="$DESTINO/foro-$FECHA.tar.gz"
TEMPORAL='copia-en-curso.sqlite'

mkdir -p "$DESTINO"
rm -f "data/$TEMPORAL"

# 1) La base de datos. Si el foro está en marcha, SQLite escribe una copia
#    consistente desde dentro del contenedor; si no, se copia el fichero tal cual.
if docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -qE '^foro +running'; then
  docker compose exec -T foro node --disable-warning=ExperimentalWarning --input-type=module -e "
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync('/data/foro.sqlite');
    db.exec(\"VACUUM INTO '/data/$TEMPORAL'\");
    db.close();
  "
else
  echo 'Aviso: el foro no está en marcha; copio la base de datos tal cual está en el disco.'
  cp data/foro.sqlite "data/$TEMPORAL"
fi

# 2) Base de datos + fotos, en un solo paquete.
CONTENIDO=("$TEMPORAL")
[ -d data/uploads ] && CONTENIDO+=('uploads')
tar czf "$FICHERO" -C data "${CONTENIDO[@]}"
rm -f "data/$TEMPORAL"

# 3) Se conservan 30 días.
find "$DESTINO" -name 'foro-*.tar.gz' -mtime +30 -delete

echo "Copia guardada: $FICHERO ($(du -h "$FICHERO" | cut -f1))"
