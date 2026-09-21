# Instrucciones para cualquier asistente de código

Este proyecto es el foro vecinal de **Vereda de los Estudiantes (Leganés)**, en
producción en `veredadelosestudiantes.es` y usado por vecinos reales.

**Lee `CLAUDE.md` antes de tocar nada.** Es el manual del proyecto: cómo está
montado, las trampas que ya han costado horas y las decisiones del dueño que no
se cambian. Este fichero solo repite lo que no se puede saltar nadie.

---

## Antes de dar algo por bueno

```bash
npm test          # 57 pruebas, base de datos en memoria
npm run rastreo   # recorre todas las páginas con 3 perfiles
```

Las dos cosas, siempre. El rastreo pilla las plantillas rotas, que las pruebas
no ven. Si alguna falla, no está terminado.

## Lo que no se cambia sin preguntar al dueño

1. **Apellidos y teléfonos nunca son públicos.** En pantalla se ve «Nombre I.».
2. **`data/` son datos personales de vecinos.** No se sube al repositorio, no se
   comparte y no sale en capturas ni en ejemplos.
3. **Facebook se publica siempre a mano**, nunca de forma automática.
4. **El pie dice que el foro no es un canal oficial del Ayuntamiento.** No se quita.
5. **Estado del barrio e Informe son privados**, solo para la moderación.
6. **Interfaz y comentarios del código, en castellano**, incluidos los nombres de
   variables nuevas. El dueño lee el código y no es programador.

## Cómo se pone en producción

```bash
# en el servidor
cd /opt/foro && bash scripts/actualizar.sh
```

Ese script hace copia de seguridad, actualiza, comprueba que la web responde de
verdad y **vuelve a la versión anterior si algo falla**. No actualices a mano con
`git pull` y `docker compose up`: te saltas la red de seguridad.

## Secretos

Las claves (`CORREO_CLAVE`, `SESSION_SECRET`, tokens) viven solo en el `.env` del
servidor. Nunca se escriben en el repositorio, ni en un commit, ni en un chat.
El correo se configura con `bash scripts/correo.sh`, que además lo comprueba
enviando un mensaje de prueba.

## Cómo hablarle al dueño

No es programador. Explícale las cosas por lo que hacen, no por cómo están
hechas, y en castellano. Si algo no funciona o no se ha podido comprobar, díselo
claramente en vez de suavizarlo.
