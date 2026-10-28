# 07 — Recibir actualizaciones del core

El core y tu curso viven en el mismo repositorio, en carpetas distintas. Las actualizaciones sólo
tocan el core, así que podés traerlas sin perder tu curso ni tu progreso.

| Del core: llega con cada actualización | Tuyo: el core nunca lo toca |
| --- | --- |
| `dashboard/`, `tools/`, `scripts/`, `companion/` | `course/` |
| `.agents/skills/`, `.claude/` | `learning-labs/` y los entregables de tus módulos |
| `AGENTS.md`, `CLAUDE.md`, `README.md` y los documentos `00…08` de la raíz | `course-state.json`, `mentor.config.json`, `.companion/`, `private/` |
| `package.json`, `mentor.config.example.json`, `CHANGELOG.md`, `LICENSE` | |

## Traer cambios

Si clonaste el repo del core, `origin` ya apunta a él:

```bash
git pull
```

Si trabajás en tu propio repo (por ejemplo, uno privado con tu curso), agregá el core una vez:

```bash
git remote add upstream https://github.com/cepintos/my-mentor.git
```

y después, cada vez que quieras actualizar:

```bash
git pull upstream main
```

Después de actualizar, corré `npm run check` y leé `CHANGELOG.md`: dice qué cambió y si hay que
ajustar algo del curso.

## Para no tener conflictos

- No edites archivos del core para personalizar. Tu agente y Chispa se configuran en
  `mentor.config.json`, los comandos en `course/catalog.json` y lo que sabés en
  `course/00-PERFIL.md`.
- Si igual cambiaste algo del core, git marca el conflicto en ese archivo: quedate con la versión
  nueva y volvé a aplicar tu cambio, o proponelo al core.

## Versionar tu progreso

`course-state.json` está fuera de git porque sus logs llevan rutas de tu máquina. Para guardarlo en
un repo privado:

```bash
git add -f course-state.json
```

Una vez agregado, git lo sigue aunque esté en `.gitignore`.

## Proponer mejoras al core

Un cambio del core va en un pull request sin nada de tu curso: ni `course/`, ni laboratorios, ni
progreso. `npm run check` tiene que pasar antes de abrirlo.

## Para quien mantiene el core

1. Cambiá sólo archivos del core. Para probar con módulos, armá un curso en una copia aparte: las
   pruebas del core ya crean el suyo en una carpeta temporal.
2. Corré `npm run check`.
3. Anotá el cambio en `CHANGELOG.md` y subí `version` en `package.json`. Un cambio que obliga a
   tocar cursos existentes sube el número mayor.
4. Commit, tag `vX.Y.Z` y push.
