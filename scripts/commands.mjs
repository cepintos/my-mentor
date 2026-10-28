// Everything that turns configuration into a process to spawn:
// - the review agent and the editor of mentor.config.json (local, chosen by the learner);
// - the commands and doctor tools of course/catalog.json (part of the course, versioned with it).
// The browser never reaches this file with anything but an id: executables, arguments and working
// directories always come from these two files, and every process runs with shell: false.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, safe} from './lib.mjs';

// Ids defined by the core in tools/dashboard-server.mjs. A course cannot redefine them.
export const CORE_COMMAND_IDS = new Set(['doctor', 'check', 'course-check', 'mentor-explain', 'mentor-next', 'mentor-review']);
// Ids a "command" check of a module.json may name besides the course's own commands.
export const CORE_CHECK_COMMANDS = new Set(['doctor']);
export const COMMAND_GROUPS = ['quality', 'course', 'maintenance'];

const COMMAND_ID = /^[a-z][a-z0-9-]{1,39}$/;
const RESOURCE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const HAS_PLACEHOLDER = /\{(module|deliverable)\}/;
const PLACEHOLDERS = /\{(module|deliverable)\}/g;

const isStringList = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// The node that runs the dashboard goes first, so "node" in a command is always that one.
export const runtimePath = () => [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter);

