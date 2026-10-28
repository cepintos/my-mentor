# Dashboard: arquitectura

Para quien estudia, la guía es [03-DASHBOARD.md](../03-DASHBOARD.md). Este documento es para quien
mantiene el core.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `tools/dashboard-server.mjs` | servidor HTTP en `127.0.0.1`: API, acciones, Chispa y watcher de archivos |
| `dashboard/index.html`, `app.js`, `styles.css` | la UI del dashboard, sin dependencias |
| `dashboard/reader.html`, `reader.js` | la Biblioteca de conceptos, en un iframe encima del dashboard |
| `dashboard/markdown.js` | renderer de Markdown compartido por los dos |
| `dashboard/course-routes.mjs` | recorridos: selección, progreso, próxima etapa y validación |
| `scripts/lib.mjs` | carga del catálogo y del progreso, evidencia y condiciones de cierre |
| `scripts/commands.mjs` | agente, editor, comandos y doctor: de configuración a proceso |

## Flujo de una acción

```text
botón de la UI
  → POST /api/run con commandId + moduleId (+ confirmation)
  → acción del core o comando de course/catalog.json
  → argumentos, carpeta y contexto resueltos en el servidor
  → proceso con shell: false
  → eventos en vivo (SSE)
  → resultado y log en la UI; el log queda en .course/runs/
```

Para el review, el navegador nunca envía una ruta ni un prompt. Envía un identificador de acción y
el módulo; el servidor valida ambos contra el catálogo, construye la ruta dentro del repo, arma el
prompt con el documento y el perfil incluidos y se lo pasa al agente de `mentor.config.json`.

## Endpoints

| Método y ruta | Qué devuelve o hace |
| --- | --- |
| `GET /api/course` | catálogo con estado por etapa, acciones disponibles, entorno y capacidades |
| `GET /api/events` | Server-Sent Events: `course`, `run`, `change`, `chispa` |
| `POST /api/module` | `start`, `criterion`, `review`, `read`, `notes`, `done` sobre una etapa |
| `POST /api/run`, `GET /api/run/:id`, `POST /api/run/:id/stop` | acciones de la lista cerrada |
| `POST /api/open` | abre un archivo del laboratorio en el editor configurado |
| `GET /api/library`, `GET /api/doc`, `GET /api/reading` | la Biblioteca de conceptos, su allowlist y la lectura de cada etapa |
| `GET /api/chispa`, `POST /api/chispa`, `POST /api/chispa/stop`, `POST /api/chispa/memory`, `POST /api/chispa/edit` | Chispa |

`/api/doc` sirve sólo documentos numerados (de la raíz, de `course/`, de cada track y de cada
etapa) y las páginas planas de `course/<track>/referencia/`. README, AGENTS.md, JSON y código quedan
afuera.

`POST /api/chispa/edit` es la única ruta que cambia un documento: aplica o descarta un cambio que
Chispa propuso. Antes de escribir vuelve a comprobar que el documento está en `course/`, que la
Biblioteca lo sirve y que el texto a reemplazar aparece una sola vez.

## Cambios en vivo

El servidor observa el repo con `fs.watch` y anuncia por SSE cada archivo que cambió, uno por ruta
aunque varios cambien juntos; la página vuelve a pedir el estado. Así Hacer muestra los archivos
como están y las etapas nuevas aparecen sin reiniciar. La Biblioteca vuelve a dibujar el documento
abierto si es uno de ellos, sin perder la posición. Si un archivo de evidencia cambió después de un
check o un review, el servidor los marca como desactualizados. Un cambio nunca ejecuta comandos por
sí solo, y un archivo del curso con JSON inválido sólo deja un aviso en la consola. El watcher
ignora la misma lista de carpetas que la evidencia (`IGNORED_NAMES` en `scripts/lib.mjs`): `.git`,
`.course`, `.companion`, dependencias, caches y salidas de build. También ignora los temporales de
las escrituras atómicas (`<archivo>.<pid>.tmp`).

## Pruebas

`node --test scripts/tests/*.test.mjs` corre las pruebas del core, también incluidas en
`npm run check`. Cada una trabaja sobre una copia temporal del core con un curso de prueba propio y
un puerto efímero en `127.0.0.1`: no toca tu curso ni tu progreso, y usa un Claude falso
(`scripts/tests/fixtures/fake-claude.mjs`) para Chispa.

Los checks de archivos son filtros estructurales: no demuestran comportamiento. Los comandos
ejecutables, la evidencia manual y el review conservan roles separados.
