# My Mentor

Un mentor local para aprender escribiendo código real. Vos elegís qué aprender; el mentor arma el
curso con vos, te acompaña etapa por etapa y revisa tu trabajo contra criterios, sin resolverlo por
vos.

- **Dashboard local:** cada etapa en cuatro fases, *Entender → Hacer → Comprobar → Cerrar*, con un
  solo próximo paso y acciones de una lista cerrada. Sin terminal libre.
- **Biblioteca de conceptos:** lector de Markdown en otra pestaña, para estudiar sin internet.
- **Chispa ⚡:** companion del panel lateral con memoria y recordatorios. Ve tu progreso real y te da
  pistas sin resolver el laboratorio.
- **module-builder:** skill que diseña tus módulos (objetivos, prerrequisitos, auditoría E→F) y los
  escribe recién cuando aprobás el currículo.
- **Cualquier agente:** el review lo hace el CLI que elijas en `mentor.config.json`, o ninguno.

Este repositorio es el *core*: no trae módulos. El curso es tuyo y vive en `course/`.

## Empezar

Requisito: Node 22.11 o superior (la versión recomendada está en `.nvmrc`). No hay dependencias que
instalar. Para Chispa hace falta [Claude Code](https://code.claude.com) con sesión iniciada; el resto
funciona sin él.

```bash
npm run dashboard
```

Abrí `http://127.0.0.1:4173` y seguí [00-EMPEZA-ACA.md](00-EMPEZA-ACA.md).

## Guía

| Documento | Para qué |
| --- | --- |
| [00 · Empezá acá](00-EMPEZA-ACA.md) | primera sesión y flujo de una etapa |
| [01 · Cómo enseña](01-COMO-ENSENA.md) | el método: problema, modelo mínimo, mecanismo, término |
| [02 · Mapa del repo](02-MAPA-DEL-REPO.md) | qué es del core y qué es tuyo |
| [03 · Dashboard](03-DASHBOARD.md) | pantalla, fases, acciones y límites de seguridad |
| [04 · Cómo usar el mentor](04-COMO-USAR-EL-MENTOR.md) | elegir el agente de review y prompts útiles |
| [05 · Chispa](05-CHISPA.md) | companion: permisos, memoria y recordatorios |
| [06 · Crear módulos](06-CREAR-MODULOS.md) | module-builder, formato del curso y comandos |
| [07 · Actualizar el core](07-ACTUALIZAR-EL-CORE.md) | traer versiones nuevas sin tocar tu curso |
| [08 · Qué publicar](08-QUE-PUBLICAR.md) | qué podés mostrar de lo que hiciste |

Las reglas para cualquier agente que haga de mentor están en [AGENTS.md](AGENTS.md). Los cambios de
cada versión, en [CHANGELOG.md](CHANGELOG.md).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dashboard` | inicia el dashboard en `127.0.0.1:4173` (`-- --no-open` para no abrir el navegador) |
| `npm run doctor` | diagnóstico de sólo lectura del entorno y de las herramientas del curso |
| `npm run check` | valida el curso y el core |
| `npm run course -- list\|show\|start\|review\|done\|reset\|status` | el curso desde la terminal |
| `npm run course:check -- <ID>` | valida la evidencia de una etapa |

## Licencia

MIT. Ver [LICENSE](LICENSE).
