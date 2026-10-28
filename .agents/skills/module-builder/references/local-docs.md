# Local documentation: reference library and progressive density

Goal: a learner with no internet access can complete every module. Online sources only extend what is already explained locally.

## 1. Two layers

| Layer | Where | What it contains | Does it shrink? |
| --- | --- | --- | --- |
| **Reference library** | `course/<track>/referencia/*.md` | one complete page per concept: what it is, why it exists, syntax, examples, mistakes | **No.** It only grows |
| **Module docs** | `course/<track>/<ID>-<slug>/00–12` | mission, plan, guide, criteria; link to reference pages | **Yes.** Guidance decreases with `scaffold` |

Module docs never duplicate a full concept explanation: they link to it (`[let y const](../referencia/let-y-const.md)`). The dashboard opens these links in its document viewer.

## 2. Reference page template

File: `course/<track>/referencia/<concept-slug>.md`. Write it in the learner's language and in your own words.

```markdown
# <Concepto>

**Prerrequisitos:** [<concepto previo>](<slug>.md) · **Se usa por primera vez en:** <ID>

## Qué es
Una o dos frases sin jerga nueva. Si aparece un término nuevo, enlazá su página o definilo acá mismo.

## Por qué existe
Qué problema resuelve; qué pasaría sin él.

## Sintaxis mínima
El bloque más chico posible, anotado línea por línea.

## Ejemplos
2 a 4 ejemplos pequeños y ejecutables, de lo trivial a lo realista. Para cada uno: código, salida esperada y qué demuestra.

## Comparación
Con conceptos parecidos que confunden (p. ej. `let` vs `const` vs `var`), en una tabla.

## Errores comunes
Síntoma (mensaje real del compilador o runtime) → causa → corrección.

## Comprobá que lo entendiste
2 o 3 preguntas de predicción ("¿qué imprime?"), numeradas.

## Respuestas
Respuestas a las preguntas anteriores, al final de la página (el visor del dashboard no pliega `<details>`).

## Para ampliar (opcional)
Enlaces oficiales. Nada de esta sección es necesario para seguir.
```

Pages are written only for concepts the learner does not already master (see SKILL.md, rule 5). For known concepts, write a **bridge page**: same template, but every section covers only what changes in the new context.

Example size, for a learner who starts from zero: `let-y-const.md` should explain declaration, assignment, reassignment versus mutation (`const obj` can still be mutated), block scope, temporal dead zone, why `var` is avoided, and the exact `TypeError: Assignment to constant variable.` message.

`referencia/00-INDICE.md` lists every page grouped by theme, with the module that introduces it.

## 3. Density by scaffold level

| `scaffold` | Reference pages | `12-GUIA-WEB.md` | `06-PLAN` | `05-EJEMPLOS` | Hints |
| --- | --- | --- | --- | --- | --- |
| **5** | a full page for **every** concept used, including ones that seem obvious | long guided walkthrough that links each concept as it appears | micro-steps (one change, one check) | worked examples close to the task | expected result after each step |
| **4** | pages for new concepts; known ones linked | full guide focused on what is new | small steps | worked examples one level more abstract | hints per step |
| **3** | pages for new concepts | guide covering only new mechanisms | steps grouped by milestone | partial examples | hints only for the hard parts |
| **2** | concise pages for new concepts | map and decisions, not a walkthrough | goals per milestone | one contrasting example | hints on request (mentor button) |
| **1** | pages only for genuinely new concepts | short orientation + links to reference | final goal + constraints | none (point to the reference) | none |
| **0** | none new unless required | brief only | acceptance criteria only | none | none |

Invariants:

- A track that teaches from zero starts at 5 and decreases at most one level per module.
- The decrease affects **how much the module guides**, never **whether a concept is explained**: even at level 0, every concept used has a local page from an earlier module.
- `10-FUENTES.md` is always optional reading.

## 4. Writing rules

- Introduce one new term at a time; define it before using it.
- Prefer a runnable example over a paragraph.
- Show real error messages, copied from an actual run when possible.
- No forward references ("lo vas a ver más adelante") for anything required now.
- Do not copy external text; paraphrase and cite in "Para ampliar".
- Every page must pass the E→F test: it may only rely on concepts whose pages are listed in its *Prerrequisitos*.
