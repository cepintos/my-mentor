import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {disposableRepo, startDashboard, write} from './helpers.mjs';

test('the localhost dashboard rejects untrusted requests and premature completion', {timeout: 60000}, async t => {
  const root = disposableRepo(t, {course: true});
  write(root, 'course/demo/referencia/nested/hidden.md', '# hidden\n');
  write(root, 'course/demo/referencia/script.js', 'alert(1)');
  const {request, json} = await startDashboard(t, root);

  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/', undefined, {host: 'attacker.invalid'})).status, 400);
  assert.equal((await request('/api/run', {commandId: 'doctor'}, {origin: 'https://attacker.invalid'})).status, 400);
  assert.equal((await request('/api/run', {commandId: 'doctor'}, {'content-type': 'text/plain'})).status, 400);
  for (const commandId of ['sh', 'doctor; touch /tmp/escape', '__proto__', 'constructor', 'toString', 42]) {
    const result = await request('/api/run', {commandId});
    assert.equal(result.status, 400, String(commandId));
    assert.match(result.body, /Comando no permitido/);
  }
  for (const field of ['args', 'shell', 'executable', 'prompt', 'path', 'cwd']) {
    const result = await request('/api/run', {commandId: 'node-version', [field]: 'untrusted'});
    assert.equal(result.status, 400);
    assert.match(result.body, /Sólo se aceptan identificadores/);
  }
  assert.equal((await request('/api/run', {commandId: 'course-check', moduleId: '../outside'})).status, 400);
  assert.equal((await request('/api/run', {commandId: 'list-lab', moduleId: '../outside'})).status, 400);
  assert.match((await request('/api/run', {commandId: 'reset-notes', confirmation: 'wrong'})).body, /Confirmación requerida/);
  assert.match((await request('/api/run', {commandId: 'mentor-review', moduleId: 'D00'})).body, /mentor\.config\.json/);

  for (const allowed of [
    '00-EMPEZA-ACA.md', '04-COMO-USAR-EL-MENTOR.md', 'course/00-PERFIL.md', 'course/demo/00-INDICE.md',
    'course/demo/referencia/00-INDICE.md', 'course/demo/referencia/idea.md', 'course/demo/D00-primera-etapa/02-CONCEPTOS.md',
  ]) assert.equal((await request(`/api/doc?path=${encodeURIComponent(allowed)}`)).status, 200, allowed);
  for (const blocked of [
    'package.json', 'README.md', 'AGENTS.md', 'course/catalog.json', 'course/demo/D00-primera-etapa/module.json',
    'course/demo/referencia/nested/hidden.md', 'course/demo/referencia/script.js', 'course/demo/referencia/../../../package.json',
    'learning-labs/demo/D00/notas.md',
  ]) assert.equal((await request(`/api/doc?path=${encodeURIComponent(blocked)}`)).status, 403, blocked);

  const {data: library} = await json('/api/library');
  assert.ok(library.tracks.demo.modules.find(module => module.id === 'D00').docs.includes('course/demo/D00-primera-etapa/02-CONCEPTOS.md'));
  assert.equal(library.tracks.demo.referenceIndex, 'course/demo/referencia/00-INDICE.md');
  assert.ok(library.mentorDocs.includes('00-EMPEZA-ACA.md'));
  assert.deepEqual(library.courseDocs, ['course/00-PERFIL.md']);

  const {data: {reading}} = await json('/api/reading?moduleId=D00');
  assert.equal(reading[0].name, '00-EMPEZA-ACA.md');
  assert.ok(reading.every(item => item.path.startsWith('course/demo/D00-primera-etapa/')));
  assert.equal((await request('/api/reading?moduleId=../outside')).status, 400);
  for (const doc of ['../../package.json', '11-PROMPT-DE-REVIEW.md']) {
    const result = await request('/api/module', {moduleId: 'D00', action: 'read', doc, value: true});
    assert.equal(result.status, 400, doc);
    assert.match(result.body, /lista de lectura/);
  }

  const {data: course} = await json('/api/course');
  const d00 = course.catalog.modules.find(module => module.id === 'D00');
  assert.deepEqual(d00.state.lab.map(item => item.index), [0]);
  assert.deepEqual(course.catalog.routes.map(route => route.id), ['first', 'complete']);
  assert.deepEqual(course.catalog.commandProblems, []);
  const command = id => course.commands.find(item => item.id === id);
  assert.equal(command('node-version').course, true);
  assert.deepEqual(command('node-version').recommendedFor, ['D00']);
  assert.equal(command('list-lab').requiresModule, true);
  assert.deepEqual(command('list-lab').availableFor, ['D00', 'D01']);
  assert.equal(command('mentor-review').available, false);

  for (const field of ['path', 'command', 'args']) {
    const result = await request('/api/open', {moduleId: 'D00', index: 0, [field]: 'untrusted'});
    assert.equal(result.status, 400);
    assert.match(result.body, /Sólo se aceptan moduleId e index/);
  }
  for (const index of [99, -1, '0', 1]) {
    assert.match((await request('/api/open', {moduleId: 'D00', index})).body, /no es un archivo del laboratorio/);
  }
  assert.match(JSON.parse((await request('/api/open', {moduleId: 'D00', index: 0})).body).error, /Agregá "editor"/);
  const premature = await request('/api/module', {moduleId: 'D00', action: 'done'});
  assert.equal(premature.status, 400);
  assert.match(premature.body, /No se puede completar/);

  assert.ok(!fs.existsSync(path.join(root, 'course-state.json')), 'rejected requests never write progress');
  assert.equal(fs.readdirSync(path.join(root, '.course/runs')).length, 0);
});