export function findExecutable(name, searchPath = runtimePath()) {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const directory of String(searchPath || '').split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

// ---------- mentor.config.json ----------

const MENTOR_CONFIG = path.join(ROOT, 'mentor.config.json');

export function localConfig() {
  try {
    return {config: JSON.parse(fs.readFileSync(MENTOR_CONFIG, 'utf8')), problem: null};
  } catch (error) {
    return {config: null, problem: error.code === 'ENOENT'
      ? 'Falta mentor.config.json: copiá mentor.config.example.json y elegí tu agente.'
      : `mentor.config.json inválido: ${error.message}`};
  }
}

// The agent that answers the mentor buttons. Re-read on every request, so switching needs no restart.
export function mentorAgent() {
  const {config, problem} = localConfig();
  if (!config) return {agent: null, reason: problem};
  const id = config?.active;
  const entry = typeof id === 'string' && isRecord(config.agents) && Object.hasOwn(config.agents, id) ? config.agents[id] : null;
  if (!entry) return {agent: null, reason: `mentor.config.json no define el agente activo “${id}”.`};
  if (typeof entry.command !== 'string' || !entry.command || !isStringList(entry.args ?? [])) {
    return {agent: null, reason: `El agente “${id}” necesita "command" (texto) y "args" (lista de textos).`};
  }
  const executable = path.isAbsolute(entry.command) ? entry.command : findExecutable(entry.command);
  if (!executable) return {agent: null, reason: `“${entry.command}” no está disponible en PATH.`};
  return {
    agent: {
      id,
      label: typeof entry.label === 'string' && entry.label ? entry.label : id,
      command: entry.command,
      executable,
      args: entry.args ?? [],
      prompt: entry.prompt === 'arg' ? 'arg' : 'stdin',
    },
    reason: null,
  };
}

// Optional "editor" entry. It only ever opens a lab file the catalog names.
export function editorTool() {
  const entry = localConfig().config?.editor;
  if (!isRecord(entry)) return null;
  if (typeof entry.command !== 'string' || !entry.command || !isStringList(entry.args ?? [])) return null;
  const executable = path.isAbsolute(entry.command) ? entry.command : findExecutable(entry.command);
  if (!executable) return null;
  return {label: typeof entry.label === 'string' && entry.label ? entry.label : entry.command, executable, args: entry.args ?? []};
}

// ---------- course/catalog.json: commands and doctor ----------

// A course names a program on PATH ("python3") or a file inside the repo ("learning-labs/x/run.sh").
// Absolute paths would tie the course to one machine, so they are refused.
function programProblem(command) {
  if (typeof command !== 'string' || !command.trim()) return '"command" tiene que ser un texto';
  if (path.isAbsolute(command)) return '"command" no puede ser una ruta absoluta: usá un programa del PATH o un archivo del repo';
  if (/[\s;&|`$<>*?]/.test(command)) return '"command" es un solo programa, sin espacios ni símbolos de shell';
  if (/[/\\]/.test(command)) {
    try { safe(command); } catch { return '"command" queda fuera del repo'; }
  }
  return null;
}

function commandProblem(id, entry) {
  if (!COMMAND_ID.test(id)) return 'el id usa minúsculas, números y guiones (2 a 40 caracteres)';
  if (CORE_COMMAND_IDS.has(id)) return 'ese id es del core';
  if (!isRecord(entry)) return 'tiene que ser un objeto';
  const program = programProblem(entry.command);
  if (program) return program;
  if (entry.args !== undefined && !isStringList(entry.args)) return '"args" tiene que ser una lista de textos';
  if ((entry.args || []).some(arg => arg.length > 2000)) return 'un argumento supera 2000 caracteres';
  if (entry.cwd !== undefined) {
    if (typeof entry.cwd !== 'string' || path.isAbsolute(entry.cwd)) return '"cwd" es una carpeta relativa al repo';
    try { safe(entry.cwd); } catch { return '"cwd" queda fuera del repo'; }
  }
  for (const key of ['label', 'description', 'confirmation']) {
    if (entry[key] !== undefined && typeof entry[key] !== 'string') return `"${key}" tiene que ser un texto`;
  }
  if (entry.group !== undefined && !COMMAND_GROUPS.includes(entry.group)) return `"group" es uno de: ${COMMAND_GROUPS.join(', ')}`;
  if (entry.long !== undefined && typeof entry.long !== 'boolean') return '"long" es true o false';
  if (entry.platforms !== undefined && !(isStringList(entry.platforms) && entry.platforms.length && entry.platforms.every(item => PLATFORMS.has(item)))) {
    return '"platforms" es una lista con darwin, linux o win32';
  }
  if (entry.resources !== undefined && !(isStringList(entry.resources) && entry.resources.every(item => RESOURCE_ID.test(item)))) {
    return '"resources" es una lista de ids cortos en minúsculas';
  }
  return null;
}

// Valid commands by id, plus a description of every entry that was refused (never run).
export function courseCommands(catalog) {
  const commands = new Map();
  const raw = catalog?.commands;
  if (raw !== undefined && !isRecord(raw)) return {commands, problems: ['"commands" tiene que ser un objeto {id: definición}']};
  const problems = [];
  for (const [id, entry] of Object.entries(raw || {})) {
    const problem = commandProblem(id, entry);
    if (problem) {
      problems.push(`${id}: ${problem}`);
      continue;
    }
    const args = entry.args || [];
    commands.set(id, {
      id,
      label: entry.label?.trim() || id,
      description: entry.description || '',
      group: entry.group || 'course',
      long: Boolean(entry.long),
      confirmation: entry.confirmation || null,
      platforms: entry.platforms || null,
      resources: entry.resources || ['workspace'],
      requiresModule: args.some(arg => HAS_PLACEHOLDER.test(arg)),
      command: entry.command,
      args,
      cwd: entry.cwd || '.',
    });
  }
  return {commands, problems};
}

export const availableOnThisPlatform = definition => !definition.platforms || definition.platforms.includes(process.platform);

// {deliverable} stands for the stage's deliverable only when it is one path inside the repo.
function deliverableArgument(module) {
  const deliverable = String(module?.deliverable || '').trim();
  if (!deliverable || path.isAbsolute(deliverable) || /\s\+\s|[*?]/.test(deliverable)) {
    throw new Error(`${module?.id || 'La etapa'} no declara un entregable con una sola ruta del repo`);
  }
  safe(deliverable);
  return deliverable.split(path.sep).join('/');
}

// Arguments with {module} and {deliverable} filled in from the catalog, never from a request.
export function commandArgs(definition, module) {
  if (definition.requiresModule && !module) throw new Error(`“${definition.label}” necesita una etapa`);
  return definition.args.map(arg => arg.replace(PLACEHOLDERS, (_, name) => (name === 'module' ? module.id : deliverableArgument(module))));
}

export function resolveProgram(command) {
  if (/[/\\]/.test(command)) {
    const file = safe(command);
    if (!fs.existsSync(file)) throw new Error(`No existe ${command}`);
    return file;
  }
  const found = findExecutable(command);
  if (!found) throw new Error(`“${command}” no está en PATH. Corré Diagnosticar entorno.`);
  return found;
}

export function resolveCommand(definition, module) {
  const args = commandArgs(definition, module);
  const cwd = safe(definition.cwd);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`No existe la carpeta ${definition.cwd}`);
  return {executable: resolveProgram(definition.command), args, cwd};
}

function doctorProblem(entry) {
  if (!isRecord(entry)) return 'tiene que ser un objeto';
  if (typeof entry.name !== 'string' || !entry.name.trim() || /[:\r\n]/.test(entry.name)) return '"name" es un texto sin ":"';
  const program = programProblem(entry.command);
  if (program) return program;
  if (entry.args !== undefined && !isStringList(entry.args)) return '"args" tiene que ser una lista de textos';
  if (entry.versionPattern !== undefined) {
    if (typeof entry.versionPattern !== 'string') return '"versionPattern" es una expresión regular escrita como texto';
    try { new RegExp(entry.versionPattern); } catch (error) { return `"versionPattern" inválido: ${error.message}`; }
  }
  if (entry.min !== undefined && !/^\d+(\.\d+){0,2}$/.test(String(entry.min))) return '"min" es una versión como 3.12';
  if (entry.hint !== undefined && typeof entry.hint !== 'string') return '"hint" tiene que ser un texto';
  if (entry.required !== undefined && typeof entry.required !== 'boolean') return '"required" es true o false';
  return null;
}

// Tools the course needs, checked by the doctor: a program, how to ask its version and the minimum.
export function doctorTools(catalog) {
  const raw = catalog?.doctor;
  if (raw !== undefined && !Array.isArray(raw)) return {tools: [], problems: ['"doctor" tiene que ser una lista']};
  const tools = [];
  const problems = [];
  (raw || []).forEach((entry, index) => {
    const problem = doctorProblem(entry);
    if (problem) {
      problems.push(`${typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : `doctor[${index}]`}: ${problem}`);
      return;
    }
    tools.push({
      name: entry.name.trim(),
      command: entry.command,
      args: entry.args || ['--version'],
      versionPattern: entry.versionPattern || null,
      min: entry.min ? String(entry.min) : null,
      required: entry.required !== false,
      hint: entry.hint || null,
    });
  });
  return {tools, problems};
}
