# 05 — Chispa, tu companion

Chispa ⚡ es una centella eléctrica azul, tierna y ELECTRIFICANTEMENTE energética: vive en el panel
derecho del dashboard, ve tu progreso real, recuerda lo que pasó en otras sesiones, te explica con
el método del mentor y te manda recordatorios cuando el trabajo quedó a mitad de camino. Es sólo
texto. A veces se pone lentes de sol 😎; tocala y vas a ver.

## Qué necesita

- [Claude Code](https://code.claude.com) instalado y con sesión iniciada (`claude` en `PATH`).
  Chispa usa ese login: cada mensaje gasta de tu plan de Claude. No hace falta API key.
- `npm run dashboard`. El panel aparece solo; si falta `claude`, el panel dice qué hacer.
- Opcional: la sección `chispa` de `mentor.config.json` (copiala de `mentor.config.example.json`):

| Campo | Para qué | Por defecto |
| --- | --- | --- |
| `model`, `effort` | modelo y esfuerzo del chat | `claude-sonnet-5-5`, `medium` |
| `nudgeEffort` | esfuerzo de los recordatorios (dos frases, sin herramientas) | `low` |
| `learnerName` | cómo te llama | tu nombre de `git config user.name` |
| `quietHours` | horas en las que no avisa | `23:00`–`08:30` |
| `thresholds.noProgressHours` | horas sin progreso antes de avisar | `20` |
| `thresholds.repeatAfterHours` | mínimo entre dos avisos iguales | `24` |
| `webFetchDomains` | sitios que puede leer completos | sitios de documentación generales |

Sumá a `webFetchDomains` la documentación oficial de lo que estés aprendiendo.

## Qué puede y qué no

Chispa corre como `claude -p --restricted` con permisos `dontAsk`: lo que no está permitido
explícitamente se rechaza sin preguntar.

- **Lee:** archivos del repo (`Read`, `Grep`, `Glob`), menos `private/`, `.env` y las conversaciones
  guardadas.
- **Comandos de lectura** (servidor MCP `companion/mcp-server.mjs`): `estado_del_curso`, `etapa`,
  `memoria_buscar`, `memoria_leer`, `ultimas_ejecuciones`, `ejecucion`, `git_reciente`,
  `diff_del_lab`. Son comandos fijos: no aceptan programas ni rutas para ejecutar.
- **Web:** `WebSearch` libre; `WebFetch` sólo a `webFetchDomains`. Leer tu repo, leer la web y
  poder pedir cualquier URL juntos permitirían filtrar datos; por eso `WebFetch` tiene lista.
- **No tiene shell** ni edita archivos por su cuenta. Sus dos escrituras dejan borradores que vos
  aprobás: `memoria_proponer` (un recuerdo) y `cambio_proponer` (un cambio en tu material).
- Sigue [`AGENTS.md`](AGENTS.md): enseña, no resuelve tu laboratorio y no afirma que algo compiló
  sin salida real. El review final lo sigue haciendo el agente de `mentor.config.json` (`active`).

Desde el navegador sólo viaja tu mensaje (hasta 4000 caracteres) y si querés una charla nueva. El
modelo, las herramientas, los permisos y el contexto los fija el servidor (`companion/claude.mjs`).

### Cambios propuestos

Cuando un documento de tu curso tiene un hueco (por ejemplo, un brief que no dice dónde va el
entregable), Chispa propone un cambio puntual: texto exacto a reemplazar, texto nuevo y motivo.
Aparece arriba del chat como "Chispa propone un cambio", con el antes y el después, y no toca nada
hasta que tocás **Aplicar**. **Descartar** lo borra.

- Sólo documentos de tu curso que abre la Biblioteca (`course/…/*.md`). Nunca la guía del mentor
  de la raíz, que es del core, ni el laboratorio, código o configuración: la herramienta los
  rechaza.
- El texto a reemplazar tiene que aparecer una sola vez, y se vuelve a comprobar al aplicar: si el
  archivo cambió y ya no coincide, el cambio no se aplica.
- Las propuestas viven en `.companion/edits/` (fuera de git).

## Cómo arranca cada charla

Al empezar una charla, el servidor arma el contexto de arranque (`companion/boot.mjs`):

- la persona (`companion/PERSONA.md`);
- tu perfil (`course/00-PERFIL.md`, si existe);
- tu etapa, fase y próximo paso;
- lectura, archivos del lab, último check, criterios y review;
- las horas desde tu último progreso real;
- las ejecuciones que fallaron;
- la línea indicativa de cada recuerdo.

Ese contexto queda fijo durante la charla. Si querés que vuelva a mirar todo, usá **Nueva charla**.
Dentro de una charla, Chispa consulta `estado_del_curso` cuando lo necesita.

Sin curso todavía, Chispa te ayuda a pensar qué aprender y qué querés poder hacer. Los módulos los
escribe module-builder en tu agente, no Chispa.

## Memoria

Cada recuerdo es un archivo en `.companion/memory/` (fuera de git):

```markdown
---
id: 2026-10-27-a01-el-test-fallaba-porque-el-archivo-no-se-cerraba
fecha: 2026-10-27
modulo: A01
tipo: incidente          # incidente | concepto | decision | victoria
estado: resuelto         # abierto | resuelto
tags: ["archivos","tests"]
indicativa: "El test fallaba en Windows porque el archivo seguía abierto al borrarlo"
---
## Síntoma · ## Stacktrace · ## Mini RCA · ## Pasos · ## Concepto vinculado · ## Cómo reconocerlo la próxima vez
```

- **Indicativa vs. completa:** el contexto de arranque lleva sólo la línea `indicativa`. El archivo
  completo se lee con `memoria_leer` cuando hace falta.
- **Borradores:** Chispa propone recuerdos (`memoria_proponer`) y aparecen arriba del chat como
  "Chispa quiere recordar…". Vos decidís con **Guardar** o **Descartar**.
- **Incidentes automáticos:** cuando falla una ejecución con errores reales (no sólo `TODO_LEARNER`
  pendientes), se crea un borrador con la cola del log. Si vuelve a pasar, se marca "recuperado" y
  Chispa te pregunta qué lo arregló.

## Recordatorios

`companion/nudges.mjs`:

- **Cuándo avisa** lo deciden reglas fijas:
  - etapa en curso sin progreso por `noProgressHours`;
  - un solo archivo del lab pendiente;
  - archivos listos sin validar;
  - review pendiente;
  - un incidente que volvió a pasar sin RCA.
- **Qué dice** lo escribe el modelo con `nudgeEffort`. Si falla, usa una plantilla.
- **Dónde llega:** el plan queda en `.companion/nudges.json`. En macOS, cada corrida muestra como
  notificación lo que vence. En otros sistemas el plan se escribe igual, sin notificación.
- **Sin repeticiones:** el mismo aviso no se repite dentro de `repeatAfterHours`. Si avanzás, los
  avisos pendientes se borran solos.

```bash
node companion/nudges.mjs --dry-run
```

Muestra el plan con textos de plantilla, sin escribir nada ni llamar al modelo.

```bash
node companion/nudges.mjs agent install
```

En macOS instala un LaunchAgent que corre cada hora (`agent uninstall` / `agent status`). Cada copia
del repo tiene su propio agente. El log queda en `.companion/nudges.log`.

## Privacidad

`.companion/` y `private/` están en `.gitignore`. Lo que sale de tu máquina son tus mensajes y el
contexto hacia Claude, y las búsquedas web de Chispa. Ni la memoria ni las conversaciones se
publican.
