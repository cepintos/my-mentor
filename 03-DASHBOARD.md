# 03 — Dashboard local

`npm run dashboard` sirve una UI en `http://127.0.0.1:4173`. Escucha sólo en tu máquina.

## Pantalla

Una sola acción principal por momento.

- **Recorrido:** la fila de etapas del recorrido elegido. Un nodo punteado está bloqueado y su
  tooltip dice qué falta.
- **Etapa:** la pregunta central, las cuatro fases `Entender → Hacer → Comprobar → Cerrar` con su
  avance real y la tarjeta **Tu próximo paso**: qué hacer ahora, por qué y un único botón.
- **Pestañas:** *Recorrido* (las cuatro fases desplegables), *Material* (documentos numerados y
  notas; todo se abre en la Biblioteca de conceptos) y *Herramientas* (las acciones que recomienda
  la etapa; el resto plegado).
- **Biblioteca de conceptos:** se abre en esta misma pestaña, encima del dashboard, que sigue vivo
  debajo. **← Dashboard** o la tecla `D` vuelve. Marca con ✓ lo que ya leíste y con un punto rojo
  el próximo documento de tu etapa. Si el documento abierto cambia en disco, se actualiza solo. Con
  Cmd o Ctrl, un enlace se abre en otra pestaña, como siempre.
- **Columna lateral:** [Chispa](05-CHISPA.md), la ejecución en vivo, "Para revisar" (sólo checks y
  reviews reales) y la actividad reciente.

## Sin curso todavía

Mientras no haya módulos, la página muestra los primeros pasos, la guía del mentor y las acciones
que no necesitan una etapa: **Diagnosticar entorno** y **Validar repositorio**. Chispa ya conversa.
Las etapas aparecen solas apenas module-builder las escribe: no hace falta reiniciar.

## Las cuatro fases

| Fase | Qué muestra | De dónde sale | Próximo paso típico |
| --- | --- | --- | --- |
| Entender | `00`, `01`, `13`, `02`, `12` en ese orden (o `reading` del `module.json`) | lo que marcaste como leído | abrir el siguiente documento sin leer |
| Hacer | cada archivo del laboratorio con su estado actual | el mismo check estático de `course:check`, leído al guardar | abrir el archivo pendiente en tu editor (o copiar su ruta) |
| Comprobar | último check, checks ejecutables y criterios | `course-state.json` | validar evidencia; después marcar criterios |
| Cerrar | resultado del review | `course-state.json` | pedir el review; marcar Pass o Fail; completar |

Que un archivo esté en verde en Hacer sólo dice que no quedan marcadores `TODO_LEARNER`. Lo que
cuenta para cerrar es el check registrado, los criterios y el review, y los tres tienen que
corresponder a los archivos actuales: si cambiás un archivo después del check, el check queda
desactualizado y hay que volver a validar.

## Acciones

| De dónde vienen | Cuáles |
| --- | --- |
| el core | Diagnosticar entorno, Validar repositorio, Validar esta etapa y los botones del mentor (explicar, próximo paso, review final) |
| tu curso | los comandos que declara `course/catalog.json` en `commands` ([crear módulos](06-CREAR-MODULOS.md)) |

Cada botón conserva salida y estado en la columna de ejecución. Un comando que comparte recurso con
otro en curso espera a que termine o se detiene a mano.

## Límites de seguridad

- Escucha únicamente en `127.0.0.1` y valida `Host`, `Origin` y `Content-Type` en cada escritura.
- El navegador sólo envía identificadores: nunca texto de shell, ejecutables, argumentos ni rutas.
  Todo proceso corre con `shell: false`.
- Los argumentos de un comando del curso salen de `course/catalog.json`; `{module}` y
  `{deliverable}` se completan desde el catálogo, nunca desde un pedido.
- La única entrada libre es el mensaje a Chispa: hasta 4000 caracteres, un turno a la vez, a un
  ejecutable y argumentos fijos.
- **Abrir en …** lanza el editor de `mentor.config.json` con una ruta que declara el `module.json`.
- El agente de review corre con el ejecutable y los argumentos de `mentor.config.json`. El dashboard
  no puede imponerle un sandbox a un programa ajeno: elegí flags de sólo lectura.

Detalle técnico (flujo, endpoints y pruebas) en `dashboard/README.md`.
