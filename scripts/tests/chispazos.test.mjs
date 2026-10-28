import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../lib.mjs';

// chispazos.js is a browser module (.js without "type"): load a copy as .mjs so Node reads it as ESM.
async function chispazos(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-chispazos-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'chispazos.mjs');
  fs.copyFileSync(path.join(ROOT, 'dashboard/chispazos.js'), file);
  return import(pathToFileURL(file).href);
}

test('tapping Chispa tells a fact of the current stage, sometimes of another one, and otherwise a joke', async t => {
  const {QUIPS, pickChispazo} = await chispazos(t);
  const modules = [
    {id: 'A00', facts: ['Dato de la primera etapa.']},
    {id: 'A01', facts: ['Dato de la segunda etapa.']},
    {id: 'A02'},
  ];
  assert.equal(pickChispazo(modules, 'A01', 0.1), 'Dato de A01 ⚡ Dato de la segunda etapa.');
  assert.match(pickChispazo(modules, 'A02', 0.32), /^Dato de A0[01] ⚡ Dato de la (primera|segunda) etapa\.$/);
  assert.ok(QUIPS.includes(pickChispazo(modules, 'A01', 0.9)));
  // A stage without facts, or a course without any, falls back to a joke.
  assert.ok(QUIPS.includes(pickChispazo(modules, 'A02', 0.1)));
  assert.ok(QUIPS.includes(pickChispazo([], null, 0.32)));
  assert.ok(QUIPS.includes(pickChispazo(undefined, undefined, 0.1)));
});
