#!/usr/bin/env node
// npm run check: the course is consistent and the engine is intact. It reads; the only things it runs
// are node --check and the core's tests, which work on disposable copies of the repository.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateRoutes} from '../dashboard/course-routes.mjs';
import {CATALOG, IGNORED_NAMES, ROOT, learningOrder, load, moduleDir, readJson} from './lib.mjs';
import {CORE_CHECK_COMMANDS, CORE_COMMAND_IDS, courseCommands, doctorTools} from './commands.mjs';

const skipTests = process.argv.includes('--skip-tests');
const SCRIPTS = ['dashboard', 'doctor', 'check', 'course', 'course:check'];
const REQUIRED_DOCS = [
  '00-EMPEZA-ACA.md', '01-BRIEF.md', '02-CONCEPTOS.md', '03-GUIA-DE-LENGUAJE.md', '04-ARQUITECTURA.md',
  '05-EJEMPLOS.md', '06-PLAN-DE-IMPLEMENTACION.md', '07-CRITERIOS-DE-ACEPTACION.md', '08-PLAN-DE-PRUEBAS.md',
  '09-FALLOS-COMUNES.md', '10-FUENTES.md', '11-PROMPT-DE-REVIEW.md',
];
const CHECK_KINDS = new Set(['file', 'contains', 'jsonkey', 'glob', 'command', 'manual']);

let failures = 0;
const pass = message => console.log(`[PASS] ${message}`);
const warn = message => console.log(`[WARN] ${message}`);
const fail = message => {
  failures += 1;
  console.error(`[FAIL] ${message}`);
};
const run = (command, args) => spawnSync(command, args, {cwd: ROOT, stdio: 'inherit', shell: false}).status === 0;
const relative = file => path.relative(ROOT, file).split(path.sep).join('/');

function walk(directory, accept, skip = new Set(), accumulator = []) {
  if (!fs.existsSync(directory)) return accumulator;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (IGNORED_NAMES.has(entry.name) || skip.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, accept, skip, accumulator);
    else if (entry.isFile() && accept(entry.name)) accumulator.push(full);
  }
  return accumulator;
}

