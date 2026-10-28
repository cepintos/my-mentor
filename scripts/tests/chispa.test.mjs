import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {disposableRepo, startDashboard} from './helpers.mjs';

function mcp(root, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'companion/mcp-server.mjs')], {cwd: root});
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', () => resolve(output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))));
    child.stdin.end(messages.map(message => JSON.stringify({jsonrpc: '2.0', ...message})).join('\n'));
  });
}

const call = (id, name, args = {}) => ({id, method: 'tools/call', params: {name, arguments: args}});

test('Chispa MCP exposes only read tools and proposes memory as an inbox draft', async t => {
  const root = disposableRepo(t, {course: true});
  const [list, state, proposed, invalid, unknown] = await mcp(root, [
    {id: 1, method: 'tools/list'},
    call(2, 'estado_del_curso'),
    call(3, 'memoria_proponer', {tipo: 'incidente', modulo: 'D00', indicativa: 'El test fallaba porque el archivo seguía abierto al borrarlo', rca: 'Windows no deja borrar un archivo abierto.'}),
    call(4, 'memoria_proponer', {tipo: 'chisme', modulo: 'D00', indicativa: 'esto no debería guardarse nunca'}),
    call(5, 'ejecutar_shell', {cmd: 'rm -rf /'}),
  ]);
  assert.deepEqual(list.result.tools.map(tool => tool.name).sort(), [
    'cambio_proponer', 'diff_del_lab', 'ejecucion', 'estado_del_curso', 'etapa', 'git_reciente',
    'memoria_buscar', 'memoria_leer', 'memoria_proponer', 'ultimas_ejecuciones',
  ]);
  assert.equal(JSON.parse(state.result.content[0].text).stage.id, 'D00');
  assert.match(proposed.result.content[0].text, /Borrador .* creado/);
  const inbox = fs.readdirSync(path.join(root, '.companion/memory/inbox'));
  assert.equal(inbox.length, 1);
  assert.match(fs.readFileSync(path.join(root, '.companion/memory/inbox', inbox[0]), 'utf8'), /## Mini RCA\n\nWindows no deja borrar/);
  assert.deepEqual(fs.readdirSync(path.join(root, '.companion/memory')), ['inbox']);
  assert.equal(invalid.result.isError, true);
  assert.equal(unknown.result.isError, true);
});

test('Chispa only proposes localized edits to course docs, and only the learner applies them', async t => {
  const root = disposableRepo(t, {course: true});
  const brief = 'course/demo/D00-primera-etapa/01-BRIEF.md';
  const original = fs.readFileSync(path.join(root, brief), 'utf8');
  const [proposed, lab, ambiguous, outside, guide] = await mcp(root, [
    call(1, 'cambio_proponer', {ruta: brief, buscar: 'Contenido de prueba.', reemplazar: 'El entregable va en learning-labs/demo/D00/.', motivo: 'El brief no dice dónde va el entregable.'}),
    call(2, 'cambio_proponer', {ruta: 'learning-labs/demo/D00/notas.md', buscar: 'TODO_LEARNER', reemplazar: 'resuelto', motivo: 'Esto no debería poder proponerse nunca.'}),
    call(3, 'cambio_proponer', {ruta: brief, buscar: 'o', reemplazar: '0', motivo: 'Aparece muchas veces en el archivo.'}),
    call(4, 'cambio_proponer', {ruta: '../course-state.json', buscar: '{', reemplazar: '[', motivo: 'Fuera del material del curso.'}),
    call(5, 'cambio_proponer', {ruta: '00-EMPEZA-ACA.md', buscar: '# 00 — Empezá acá', reemplazar: '# 00 — Empezá', motivo: 'La guía del mentor es del core.'}),
  ]);
  assert.match(proposed.result.content[0].text, /todavía no cambió nada/);
  assert.equal(fs.readFileSync(path.join(root, brief), 'utf8'), original);
  for (const rejected of [lab, ambiguous, outside, guide]) assert.equal(rejected.result.isError, true);
  assert.match(lab.result.content[0].text, /no es un documento del curso/);
  assert.match(guide.result.content[0].text, /no es un documento del curso/);
  assert.match(ambiguous.result.content[0].text, /exactamente una/);

  const edits = await import(pathToFileURL(path.join(root, 'companion/edits.mjs')).href);
  const [edit] = edits.listEdits();
  assert.equal(edits.listEdits().length, 1);
  assert.equal(edits.applyEdit(edit.id), brief);
  assert.match(fs.readFileSync(path.join(root, brief), 'utf8'), /El entregable va en learning-labs\/demo\/D00\/\./);
  assert.deepEqual(edits.listEdits(), []);
  assert.throws(() => edits.applyEdit(edit.id), /No existe el cambio/);
  assert.throws(() => edits.discardEdit('../../course-state'), /id de cambio inválido/);

  // A proposal is checked again when applied: if the doc no longer matches, nothing is written.
  const staleId = edits.proposeEdit({ruta: brief, buscar: '# D00 · 01-BRIEF', reemplazar: '# D00 · Brief', motivo: 'El título repite el nombre del archivo.'});
  fs.writeFileSync(path.join(root, brief), '# Otro título\n');
  assert.throws(() => edits.applyEdit(staleId), /aparece 0 veces/);
  assert.equal(fs.readFileSync(path.join(root, brief), 'utf8'), '# Otro título\n');
  edits.discardEdit(staleId);
  assert.deepEqual(edits.listEdits(), []);
});

test('without a course Chispa still answers: no stage, no crash', async t => {
  const root = disposableRepo(t);
  const [state] = await mcp(root, [call(1, 'estado_del_curso')]);
  assert.equal(JSON.parse(state.result.content[0].text).stage, null);
  const boot = await import(pathToFileURL(path.join(root, 'companion/boot.mjs')).href);
  const text = boot.bootText();
  assert.match(text, /# Chispa/);
  assert.match(text, /Todavía no hay etapas/);
  assert.match(text, /Todavía no hay perfil/);
});

test('failed runs become one incident draft that a later pass marks as recovered', async t => {
  const root = disposableRepo(t, {course: true});
  const memory = await import(pathToFileURL(path.join(root, 'companion/memory.mjs')).href);
  const todoOnly = {id: '1-1', commandId: 'course-check', moduleId: 'D00', label: 'Validar esta etapa', status: 'failed', log: '[FAIL] learning-labs/demo/D00/notas.md: contiene TODO_LEARNER\n'};
  assert.equal(memory.recordRun(todoOnly), null);
  const failed = {id: '2-1', commandId: 'pytest-etapa', moduleId: 'D00', label: 'Correr los tests', status: 'failed', exitCode: 1, log: 'collected 3 items\nE   AssertionError: assert 2 == 3\nFAILED test_suma.py::test_suma\n'};
  const id = memory.recordRun(failed);
  assert.ok(id);
  assert.equal(memory.recordRun({...failed, id: '3-1'}), id);
  assert.equal(memory.listShards({inbox: true}).length, 1);
  assert.equal(memory.recordRun({...failed, id: '4-1', status: 'passed'}), id);
  const [shard] = memory.listShards({inbox: true});
  assert.equal(shard.origen, 'run:pytest-etapa:D00');
  assert.match(shard.indicativa, /AssertionError/);
  assert.ok(shard.recuperado);
  assert.equal(memory.approveShard(id), id);
  assert.throws(() => memory.discardShard(id), /Sólo se descartan borradores/);
  assert.throws(() => memory.readShard('../../course-state'), /id de shard inválido/);
});

test('the dashboard runs Chispa with a fixed restricted invocation and streams the answer', {timeout: 40000}, async t => {
  const root = disposableRepo(t, {course: true});
  const {request, json} = await startDashboard(t, root, {CHISPA_CLAUDE: path.join(root, 'scripts/tests/fixtures/fake-claude.mjs')});
  const idle = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const {data} = await json('/api/chispa');
      if (!data.turn) return data;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Chispa no terminó el turno');
  };

  for (const payload of [{message: 'hola', model: 'claude-opus-5-5'}, {message: 'hola', args: ['--dangerously-skip-permissions']}, {message: '  '}, {message: 'x'.repeat(4001)}, {message: 42}]) {
    assert.equal((await request('/api/chispa', payload)).status, 400, JSON.stringify(payload).slice(0, 60));
  }
  assert.equal((await request('/api/chispa', {message: 'hola'}, {origin: 'https://attacker.invalid'})).status, 400);
  assert.equal((await request('/api/chispa/memory', {action: 'save', id: '../../course-state'})).status, 400);

  assert.equal((await request('/api/chispa', {message: '¿Qué hago ahora?'})).status, 202);
  const first = await idle();
  assert.deepEqual(first.conversation.messages.map(message => message.role), ['user', 'chispa']);
  assert.equal(first.conversation.messages[1].text, 'Miro tu estado.\n\nLeé `00-EMPEZA-ACA.md`.');
  assert.deepEqual(first.conversation.messages[1].tools.map(tool => tool.name), ['estado_del_curso']);

  assert.equal((await request('/api/chispa', {message: 'Gracias'})).status, 202);
  await idle();
  const calls = fs.readFileSync(path.join(root, '.companion/fake-claude-calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 2);
  const [opening, followUp] = calls;
  const value = (args, flag) => args[args.indexOf(flag) + 1];
  assert.ok(opening.args.includes('--restricted'));
  assert.equal(value(opening.args, '--model'), 'claude-sonnet-5-5');
  assert.equal(value(opening.args, '--effort'), 'medium');
  assert.equal(value(opening.args, '--tools'), 'Read,Grep,Glob,WebSearch,WebFetch');
  assert.equal(value(opening.args, '--permission-mode'), 'dontAsk');
  assert.ok(opening.args.includes('--strict-mcp-config'));
  const settings = JSON.parse(value(opening.args, '--settings'));
  assert.ok(settings.permissions.deny.includes('Bash'));
  assert.ok(settings.permissions.deny.some(rule => rule.includes('/private/**')));
  assert.ok(settings.permissions.allow.includes('WebFetch(domain:developer.mozilla.org)'));
  assert.ok(!settings.permissions.allow.some(rule => rule === 'WebFetch' || rule === 'Bash'));
  const boot = value(opening.args, '--append-system-prompt');
  assert.match(boot, /# Chispa[\s\S]*Sé programar en JavaScript[\s\S]*Etapa actual: D00/);
  assert.equal(opening.input, '¿Qué hago ahora?');
  assert.equal(value(followUp.args, '--resume'), value(opening.args, '--session-id'));
  assert.ok(!followUp.args.includes('--append-system-prompt'));
  assert.ok(!fs.existsSync(path.join(root, 'mentor.config.json')));
});

test('reminders respect quiet hours, never repeat within the window and vanish with progress', async t => {
  const root = disposableRepo(t);
  const nudges = await import(pathToFileURL(path.join(root, 'companion/nudges.mjs')).href);
  const at = (day, time) => new Date(`2026-11-0${day}T${time}:00`);
  const quiet = {from: '23:00', to: '08:30'};
  assert.equal(nudges.outsideQuietHours(at(2, '23:30'), quiet).getTime(), at(3, '08:30').getTime());
  assert.equal(nudges.outsideQuietHours(at(3, '07:00'), quiet).getTime(), at(3, '08:30').getTime());
  assert.equal(nudges.outsideQuietHours(at(3, '12:00'), quiet).getTime(), at(3, '12:00').getTime());
  assert.equal(nudges.outsideQuietHours(at(3, '03:00'), {from: '01:00', to: '07:00'}).getTime(), at(3, '07:00').getTime());

  const reading = [{name: '00-EMPEZA-ACA.md', path: 'course/demo/A00-primera/00-EMPEZA-ACA.md', read: false}];
  const stalled = hours => ({stage: {id: 'A00', title: 'Primera', status: 'in_progress', phase: 0, phaseName: 'Entender',
    nextStep: 'Leer 00-EMPEZA-ACA.md', lab: [], reading, planDoc: null}, hoursSinceProgress: hours});
  const empty = {entries: [], history: [], deliveredMac: []};

  const first = await nudges.buildPlan({now: at(2, '12:00'), previous: empty, useModel: false, snapshot: stalled(30), shards: []});
  assert.deepEqual(first.entries.map(entry => entry.kind), ['no-progress', 'no-progress-later']);
  assert.equal(first.entries[0].doc, reading[0].path);
  assert.equal(first.entries[1].at, at(3, '12:00').toISOString());

  const hourLater = await nudges.buildPlan({now: at(2, '13:00'), previous: first, useModel: false, snapshot: stalled(31), shards: []});
  assert.deepEqual(hourLater.entries.map(entry => entry.kind), ['no-progress-later']);
  assert.equal(hourLater.history.length, 1);

  const progressed = await nudges.buildPlan({now: at(2, '14:00'), previous: hourLater, useModel: false, snapshot: stalled(0), shards: []});
  assert.deepEqual(progressed.entries, []);

  const nextDay = await nudges.buildPlan({now: at(3, '13:00'), previous: hourLater, useModel: false, snapshot: stalled(55), shards: []});
  assert.deepEqual(nextDay.entries.map(entry => entry.kind), ['no-progress', 'no-progress-later']);

  const noCourse = await nudges.buildPlan({now: at(2, '12:00'), previous: empty, useModel: false, snapshot: {stage: null, hoursSinceProgress: null}, shards: []});
  assert.deepEqual(noCourse.entries, []);
});