test('course commands run from the allowlist with their arguments resolved on the server', {timeout: 90000}, async t => {
  const root = disposableRepo(t, {course: true});
  const {json, runToEnd} = await startDashboard(t, root);

  const version = await runToEnd({commandId: 'node-version'});
  assert.equal(version.status, 'passed', version.log);
  assert.match(version.log, /^\$ node --version\n\nv\d+\.\d+\.\d+/);

  const listing = await runToEnd({commandId: 'list-lab', moduleId: 'D01'});
  assert.equal(listing.status, 'passed', listing.log);
  assert.equal(listing.moduleId, 'D01');
  assert.match(listing.log, / learning-labs\/demo\/D01\n/);
  assert.match(listing.log, /\nnotas\.md\n/);

  const confirmed = await runToEnd({commandId: 'reset-notes', confirmation: 'reset-notes'});
  assert.equal(confirmed.status, 'passed');

  const stage = await runToEnd({commandId: 'course-check', moduleId: 'D00'});
  assert.equal(stage.status, 'failed');
  assert.match(stage.log, /\[FAIL] learning-labs\/demo\/D00\/notas\.md: contiene TODO_LEARNER/);
  assert.match(stage.log, /\[PASS] command:node-version: comando completado/);
  assert.deepEqual(stage.steps.map(step => step.status), ['failed', 'passed']);

  fs.writeFileSync(path.join(root, 'learning-labs/demo/D00/notas.md'), '# Notas de D00\n\nMis notas reales.\n');
  const passing = await runToEnd({commandId: 'course-check', moduleId: 'D00'});
  assert.equal(passing.status, 'passed', passing.log);

  const doctor = await runToEnd({commandId: 'doctor'});
  assert.match(doctor.log, /\[PASS] Node para el curso: \d+\.\d+/);

  const {data: course} = await json('/api/course');
  const d00 = course.catalog.modules.find(module => module.id === 'D00');
  assert.equal(d00.state.lastCheck.passed, 2);
  assert.equal(d00.state.completion.freshCheck, true);
  assert.ok(course.environment.doctorExecuted);
  assert.ok(course.environment.results.some(result => result.name === 'Node para el curso' && result.status === 'PASS'));
  assert.deepEqual(course.state.runs.map(run => run.commandId), ['doctor', 'course-check', 'course-check', 'reset-notes', 'list-lab', 'node-version']);
  assert.equal(fs.readdirSync(path.join(root, '.course/runs')).length, 6);
});

test('a fresh copy without a course serves the dashboard, the guide and the global actions', {timeout: 60000}, async t => {
  const root = disposableRepo(t);
  const {request, json, runToEnd} = await startDashboard(t, root);
  assert.equal((await request('/')).status, 200);
  const {data: course} = await json('/api/course');
  assert.deepEqual(course.catalog.modules, []);
  assert.deepEqual(course.catalog.routes, []);
  assert.ok(course.mentorDocs.includes('06-CREAR-MODULOS.md'));
  assert.deepEqual(course.commands.map(command => command.id).sort(), ['check', 'course-check', 'doctor', 'mentor-explain', 'mentor-next', 'mentor-review']);
  assert.equal((await request('/api/doc?path=06-CREAR-MODULOS.md')).status, 200);
  assert.deepEqual((await json('/api/library')).data.tracks, {});
  assert.equal((await request('/api/reading?moduleId=A00')).status, 400);
  const doctor = await runToEnd({commandId: 'doctor'});
  assert.match(doctor.log, /\[WARN] Curso: todavía no hay etapas/);

  // The first module appears without restarting the server.
  write(root, 'course/catalog.json', {version: 2, tracks: {demo: {title: 'Demo'}}});
  write(root, 'course/demo/A00-primera/module.json', {id: 'A00', track: 'demo', order: 0, slug: 'primera', title: 'Primera', depends: [], criteria: [], checks: []});
  const {data: grown} = await json('/api/course');
  assert.deepEqual(grown.catalog.modules.map(module => module.id), ['A00']);
  assert.deepEqual(grown.catalog.routes.map(route => route.id), ['complete']);
  assert.equal(grown.catalog.defaultRoute, 'complete');
});
