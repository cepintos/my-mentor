#!/usr/bin/env node
// Read-only diagnosis: reports what is installed and configured; it never installs or changes anything.
// The core checks Node, git, the review agent, Chispa and the editor. The course adds its own tools in
// the "doctor" list of course/catalog.json, and every program its commands need is looked up too.
import {spawnSync} from 'node:child_process';
import {ROOT, loadCatalog} from './lib.mjs';
import {availableOnThisPlatform, courseCommands, doctorTools, editorTool, findExecutable, localConfig, mentorAgent, resolveProgram, runtimePath} from './commands.mjs';

let failures = 0;
let warnings = 0;

function report(status, name, detail) {
  const stream = status === 'FAIL' ? process.stderr : process.stdout;
  stream.write(`[${status}] ${name}: ${detail}\n`);
  if (status === 'FAIL') failures += 1;
  if (status === 'WARN') warnings += 1;
}

function probe(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: ROOT, encoding: 'utf8', shell: false, timeout: 15000, env: {...process.env, PATH: runtimePath()},
  });
  return {ok: result.status === 0, text: `${result.stdout || ''}${result.stderr || ''}`.trim(), error: result.error?.message};
}

function versionAtLeast(actual, expected) {
  const parse = value => String(value).match(/\d+(?:\.\d+){0,2}/)?.[0].split('.').map(Number) || [];
  const left = parse(actual);
  const right = parse(expected);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

const firstLine = text => String(text || '').split(/\r?\n/).find(Boolean) || 'sin salida';

function checkTool(tool) {
  const failure = tool.required ? 'FAIL' : 'WARN';
  let executable;
  try {
    executable = resolveProgram(tool.command);
  } catch {
    return report(failure, tool.name, `“${tool.command}” no está instalado o no está en PATH`);
  }
  const result = probe(executable, tool.args);
  if (!result.ok) return report(failure, tool.name, firstLine(result.error || result.text));
  if (!tool.min && !tool.versionPattern) return report('PASS', tool.name, firstLine(result.text));
  const match = result.text.match(tool.versionPattern ? new RegExp(tool.versionPattern) : /\d+(?:\.\d+){0,2}/);
  const version = match?.[1] || match?.[0];
  if (!version) return report(failure, tool.name, `no encontré la versión en: ${firstLine(result.text)}`);
  if (tool.min && !versionAtLeast(version, tool.min)) return report(failure, tool.name, `${version}; hace falta ${tool.min} o más`);
  return report('PASS', tool.name, version);
}

report(versionAtLeast(process.version.slice(1), '22.11') ? 'PASS' : 'FAIL', 'Node >= 22.11', process.version);

const git = findExecutable('git');
const gitProbe = git ? probe(git, ['--version']) : null;
report(gitProbe?.ok ? 'PASS' : 'WARN', 'git', gitProbe?.ok ? firstLine(gitProbe.text) : 'no está en PATH; Chispa no va a poder ver qué cambió en tu laboratorio');

const {agent, reason} = mentorAgent();
report(agent ? 'PASS' : 'WARN', 'Agente de review', agent
  ? `${agent.label} (${agent.executable})`
  : `${reason} Sin agente, el review se pide pegando 11-PROMPT-DE-REVIEW.md en la herramienta que uses.`);

const claude = process.env.CHISPA_CLAUDE || findExecutable('claude');
report(claude ? 'PASS' : 'WARN', 'Claude Code para Chispa', claude || 'no está en PATH; el resto del dashboard funciona igual');

if (localConfig().config?.editor) {
  const editor = editorTool();
  report(editor ? 'PASS' : 'WARN', 'Editor', editor ? `${editor.label} (${editor.executable})` : 'el "editor" de mentor.config.json no está en PATH');
}

let catalog = null;
try {
  catalog = loadCatalog();
} catch (error) {
  report('FAIL', 'Catálogo del curso', error.message);
}

if (catalog) {
  const {tools, problems: toolProblems} = doctorTools(catalog);
  for (const problem of toolProblems) report('FAIL', 'Doctor del curso', problem);
  for (const tool of tools) checkTool(tool);

  const {commands, problems: commandProblems} = courseCommands(catalog);
  for (const problem of commandProblems) report('FAIL', 'Comandos del curso', problem);
  const programs = new Map();
  for (const command of commands.values()) {
    if (availableOnThisPlatform(command)) programs.set(command.command, [...(programs.get(command.command) || []), command.id]);
  }
  for (const [program, ids] of programs) {
    try {
      report('PASS', `Programa ${program}`, `${resolveProgram(program)} · lo usa ${ids.join(', ')}`);
    } catch (error) {
      report('FAIL', `Programa ${program}`, `${error.message.replace(/ Corré Diagnosticar entorno\.$/, '')} · lo usa ${ids.join(', ')}`);
    }
  }
  if (!catalog.modules.length) report('WARN', 'Curso', 'todavía no hay etapas; creá la primera con module-builder (06-CREAR-MODULOS.md)');
}

console.log(`\nDoctor: ${failures} fallo(s), ${warnings} advertencia(s).`);
if (failures) process.exitCode = 1;
