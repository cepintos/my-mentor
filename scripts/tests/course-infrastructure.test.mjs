import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {disposableRepo, readJsonFile, write} from './helpers.mjs';

const libOf = root => import(`${pathToFileURL(path.join(root, 'scripts/lib.mjs')).href}?${Math.random()}`);

test('a fresh copy of the core reads as an empty course and serves only numbered docs', async t => {
  const root = disposableRepo(t);
  const lib = await libOf(root);
  const {catalog, state} = lib.load();
  assert.deepEqual(catalog.modules, []);
  assert.deepEqual(catalog.routes, []);
  assert.equal(catalog.defaultRoute, null);
  assert.deepEqual(state.modules, {});
  assert.ok(!fs.existsSync(path.join(root, 'course-state.json')), 'load() never writes');
  const docs = lib.courseDocs();
  assert.ok(docs.includes('00-EMPEZA-ACA.md'));
  assert.ok(docs.includes('06-CREAR-MODULOS.md'));
  for (const hidden of ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'CLAUDE.md']) assert.ok(!docs.includes(hidden), hidden);
});

test('without routes the engine builds "complete" in dependency order', async t => {
  const root = disposableRepo(t, {course: true});
  const catalog = readJsonFile(root, 'course/catalog.json');
  delete catalog.routes;
  delete catalog.defaultRoute;
  write(root, 'course/catalog.json', catalog);
  // Swap the orders so that sorting alone would put D01 first.
  const manifest = file => path.join(root, file);
  for (const [file, order] of [['course/demo/D00-primera-etapa/module.json', 5], ['course/demo/D01-segunda-etapa/module.json', 1]]) {
    const module = JSON.parse(fs.readFileSync(manifest(file), 'utf8'));
    module.order = order;
    fs.writeFileSync(manifest(file), JSON.stringify(module));
  }
  const lib = await libOf(root);
  const loaded = lib.loadCatalog();
  assert.equal(loaded.defaultRoute, 'complete');
  assert.deepEqual(loaded.routes.map(route => route.id), ['complete']);
  assert.deepEqual(loaded.routes[0].modules, ['D00', 'D01']);
});

test('an invalid module.json stops the loader with a message that names the file', async t => {
  const root = disposableRepo(t, {course: true});
  const file = path.join(root, 'course/demo/D01-segunda-etapa/module.json');
  for (const [patch, message] of [
    [{id: 'd01'}, /id es una letra mayúscula/],
    [{criteria: 'uno'}, /criteria tiene que ser una lista/],
    [{order: 'primero'}, /order tiene que ser un número/],
  ]) {
    const module = {...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch};
    fs.writeFileSync(file, JSON.stringify(module));
    const lib = await libOf(root);
    assert.throws(() => lib.loadCatalog(), error => /D01-segunda-etapa\/module\.json/.test(error.message) && message.test(error.message));
    fs.writeFileSync(file, JSON.stringify({...module, id: 'D01', criteria: [], order: 1}));
  }
});

test('completion requires dependencies, criteria, real checks and a review of unchanged files', async t => {
  const root = disposableRepo(t);
  const lib = await libOf(root);
  write(root, 'artifact/source.txt', 'first implementation');
  const module = {id: 'T00', slug: 'fixture', track: 'demo', deliverable: 'artifact', depends: ['A00'], criteria: ['Observable result'], checks: [{kind: 'file', path: 'artifact/source.txt'}]};
  write(root, 'course/demo/T00-fixture/module.json', module);
  const snapshot = lib.evidenceSnapshot(module);
  const record = {
    manualCriteria: {AC1: true}, review: 'pass', reviewEvidenceHash: snapshot.hash,
    lastCheck: {total: 1, passed: 1, evidenceHash: snapshot.hash},
  };
  const state = {modules: {A00: {status: 'done'}}};
  assert.equal(lib.completionRequirements(module, state, record).ready, true);
  assert.equal(lib.completionRequirements(module, {modules: {}}, record).ready, false);
  for (const patch of [
    {manualCriteria: {}}, {review: 'pending'}, {reviewStaleAt: 'changed'},
    {lastCheck: null}, {lastCheck: {...record.lastCheck, total: 0, passed: 0}},
    {lastCheck: {...record.lastCheck, passed: 0}}, {lastCheck: {...record.lastCheck, staleAt: 'changed'}},
  ]) assert.equal(lib.completionRequirements(module, state, {...record, ...patch}).ready, false);
  fs.writeFileSync(path.join(root, 'artifact/source.txt'), 'second implementation');
  const stale = lib.completionRequirements(module, state, record);
  assert.equal(stale.freshCheck, false);
  assert.equal(stale.freshReview, false);
  assert.equal(stale.ready, false);
  // Caches and OS files never count as evidence.
  const changed = lib.evidenceSnapshot(module).hash;
  write(root, 'artifact/.DS_Store', 'finder');
  write(root, 'artifact/__pycache__/x.pyc', 'bytes');
  assert.equal(lib.evidenceSnapshot(module).hash, changed);
  fs.rmSync(path.join(root, 'artifact/source.txt'));
  assert.notEqual(lib.evidenceSnapshot(module).hash, snapshot.hash);
});
