#!/usr/bin/env node
// npm run course:check -- <ID>: runs the checks of one stage and records the result with a hash of
// its evidence, so the dashboard knows when files changed after the check.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, IGNORED_NAMES, evaluateFileCheck, evidenceSnapshot, getModule, load, readJson, save} from './lib.mjs';
import {CORE_CHECK_COMMANDS, availableOnThisPlatform, courseCommands, resolveCommand, runtimePath} from './commands.mjs';

const key = process.argv[2];
if (!key) {
  console.error('npm run course:check -- <ID>');
  process.exit(2);
}

// The core contributes the doctor; every other command check names a command of course/catalog.json.
const coreCommands = {
  doctor: () => ({executable: process.execPath, args: [path.join(ROOT, 'scripts/doctor.mjs')], cwd: ROOT}),
};

function walk(directory, accumulator = []) {
  if (!fs.existsSync(directory)) return accumulator;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, accumulator);
    else accumulator.push(path.relative(ROOT, file).split(path.sep).join('/'));
  }
  return accumulator;
}

function globRegex(pattern) {
  let source = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  source = source
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${source}$`);
}

function by(object, key) {
  return key.split('.').reduce((value, part) => value?.[part], object);
}

function runAllowedProcess(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    env: {...process.env, PATH: runtimePath(), FORCE_COLOR: '0'},
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) return {pass: false, detail: result.error.message};
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (/\[NOT RUN]/i.test(output)) {
    return {pass: false, status: 'NOT RUN', detail: 'el entorno requerido no está disponible'};
  }
  if (result.status === 0 && /(\bskipped?\b|No tests found, exiting with code 0)/i.test(output)) {
    return {pass: false, status: 'SKIP', detail: 'la suite informó tests omitidos; no cuenta como validación completa'};
  }
  return {pass: result.status === 0, detail: result.status === 0 ? 'comando completado' : `exit ${result.status}`};
}

function runFixedCommand(id, module, catalog) {
  if (CORE_CHECK_COMMANDS.has(id) && Object.hasOwn(coreCommands, id)) {
    const {executable, args, cwd} = coreCommands[id]();
    return runAllowedProcess(executable, args, cwd);
  }
  const definition = courseCommands(catalog).commands.get(id);
  if (!definition) return {pass: false, detail: 'comando fuera de la allowlist'};
  if (!availableOnThisPlatform(definition)) return {pass: false, status: 'NOT RUN', detail: `sólo corre en ${definition.platforms.join(', ')}`};
  let resolved;
  try {
    resolved = resolveCommand(definition, module);
  } catch (error) {
    return {pass: false, status: 'NOT RUN', detail: error.message};
  }
  return runAllowedProcess(resolved.executable, resolved.args, resolved.cwd);
}

function evaluate(check, files, module, catalog) {
  const fullPath = check.path ? path.join(ROOT, check.path) : null;

  if (check.kind === 'file' || check.kind === 'contains') return evaluateFileCheck(check);

  if (check.kind === 'jsonkey') {
    try {
      const pass = by(readJson(fullPath), check.key) != null;
      return {pass, detail: pass ? 'key presente' : 'key ausente'};
    } catch (error) {
      return {pass: false, detail: error.message};
    }
  }

  if (check.kind === 'glob') {
    const matches = files.filter(file => globRegex(check.path).test(file)).length;
    const minimum = check.min || 1;
    return {pass: matches >= minimum, detail: `${matches} match(es); mínimo ${minimum}`};
  }

  if (check.kind === 'command') return runFixedCommand(check.command, module, catalog);
  if (check.kind === 'manual') return {pass: false, status: 'NOT RUN', detail: check.detail || 'requiere evidencia manual'};
  return {pass: false, detail: `kind desconocido: ${check.kind}`};
}

try {
  const {catalog, state} = load();
  const module = getModule(catalog, key);
  const files = walk(ROOT);
  const results = module.checks.map((check, index) => {
    const result = evaluate(check, files, module, catalog);
    return {
      id: `AUTO${index + 1}`,
      path: check.kind === 'command' ? `command:${check.command}` : check.path,
      label: check.label || null,
      required: check.required !== false,
      status: result.status || (result.pass ? 'PASS' : 'FAIL'),
      ...result,
    };
  });
  const requiredResults = results.filter(result => result.required);
  const passed = requiredResults.filter(result => result.pass).length;
  results.forEach(result => console.log(`[${result.status}] ${result.path}: ${result.detail}`));
  state.modules[module.id] ||= {status: 'not_started', review: 'pending', manualCriteria: {}, notes: '', lastCheck: null};
  const record = state.modules[module.id];
  if (record.lastCheck) {
    record.checkHistory = [record.lastCheck, ...(record.checkHistory || [])].slice(0, 30);
  }
  const snapshot = evidenceSnapshot(module);
  record.lastCheck = {
    at: new Date().toISOString(),
    passed,
    total: requiredResults.length,
    results,
    evidenceHash: snapshot.hash,
    evidenceFiles: snapshot.files,
  };
  save(state);
  console.log(`\n${passed}/${requiredResults.length} checks obligatorios`);
  if (passed !== requiredResults.length || requiredResults.length === 0) process.exitCode = 1;
} catch (error) {
  console.error(`[course:check] ${error.message}`);
  process.exitCode = 1;
}
