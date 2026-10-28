# Cambios

Cada versión dice qué cambió en el core y si hay que ajustar algo del curso. Cómo traer una versión
nueva: [07-ACTUALIZAR-EL-CORE.md](07-ACTUALIZAR-EL-CORE.md).

## 0.2.0 — 2026-10-28

- Chispa propone cambios puntuales en los documentos de tu curso (`cambio_proponer`). Cada
  propuesta muestra el antes y el después, y sólo se aplica cuando tocás **Aplicar**. Nunca toca la
  guía del mentor, el laboratorio ni el código.
- La Biblioteca de conceptos se abre en la misma pestaña, encima del dashboard: **← Dashboard** o
  `D` vuelve. El documento abierto se actualiza solo cuando cambia en disco.
- La Biblioteca marca con ✓ los documentos leídos y con un punto rojo el próximo de tu etapa.
- El watcher avisa cada archivo que cambió, aunque varios cambien juntos.
- El README empieza por el paso para clonar, y la guía de actualización trae la URL real del core.

No hace falta tocar el curso.

## 0.1.0 — 2026-10-28

Primera versión del core, sin módulos.

- Dashboard local con las cuatro fases por etapa, un único próximo paso y acciones de lista cerrada.
- Pantalla de inicio mientras el curso está vacío: primeros pasos, guía del mentor y acciones globales.
- Biblioteca de conceptos: lector de Markdown con la guía del mentor, el material de cada etapa y la
  referencia de cada track.
- Chispa: chat con memoria aprobada por quien estudia, recordatorios y servidor MCP de sólo lectura.
- module-builder: diseño de currículo con auditoría E→F y perfil de quien estudia.
- Comandos y herramientas del doctor declarados por cada curso en `course/catalog.json`.
- `npm run check`: catálogo, recorridos, documentos, criterios, plantillas, comandos, links locales y
  pruebas del core.
