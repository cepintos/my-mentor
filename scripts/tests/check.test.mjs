import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {disposableRepo, readJsonFile, write} from './helpers.mjs';

// The core's own tests are skipped inside: they are the ones running this.
const check = root => {
  const result = spawnSync(process.execPath, ['scripts/check.mjs', '--skip-tests'], {cwd: root, encoding: 'utf8'});
  return {status: result.status, output: `${result.stdout}${result.stderr}`};
};

test('npm run check passes on the bare core and on a consistent course', t => {
  const bare = check(disposableRepo(t));
  assert.equal(bare.status, 0, bare.output);
  assert.match(bare.output, /sin course\/catalog\.json todavía/);
  assert.match(bare.output, /todavía no hay etapas/);
  assert.match(bare.output, /sin links locales rotos/);
  const course = check(disposableRepo(t, {course: true}));
  assert.equal(course.status, 0, course.output);
  assert.match(course.output, /2 etapa\(s\) con id único/);
  assert.match(course.output, /3 comando\(s\) del curso y 1 herramienta\(s\) del doctor/);
});

test('npm run check names what module-builder got wrong', t => {
  const root = disposableRepo(t, {course: true});
  fs.rmSync(path.join(root, 'course/demo/D01-segunda-etapa/03-GUIA-DE-LENGUAJE.md'));
  fs.writeFileSync(path.join(root, 'course/demo/D00-primera-etapa/07-CRITERIOS-DE-ACEPTACION.md'), '# Criterios\n\n- [ ] AC1 — otra cosa\n');
  write(root, 'course/demo/D00-primera-etapa/05-EJEMPLOS.md', '# Ejemplos\n\nVer [lo que falta](../referencia/no-existe.md).\n\n```md\n[en un bloque](no-cuenta.md)\n```\n');
  fs.rmSync(path.join(root, 'learning-labs/demo/D01/notas.md'));
  const manifest = 'course/demo/D00-primera-etapa/module.json';
  const module = readJsonFile(root, manifest);
  module.recommendedCommands.push('inventado');
  module.checks.push({kind: 'command', command: 'check'});
  write(root, manifest, module);
  const catalog = readJsonFile(root, 'course/catalog.json');
  catalog.commands.raro = {command: 'node --version'};
  write(root, 'course/catalog.json', catalog);
  write(root, 'course/huerfano/H00-sin-track/module.json', {id: 'H00'});
  const {status, output} = check(root);
  assert.equal(status, 1);
  for (const message of [
    /D01: faltan 03-GUIA-DE-LENGUAJE\.md/,
    /D00: 07 no copia textual el criterio «Las notas explican la idea con tus palabras\.»/,
    /05-EJEMPLOS\.md: el link \.\.\/referencia\/no-existe\.md no existe/,
    /D01: falta la plantilla del laboratorio learning-labs\/demo\/D01\/notas\.md/,
    /D00: recommendedCommands nombra “inventado”/,
    /D00: el check 3 corre “check”, que no es un comando del curso/,
    /"commands" · raro: "command" es un solo programa/,
    /course\/huerfano\/ tiene módulos pero no figura en "tracks"/,
  ]) assert.match(output, message);
  assert.doesNotMatch(output, /no-cuenta\.md/);
});

test('npm run check keeps package.json to its closed list of scripts', t => {
  const root = disposableRepo(t);
  const manifest = readJsonFile(root, 'package.json');
  manifest.scripts.setup = 'node setup.mjs';
  write(root, 'package.json', manifest);
  const {status, output} = check(root);
  assert.equal(status, 1);
  assert.match(output, /los comandos de un curso van en course\/catalog\.json/);
});
