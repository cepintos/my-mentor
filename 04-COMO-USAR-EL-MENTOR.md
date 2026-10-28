# 04 — El mentor: maestro y reviewer con el agente que elijas

El repositorio no depende de ningún proveedor de IA. El mentor es cualquier agente o modelo que vos
elijas; también podés trabajar sin ninguno y usar los prompts de abajo en la herramienta que
prefieras.

En el dashboard conviven dos papeles:

- **[Chispa](05-CHISPA.md)**, el companion del panel lateral: chat, memoria y recordatorios, con
  Claude Code en modo restringido.
- **El agente de review**: el de `active` en `mentor.config.json`, que hace el review final con
  `11-PROMPT-DE-REVIEW.md`. Puede ser cualquier CLI, incluso uno local.

## Elegir el agente del dashboard

1. Copiá `mentor.config.example.json` a `mentor.config.json` (este último no entra en git).
2. En `agents`, dejá o agregá la entrada de tu CLI:
   - `command`: el ejecutable, buscado en `PATH` (o una ruta absoluta).
   - `args`: la lista fija de argumentos. Incluí la opción de sólo lectura de tu CLI.
   - `prompt`: `stdin` si el CLI lee el prompt de la entrada estándar, `arg` si lo recibe como
     último argumento.
3. Poné en `active` el nombre de la entrada que querés usar.
4. Opcional: en `editor`, el CLI de tu editor (`code`, `cursor`…). Con eso, el botón **Abrir en …**
   del dashboard abre el archivo del laboratorio que toca completar. Sin `editor`, el dashboard
   ofrece **Copiar ruta**.

El ejemplo trae un agente de código en modo plan (lee el repo, no edita) y un modelo local con
Ollama (no lee archivos: sólo recibe el documento de contexto y tu perfil incluidos en el prompt).
Cambiar `active` alcanza para cambiar de agente; no hace falta reiniciar.

El dashboard no puede imponerle un sandbox a un programa ajeno. Por eso:

- elegí siempre flags de sólo lectura o un modo sin herramientas de escritura;
- el prompt exige leer `AGENTS.md` y no editar, pero eso es una instrucción, no un candado;
- si el agente cambió archivos, revisalo con `git status` antes de seguir.

`AGENTS.md` es la fuente de las reglas del mentor. Los agentes que leen otro archivo la importan:
`CLAUDE.md` apunta a `AGENTS.md`, y el skill `module-builder` vive en `.agents/skills/` con un enlace
en `.claude/skills/`.

## Cómo enseña

El mentor enseña siguiendo [cómo enseña](01-COMO-ENSENA.md): primero el problema y un modelo mínimo,
después el mecanismo real y recién al final la terminología. Los puentes salen de tu perfil,
`course/00-PERFIL.md`.

## Concepto desconocido

```text
Enseñame <concepto> dentro de este módulo. Empezá por el problema que resuelve y
un modelo mínimo con un diagrama chico. Si hay un puente desde lo que ya sé, usalo y
decime dónde deja de valer. Cerrá con "hasta acá, quedate con esto" y ofrecé una
sola capa más. No edites archivos ni resuelvas la misión.
```

## No entiendo

```text
No entendí <parte>. No lo reformules: retrocedé una capa y buscá qué supuesto
previo me falta.
```

## Varias herramientas juntas

```text
Separame quién hace qué entre <herramientas>: qué recibe cada una, qué produce
y quién la llama.
```

## Lenguaje desconocido

```text
Explicame sólo el <lenguaje> necesario para este archivo. Comparalo con un lenguaje
que ya sé cuando ayude y usá un ejemplo corto que no sea la solución.
```

## Review

Pegá `11-PROMPT-DE-REVIEW.md` o usá **Pedir review final al mentor**. El mentor revisa contra
criterios; no parchea. Cierra preguntando qué del módulo es publicable
([qué publicar](08-QUE-PUBLICAR.md)).
