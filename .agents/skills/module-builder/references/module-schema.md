# Course and module schema for My Mentor

Source of truth: `scripts/lib.mjs` (loader), `scripts/commands.mjs` (commands and doctor tools), `scripts/check.mjs` (repository rules) and `scripts/course-check.mjs` (check kinds). Re-read them if this file seems out of date.

## Location and naming

- `course/<track>/<ID>-<slug>/module.json`. The directory name must equal `${id}-${slug}`.
- `<track>` is a key of `tracks` in `course/catalog.json`: lowercase letters, digits and hyphens.
- `id` is one uppercase letter and two digits (`P00`). Use one letter per track. IDs are unique across the catalog.
- `slug` is kebab-case. `order` (or `recommendedOrder`) is a number, unique inside its track.

## course/catalog.json

```json
{
  "version": 2,
  "title": "Mi curso",
  "tracks": {
    "python": {"title": "Python desde JavaScript", "description": "Qué cubre el track."}
  },
  "defaultRoute": "complete",
  "routes": [
    {"id": "complete", "title": "Recorrido completo", "description": "Todas las etapas.", "modules": ["P00", "P01"]}
  ],
  "commands": {
    "pytest-etapa": {
      "label": "Correr los tests de la etapa",
      "description": "pytest sobre el entregable de la etapa.",
      "command": "python3",
      "args": ["-m", "pytest", "{deliverable}"]
    }
  },
  "doctor": [
    {"name": "Python 3.12 o superior", "command": "python3", "args": ["--version"], "versionPattern": "Python (\\d+\\.\\d+)", "min": "3.12", "hint": "Instalá Python 3.12 o superior."}
  ]
}
```

- `tracks`: every track needs `title`; `description` is shown in the dashboard. A directory under `course/` with modules but no track entry fails `npm run check`.
- `routes` is optional. Without it, the engine builds `complete` with every module in dependency order. With it, `defaultRoute` must name one of them, every route must be dependency-closed and in order (`dashboard/course-routes.mjs` → `validateRoutes`), and `complete` must contain every module.
- `commands`: what the dashboard and `command` checks may run. The browser only sends the id.

| Field | Required | Meaning |
| --- | --- | --- |
| `command` | yes | a program on `PATH` (`python3`, `node`, `cargo`) or a file inside the repo (`learning-labs/x/run.sh`). Never an absolute path, spaces or shell symbols |
| `args` | no | fixed list of strings. `{module}` becomes the stage id and `{deliverable}` its deliverable (only when it is one path inside the repo). Either one makes the command stage-bound |
| `cwd` | no | directory inside the repo where it runs; default the root |
| `label`, `description` | no | how the button looks |
| `group` | no | `quality`, `course` (default) or `maintenance` |
| `long` | no | `true` when it takes minutes |
| `confirmation` | no | text the learner must confirm before it runs (use it for anything that deletes or rewrites) |
| `platforms` | no | subset of `darwin`, `linux`, `win32` |
| `resources` | no | commands that share a resource never run at the same time; default `["workspace"]`, shared with `check` and `course-check` |

  Ids use lowercase letters, digits and hyphens and cannot reuse a core id (`doctor`, `check`, `course-check`, `mentor-explain`, `mentor-next`, `mentor-review`).

- `doctor`: tools that **Diagnosticar entorno** checks. `name` (no `:`), `command`, `args` (default `["--version"]`), `versionPattern` (a regular expression whose first group is the version), `min`, `required` (default `true`; `false` turns a failure into a warning) and `hint` (what to do when it fails). The doctor also looks up every program that `commands` uses.

## module.json

```json
{
  "id": "P00",
  "track": "python",
  "order": 0,
  "slug": "short-kebab-slug",
  "title": "Título corto",
  "fullDocumentation": true,
  "scaffold": 5,
  "depends": [],
  "deliverable": "learning-labs/python/P00",
  "question": "Pregunta central del módulo",
  "goal": "Capacidad demostrable al terminar.",
  "product": "Por qué importa para el objetivo final.",
  "concepts": ["…"],
  "facts": ["Dato corto y comprobable sobre la etapa."],
  "languages": ["…"],
  "flow": ["…"],
  "milestones": ["…"],
  "criteria": ["Criterio verificable 1", "…"],
  "tests": ["…"],
  "failures": ["…"],
  "sources": [["Título", "https://…"]],
  "recommendedCommands": ["pytest-etapa"],
  "checks": [
    {"kind": "file", "path": "learning-labs/python/P00/notas.md", "not": ["TODO_LEARNER"]},
    {"kind": "command", "command": "pytest-etapa", "label": "Los tests de la etapa pasan"}
  ]
}
```

