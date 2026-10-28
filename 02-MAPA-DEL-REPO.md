# 02 — Mapa del repo

El repositorio tiene dos partes que nunca se mezclan: el **core**, que es el motor y llega con cada
actualización, y **tu curso**, que es tuyo y el core nunca toca.

```text
core
  00-…08-*.md          guía del mentor (la abre la Biblioteca de conceptos)
  AGENTS.md            reglas de cualquier agente que haga de mentor; CLAUDE.md la importa
  dashboard/           UI local sin dependencias: dashboard y Biblioteca de conceptos
  tools/               servidor del dashboard (127.0.0.1, lista cerrada de acciones)
  scripts/             curso por terminal, validación de etapas, doctor, check y pruebas del core
  companion/           Chispa: persona, memoria, recordatorios y servidor MCP de sólo lectura
  .agents/skills/      module-builder (enlazado desde .claude/skills/)

tu curso
  course/catalog.json  tracks, recorridos, comandos y herramientas del doctor
  course/00-PERFIL.md  qué sabés y qué querés poder hacer
  course/<track>/      módulos numerados y la referencia local de cada track
  learning-labs/       tus laboratorios (convención: cada módulo declara su entregable)

local, fuera de git
  course-state.json    tu progreso: lecturas, checks, criterios y reviews
  mentor.config.json   tu agente, tu editor y la configuración de Chispa
  .companion/          memoria, charlas y recordatorios de Chispa
  .course/             logs de las ejecuciones del dashboard
  private/             notas privadas: ni git ni Chispa las leen
```

`course/` no existe hasta que module-builder escribe el primer módulo. Mientras tanto el dashboard
muestra los primeros pasos y el resto del core funciona igual.

Cómo traer actualizaciones del core sin tocar tu curso: [07-ACTUALIZAR-EL-CORE.md](07-ACTUALIZAR-EL-CORE.md).
