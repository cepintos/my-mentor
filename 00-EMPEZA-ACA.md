# 00 — Empezá acá

## Qué es esto

Un entorno *code-first*: aprendés escribiendo código y evidencia reales, con un mentor que enseña y
revisa pero no resuelve por vos. Este repositorio trae el motor (dashboard, Biblioteca de conceptos,
Chispa y module-builder) y ningún curso: el curso lo creás vos, para lo que quieras aprender.

## Primera sesión

1. Comprobá que `node --version` sea **22.11 o superior**. `.nvmrc` fija la versión recomendada; si
   tu gestor de versiones lo soporta, seleccionala explícitamente. No hace falta `npm install`: el
   core no tiene dependencias.
2. Iniciá el dashboard:

   ```bash
   npm run dashboard
   ```

   Queda en `http://127.0.0.1:4173`, sólo en tu máquina.
3. Tocá **Diagnosticar entorno**. Muestra qué está listo (Node, git, tu agente, Chispa) y no instala
   nada.
4. Elegí tu agente de review: copiá `mentor.config.example.json` a `mentor.config.json` y poné en
   `active` el que uses. Detalle en [cómo usar el mentor](04-COMO-USAR-EL-MENTOR.md).
5. Creá tu curso: abrí tu agente en esta carpeta y pedí `/module-builder` (Claude Code) o
   `$module-builder` (Codex). Te entrevista, arma un currículo y, cuando lo aprobás, escribe los
   módulos. El dashboard los muestra apenas existen. Detalle en [crear módulos](06-CREAR-MODULOS.md).

## Cómo están escritos los documentos

Cada concepto va del problema a un modelo mínimo, después al mecanismo real y recién al final a la
terminología. Leé [cómo enseña](01-COMO-ENSENA.md) una vez antes de tu primera etapa. module-builder
escribe los módulos con ese mismo método.

## Una sesión pequeña

Elegí un concepto, un cambio y una comprobación. El plan de cada módulo sirve para elegir ese
incremento. Podés detenerte con la etapa en curso; no hace falta pedir review ni completar toda la
batería en cada sesión. Conservá la salida del dashboard y una nota breve sólo cuando aporte
evidencia que no esté ya registrada.

## Flujo normal

La tarjeta **Tu próximo paso** del dashboard te dice en qué fase estás y qué hacer ahora:

1. **Entender:** leé los documentos de la etapa en orden y marcalos como leídos (al pie de cada uno
   o en el dashboard).
2. **Hacer:** completá los archivos del laboratorio. El dashboard muestra cuáles faltan y se
   actualiza al guardar. El código va en el entregable que declara la etapa; corré las herramientas
   del curso desde **Herramientas**.
3. **Comprobar:** cuando no queden marcadores, usá **Validar evidencia** y marcá los criterios que tu
   evidencia cumple.
4. **Cerrar:** pedí el review con **Pedir review al mentor** (el dashboard le pasa
   `11-PROMPT-DE-REVIEW.md` al agente que configuraste) o pegá ese archivo en la herramienta que
   prefieras. Marcá Pass o Fail y completá la etapa.

Si te trabás en cualquier fase, preguntale a [Chispa](05-CHISPA.md) en el panel lateral: ve tu
progreso real, recuerda errores anteriores y te da pistas sin resolver el laboratorio.

Después de iniciar el dashboard no necesitás copiar comandos. Las acciones son botones de una lista
cerrada: las del core y las que declara tu curso en `course/catalog.json`. Ninguna acepta una shell
arbitraria.

No existen `setup`, worklogs ni checkpoints burocráticos. El doctor es sólo diagnóstico: no instala
ni limpia herramientas por su cuenta.