- Required by the loader: `id`, `slug`, `title`, `track`, `order`, and the lists `depends`, `criteria` and `checks`. A module.json that breaks this stops the dashboard with a message that names the file.
- `scaffold`: 5 = maximum guidance, 0 = none. Decrease it as the learner advances (at most one level per module). Docs must match the density table in `local-docs.md`.
- `depends`: IDs that must be `done` first. They encode the prerequisite graph; keep them minimal and real.
- `criteria`: become AC1…ACn. Copy each string **verbatim** into `07-CRITERIOS-DE-ACEPTACION.md` (`npm run check` compares them).
- `reading` (optional): the docs of the Entender phase, in order. Default: `00-EMPEZA-ACA.md`, `01-BRIEF.md`, `13-ANATOMIA-DEL-ECOSISTEMA.md`, `02-CONCEPTOS.md`, `12-GUIA-WEB.md` (only the ones the module has).
- `facts` (optional): one to three short, checkable curiosities about the stage, up to 300 characters each. Chispa tells one when the learner taps her; without facts she tells a joke. Anything else stops the loader.
- `recommendedCommands`: ids that exist as core commands or in `commands`. Never invent commands.
- `checks` kinds:
  - `file` / `contains`: `path`, with `not`, `contains` and `minBytes`. The file must exist as a template.
  - `jsonkey`: `path` and a dotted `key` that must be present.
  - `glob`: `path` pattern and `min` matches.
  - `command`: `doctor` or a course command id. A command that reports skipped tests counts as SKIP, not PASS.
  - `manual`: never passes by itself; mark it `"required": false` and cover what it asks with a criterion.

## Numbered docs (all required)

| File | Content |
| --- | --- |
| `00-EMPEZA-ACA.md` | dependencies, central question, why the module exists, route |
| `01-BRIEF.md` | mission, deliverables, restrictions, definition of done |
| `02-CONCEPTOS.md` | concepts, each built only on earlier modules, linking reference pages |
| `03-GUIA-DE-LENGUAJE.md` | how to read the languages and outputs used |
| `04-ARQUITECTURA.md` | diagram and real files to observe |
| `05-EJEMPLOS.md` | small examples not copyable into the deliverable |
| `06-PLAN-DE-IMPLEMENTACION.md` | one verifiable step at a time |
| `07-CRITERIOS-DE-ACEPTACION.md` | `- [ ] ACn — <criterion verbatim>` |
| `08-PLAN-DE-PRUEBAS.md` | cases and expected results |
| `09-FALLOS-COMUNES.md` | symptom / evidence / interpretation / minimal fix |
| `10-FUENTES.md` | optional sources |
| `11-PROMPT-DE-REVIEW.md` | read-only review prompt, BLOCKER/MAJOR/MINOR/SUGGESTION, PASS rule, and the closing question "¿Qué de este módulo es publicable?" pointing to `08-QUE-PUBLICAR.md` |
| `12-GUIA-WEB.md` | self-contained guide; required when `fullDocumentation` is true |
| `13-ANATOMIA-DEL-ECOSISTEMA.md` | optional: which real tools and files take part, and who calls whom |

Concept explanations live in the track's reference library (`course/<track>/referencia/`, see `local-docs.md`); numbered docs link to those pages instead of depending on external URLs. Every relative link must open a real file: `npm run check` fails on broken local links.

## Lab templates

Every file referenced by a `file` or `contains` check exists, starts with a title and contains `TODO_LEARNER`, so the check stays red until the learner writes real evidence.

## Learner profile — course/00-PERFIL.md

Free Markdown that every mentor reads before teaching. Suggested sections:

```markdown
# Perfil

## Qué sé
## Qué quiero poder hacer
## Idioma, tiempo y equipo
```

Write only what the learner confirmed; never personal data they did not offer.

## After generating

Run `npm run check`. It validates the catalog, routes, IDs, dependencies, numbered docs, verbatim criteria, lab templates, commands, doctor tools and local links, and runs the core's tests. Report its real output.