// Relative links of a Markdown file whose target does not exist. Code blocks and inline code are skipped.
function brokenLinks(file) {
  const text = fs.readFileSync(file, 'utf8')
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
  const broken = [];
  for (const [, target] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
    let decoded = target;
    try { decoded = decodeURI(target); } catch {}
    if (!fs.existsSync(path.resolve(path.dirname(file), decoded))) broken.push(target);
  }
  return broken;
}

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  major > 22 || (major === 22 && minor >= 11)
    ? pass(`Node >= 22.11 (${process.versions.node})`)
    : fail(`Node >= 22.11 requerido; detectado ${process.versions.node}. Usá la versión de .nvmrc.`);

  const {catalog, state} = load();
  const modules = catalog.modules;
  const ids = new Set(modules.map(module => module.id));

  // ---------- catalog ----------
  if (!fs.existsSync(CATALOG)) {
    pass('sin course/catalog.json todavía: el curso está vacío');
  } else {
    const raw = readJson(CATALOG);
    if (!raw.tracks || typeof raw.tracks !== 'object' || Array.isArray(raw.tracks)) fail('course/catalog.json: "tracks" tiene que ser un objeto {id: {title, description}}');
    if (raw.routes !== undefined && !Array.isArray(raw.routes)) fail('course/catalog.json: "routes" tiene que ser una lista');
    for (const [track, info] of Object.entries(catalog.tracks)) {
      if (!/^[a-z][a-z0-9-]*$/.test(track)) fail(`track "${track}": el id va en minúsculas, números y guiones`);
      if (typeof info?.title !== 'string' || !info.title.trim()) fail(`track ${track}: falta title`);
    }
  }
  const courseRoot = path.join(ROOT, 'course');
  if (fs.existsSync(courseRoot)) {
    for (const entry of fs.readdirSync(courseRoot, {withFileTypes: true})) {
      if (!entry.isDirectory() || Object.hasOwn(catalog.tracks, entry.name)) continue;
      const hasModules = fs.readdirSync(path.join(courseRoot, entry.name), {withFileTypes: true})
        .some(child => child.isDirectory() && fs.existsSync(path.join(courseRoot, entry.name, child.name, 'module.json')));
      if (hasModules) fail(`course/${entry.name}/ tiene módulos pero no figura en "tracks" de course/catalog.json`);
    }
  }

  if (!modules.length) {
    pass('todavía no hay etapas: creá la primera con module-builder (06-CREAR-MODULOS.md)');
  } else {
    ids.size === modules.length ? pass(`${modules.length} etapa(s) con id único`) : fail('hay IDs de etapa repetidos entre tracks');
    validateRoutes(catalog);
    pass(`${catalog.routes.length} recorrido(s) sin duplicados y con dependencias en orden`);
  }

  // ---------- state ----------
  const unknown = Object.keys(state.modules).filter(id => !ids.has(id));
  if (unknown.length) warn(`course-state.json guarda progreso de etapas que ya no están en el catálogo: ${unknown.join(', ')}`);
  if (state.currentModule && !ids.has(state.currentModule)) warn(`la etapa actual (${state.currentModule}) ya no está en el catálogo`);

  // ---------- dependencies ----------
  let dependencyProblems = 0;
  for (const module of modules) {
    for (const dependency of module.depends) {
      if (!ids.has(dependency)) {
        dependencyProblems += 1;
        fail(`${module.id}: dependencia desconocida ${dependency}`);
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = module => {
    if (!module || visited.has(module.id)) return;
    if (visiting.has(module.id)) {
      dependencyProblems += 1;
      fail(`ciclo de dependencias en ${module.id}`);
      return;
    }
    visiting.add(module.id);
    for (const dependency of module.depends) visit(modules.find(item => item.id === dependency));
    visiting.delete(module.id);
    visited.add(module.id);
  };
  modules.forEach(visit);
  if (modules.length && !dependencyProblems) pass('dependencias conocidas y acíclicas');
  for (const track of Object.keys(catalog.tracks)) {
    const orders = modules.filter(module => module.track === track).map(learningOrder);
    if (new Set(orders).size !== orders.length) fail(`track ${track}: dos etapas comparten order`);
  }

  // ---------- commands and doctor ----------
  const commands = courseCommands(catalog);
  const tools = doctorTools(catalog);
  commands.problems.forEach(problem => fail(`course/catalog.json "commands" · ${problem}`));
  tools.problems.forEach(problem => fail(`course/catalog.json "doctor" · ${problem}`));
  if (commands.commands.size || tools.tools.length) {
    pass(`${commands.commands.size} comando(s) del curso y ${tools.tools.length} herramienta(s) del doctor`);
  }
  const dashboardIds = new Set([...CORE_COMMAND_IDS, ...commands.commands.keys()]);
  const checkIds = new Set([...CORE_CHECK_COMMANDS, ...commands.commands.keys()]);

  // ---------- modules ----------
  let moduleProblems = 0;
  const moduleFail = message => {
    moduleProblems += 1;
    fail(message);
  };
  for (const module of modules) {
    const directory = moduleDir(module);
    const missing = REQUIRED_DOCS.filter(name => !fs.existsSync(path.join(directory, name)));
    if (missing.length) moduleFail(`${module.id}: faltan ${missing.join(', ')}`);
    if (module.fullDocumentation && !fs.existsSync(path.join(directory, '12-GUIA-WEB.md'))) {
      moduleFail(`${module.id}: fullDocumentation requiere 12-GUIA-WEB.md`);
    }
    const criteriaDoc = path.join(directory, '07-CRITERIOS-DE-ACEPTACION.md');
    if (fs.existsSync(criteriaDoc)) {
      const text = fs.readFileSync(criteriaDoc, 'utf8');
      for (const criterion of module.criteria) {
        if (!text.includes(criterion)) moduleFail(`${module.id}: 07 no copia textual el criterio «${criterion}»`);
      }
    }
    for (const id of module.recommendedCommands || []) {
      if (!dashboardIds.has(id)) moduleFail(`${module.id}: recommendedCommands nombra “${id}”, que no es un comando del core ni del curso`);
    }
    module.checks.forEach((check, index) => {
      if (!CHECK_KINDS.has(check?.kind)) return moduleFail(`${module.id}: el check ${index + 1} es de tipo desconocido ${check?.kind}`);
      if (check.kind === 'command' && !checkIds.has(check.command)) {
        moduleFail(`${module.id}: el check ${index + 1} corre “${check.command}”, que no es un comando del curso`);
      }
      if (['file', 'contains', 'jsonkey', 'glob'].includes(check.kind) && typeof check.path !== 'string') {
        moduleFail(`${module.id}: el check ${index + 1} necesita "path"`);
      } else if (['file', 'contains'].includes(check.kind) && !/[*?[]/.test(check.path)) {
        const target = path.resolve(ROOT, check.path);
        if (!target.startsWith(`${ROOT}${path.sep}`)) moduleFail(`${module.id}: el check ${index + 1} apunta fuera del repo`);
        else if (!fs.existsSync(target)) moduleFail(`${module.id}: falta la plantilla del laboratorio ${check.path}`);
      }
    });
  }
  if (modules.length && !moduleProblems) pass('documentos numerados, criterios textuales, comandos y plantillas en orden');

  // ---------- local links ----------
  const markdown = [
    ...walk(courseRoot, name => name.endsWith('.md')),
    ...fs.readdirSync(ROOT).filter(name => name.endsWith('.md')).map(name => path.join(ROOT, name)),
  ];
  let broken = 0;
  for (const file of markdown) {
    for (const target of brokenLinks(file)) {
      broken += 1;
      fail(`${relative(file)}: el link ${target} no existe`);
    }
  }
  if (!broken) pass(`${markdown.length} documento(s) sin links locales rotos`);

  // ---------- repository ----------
  const jsonFiles = walk(ROOT, name => name.endsWith('.json'), new Set(['private']));
  let invalidJson = 0;
  for (const file of jsonFiles) {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      invalidJson += 1;
      fail(`JSON inválido ${relative(file)}: ${error.message}`);
    }
  }
  if (!invalidJson) pass(`${jsonFiles.length} JSON válidos`);

  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  JSON.stringify(Object.keys(rootPackage.scripts || {})) === JSON.stringify(SCRIPTS)
    ? pass(`lista cerrada de ${SCRIPTS.length} scripts`)
    : fail(`package.json expone exactamente ${SCRIPTS.join(', ')}; los comandos de un curso van en course/catalog.json`);

  const engine = ['scripts', 'tools', 'companion', 'dashboard']
    .flatMap(directory => walk(path.join(ROOT, directory), name => /\.(mjs|js)$/.test(name)));
  let syntax = 0;
  for (const file of engine) {
    if (!run(process.execPath, ['--check', file])) {
      syntax += 1;
      fail(`sintaxis ${relative(file)}`);
    }
  }
  if (!syntax) pass(`sintaxis de ${engine.length} archivos del core`);

  if (skipTests) {
    console.log('[SKIP] pruebas del core (--skip-tests)');
  } else {
    const tests = fs.readdirSync(path.join(ROOT, 'scripts/tests'))
      .filter(file => file.endsWith('.test.mjs'))
      .map(file => path.join(ROOT, 'scripts/tests', file));
    run(process.execPath, ['--test', ...tests])
      ? pass('pruebas del core: evidencia, cierre, comandos, HTTP local y Chispa')
      : fail('pruebas del core');
  }
} catch (error) {
  fail(error.stack || error.message);
}

if (failures) {
  console.error(`\n${failures} fallo(s)`);
  process.exit(1);
}
console.log('\nRepositorio consistente.');
