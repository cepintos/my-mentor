# 06 — Crear tu curso con module-builder

El core no trae módulos: el curso lo diseñás con **module-builder**, un skill que corre en tu agente
(Claude Code, Codex u otro que lea `.agents/skills/`). No es un generador de cursos sino un
arquitecto de currículo: antes de escribir nada comprueba que cada etapa te dé todo lo que necesita
la siguiente.

## Cómo se usa

1. Abrí tu agente en la carpeta del repo.
2. Pedí `/module-builder` (Claude Code) o `$module-builder` (Codex).
3. Respondé de a poco. Te pregunta qué querés aprender, qué querés poder **hacer**, qué ya sabés y
   cuánto tiempo tenés.
4. Revisá la propuesta: objetivos, currículo, grafo de prerrequisitos, proyecto final y la tabla de
   auto-desafíos E→F (si la etapa E no alcanza para entender F, el builder repara E antes de seguir).
5. Aprobala, o pedí cambios. **Recién con tu aprobación** escribe archivos.
6. El builder corre `npm run check` y te muestra la salida real. El dashboard ya muestra las etapas.

Podés volver a usarlo para agregar un track, sumar etapas o reescribir una que no funcionó.

## Qué escribe

| Archivo | Qué es |
| --- | --- |
| `course/00-PERFIL.md` | qué sabés, qué querés poder hacer, tu idioma y tu tiempo; todos los mentores lo leen |
| `course/catalog.json` | tracks, recorridos, comandos y herramientas del doctor |
| `course/<track>/<ID>-<slug>/module.json` | la etapa: pregunta, objetivo, dependencias, criterios y checks |
| `course/<track>/<ID>-<slug>/00…12-*.md` | los documentos numerados de la etapa |
| `course/<track>/referencia/*.md` | una página por concepto, para estudiar sin internet |
| `learning-labs/<track>/<ID>/…` | plantillas del laboratorio con `TODO_LEARNER` |

Los IDs son una letra mayúscula y dos dígitos (`P00`, `P01`…), con una letra por track. El formato
completo está en `.agents/skills/module-builder/references/module-schema.md`.

## Comandos del curso

El core sólo trae las acciones generales. Lo que tu curso necesita correr (tests, un intérprete, un
build) se declara en `course/catalog.json`, y aparece como botón en **Herramientas** y como check
ejecutable de una etapa:

```json
{
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

| Campo de `commands` | Qué hace |
| --- | --- |
| `command` | un programa del `PATH` (`python3`) o un archivo del repo (`learning-labs/x/run.sh`); nunca una ruta absoluta |
| `args` | lista fija; `{module}` y `{deliverable}` se completan con la etapa elegida |
| `cwd` | carpeta del repo donde corre (por defecto, la raíz) |
| `label`, `description`, `group` | cómo se muestra; `group` es `quality`, `course` o `maintenance` |
| `long`, `confirmation`, `platforms`, `resources` | si tarda, si pide confirmación, en qué sistemas corre y con qué otros comandos no puede correr a la vez |

`doctor` es la lista de herramientas que **Diagnosticar entorno** comprueba: el programa, cómo pedir
su versión y la mínima. El doctor además busca cada programa que usan tus comandos.

Si tu curso necesita dependencias de npm, pip u otro gestor, ponelas en el laboratorio (por ejemplo
`learning-labs/<track>/package.json`) y usá `cwd`. El `package.json` de la raíz es del core.

Un comando del curso corre con tus permisos, como cualquier script de un repo que clonás: leé
`commands` antes de usar un curso que no escribiste vos.

## Editar a mano

Todo es Markdown y JSON. Podés corregir un documento, agregar un criterio o cambiar un comando sin
module-builder. Después corré:

```bash
npm run check
```

Revisa catálogo, recorridos, documentos numerados, criterios copiados textualmente en `07`,
plantillas del laboratorio, comandos, links locales y las pruebas del core.
