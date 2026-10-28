import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {disposableRepo, readJsonFile, write} from './helpers.mjs';

const commandsOf = root => import(pathToFileURL(path.join(root, 'scripts/commands.mjs')).href);

test('course commands are validated entry by entry and never take shell syntax or outside paths', async t => {
  const root = disposableRepo(t);
  const {courseCommands} = await commandsOf(root);
  const {commands, problems} = courseCommands({commands: {
    ok: {command: 'node', args: ['--version']},
    check: {command: 'node'},
    'Bad Id': {command: 'node'},
    spaces: {command: 'node --version'},
    shell: {command: 'sh;rm'},
    absolute: {command: '/bin/sh'},
    outside: {command: '../outside/run.sh'},
    'bad-args': {command: 'node', args: '--version'},
    'bad-cwd': {command: 'node', cwd: '../..'},
    'bad-group': {command: 'node', group: 'root'},
    'bad-platform': {command: 'node', platforms: ['amiga']},
  }});
  assert.deepEqual([...commands.keys()], ['ok']);
  const byId = Object.fromEntries(problems.map(problem => problem.split(': ')));
  assert.match(byId.check, /es del core/);
  assert.match(byId['Bad Id'], /minúsculas/);
  assert.match(byId.spaces, /un solo programa/);
  assert.match(byId.shell, /un solo programa/);
  assert.match(byId.absolute, /ruta absoluta/);
  assert.match(byId.outside, /fuera del repo/);
  assert.match(byId['bad-args'], /lista de textos/);
  assert.match(byId['bad-cwd'], /fuera del repo/);
  assert.match(byId['bad-group'], /group/);
  assert.match(byId['bad-platform'], /platforms/);
  assert.deepEqual(courseCommands({commands: []}).problems, ['"commands" tiene que ser un objeto {id: definición}']);
  assert.equal(courseCommands({}).commands.size, 0);
});

test('placeholders come from the catalog and an unsafe deliverable is refused', async t => {
  const root = disposableRepo(t);
  const {courseCommands, resolveCommand} = await commandsOf(root);
  write(root, 'learning-labs/demo/D00/notas.md', '# Notas\n');
  write(root, 'learning-labs/demo/run.mjs', 'console.log("ok")\n');
  // The loader resolves symlinks (macOS keeps /var under /private/var), so compare real paths.
  const real = fs.realpathSync(root);
  const {commands} = courseCommands({commands: {
    tests: {command: 'node', args: ['--test', '{deliverable}', '--name={module}']},
    script: {command: 'learning-labs/demo/run.mjs', cwd: 'learning-labs/demo'},
    missing: {command: 'definitely-not-installed-mentor'},
  }});
  const tests = commands.get('tests');
  assert.equal(tests.requiresModule, true);
  const resolved = resolveCommand(tests, {id: 'D00', deliverable: 'learning-labs/demo/D00'});
  assert.deepEqual(resolved.args, ['--test', 'learning-labs/demo/D00', '--name=D00']);
  assert.equal(resolved.cwd, real);
  assert.equal(resolved.executable, process.execPath);
  for (const deliverable of ['../../tmp', '/tmp', 'a + b', 'learning-labs/*', '']) {
    assert.throws(() => resolveCommand(tests, {id: 'D00', deliverable}), /fuera del repo|una sola ruta/, deliverable);
  }
  assert.throws(() => resolveCommand(tests, null), /necesita una etapa/);
  const script = resolveCommand(commands.get('script'), null);
  assert.equal(script.executable, path.join(real, 'learning-labs/demo/run.mjs'));
  assert.equal(script.cwd, path.join(real, 'learning-labs/demo'));
  assert.throws(() => resolveCommand(commands.get('missing'), null), /no está en PATH/);
});

test('the doctor checks the course tools and every program its commands need', async t => {
  const root = disposableRepo(t, {course: true});
  const catalog = readJsonFile(root, 'course/catalog.json');
  const runDoctor = () => spawnSync(process.execPath, ['scripts/doctor.mjs'], {cwd: root, encoding: 'utf8', env: {...process.env, CHISPA_CLAUDE: ''}});
  const healthy = runDoctor();
  assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr);
  assert.match(healthy.stdout, /\[PASS] Node >= 22\.11/);
  assert.match(healthy.stdout, /\[PASS] Node para el curso: \d+\.\d+/);
  assert.match(healthy.stdout, /\[PASS] Programa node: .* lo usa node-version, list-lab, reset-notes/);
  assert.match(healthy.stdout, /\[WARN] Agente de review: Falta mentor\.config\.json/);
  catalog.doctor.push(
    {name: 'Herramienta que no existe', command: 'definitely-not-installed-mentor', hint: 'Instalala.'},
    {name: 'Node del futuro', command: 'node', versionPattern: 'v(\\d+)', min: '999'},
    {name: 'Opcional', command: 'definitely-not-installed-mentor', required: false},
  );
  catalog.commands.broken = {command: 'also-not-installed-mentor'};
  write(root, 'course/catalog.json', catalog);
  const broken = runDoctor();
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /\[FAIL] Herramienta que no existe: “definitely-not-installed-mentor” no está instalado/);
  assert.match(broken.stderr, /\[FAIL] Node del futuro: \d+; hace falta 999 o más/);
  assert.match(broken.stdout, /\[WARN] Opcional:/);
  assert.match(broken.stderr, /\[FAIL] Programa also-not-installed-mentor: .* lo usa broken/);
  assert.ok(!fs.existsSync(path.join(root, 'course-state.json')));
});
