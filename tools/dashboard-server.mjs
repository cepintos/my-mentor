#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, execFile} from 'node:child_process';
import {
  ROOT,
  IGNORED_NAMES,
  completionRequirements,
  courseDocs,
  courseWideDocs,
  docs,
  evidenceSnapshot,
  getModule,
  isLabFile,
  labStatus,
  load,
  mentorDocs,
  moduleDir,
  readingList,
  readingStatus,
  referenceDocs,
  safe,
  save,
  stats,
  trackDocs,
} from '../scripts/lib.mjs';
import {
  availableOnThisPlatform,
  commandArgs,
  courseCommands,
  doctorTools,
  editorTool,
  mentorAgent,
  resolveCommand,
  runtimePath,
} from '../scripts/commands.mjs';
import {bootText} from '../companion/boot.mjs';
import {claudeExecutable, runTurn} from '../companion/claude.mjs';
import {chispaConfig, CONVERSATIONS_DIR, PROFILE_FILE} from '../companion/config.mjs';
import {approveShard, discardShard, listShards, recordRun, summary} from '../companion/memory.mjs';
import {progressSnapshot} from '../companion/progress.mjs';

const cli = process.argv.slice(2);
const portIndex = cli.indexOf('--port');
const port = portIndex >= 0 ? Number(cli[portIndex + 1]) : 4173;
const host = '127.0.0.1';
const shouldOpen = !cli.includes('--no-open');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Puerto inválido');

const runDirectory = path.join(ROOT, '.course', 'runs');
fs.mkdirSync(runDirectory, {recursive: true});

const script = name => path.join(ROOT, 'scripts', `${name}.mjs`);
const platformNames = {darwin: 'macOS', linux: 'Linux', win32: 'Windows'};

function learnerProfile() {
  try {
    const text = fs.readFileSync(PROFILE_FILE, 'utf8').trim();
    return text ? text.slice(0, 4000) : null;
  } catch {
    return null;
  }
}

// El agente del mentor lo elige quien estudia en mentor.config.json (local, fuera de git).
// El navegador nunca elige ejecutable ni argumentos: sólo dispara una acción del allowlist.
function mentorPrompt(module, contextPath, objective) {
  const profile = learnerProfile();
  return `
Sos el mentor de un repositorio de aprendizaje code-first. Respondé en español, salvo que el perfil de quien estudia pida otro idioma.

Módulo seleccionado: ${module.id} — ${module.title}
Entregable: ${module.deliverable}
Objetivo del botón: ${objective}
Archivo de contexto elegido automáticamente por el dashboard: ${contextPath}

Reglas obligatorias:
- Leé AGENTS.md y respetá sus instrucciones.
- Trabajá en modo read-only: no edites, parches, formatees ni generes archivos.
- Usá el archivo de contexto incluido abajo como punto de entrada y consultá sólo los archivos del módulo que éste indique.
- No afirmes que un build, test o dispositivo pasó sin salida real.
- Guiá un paso técnico por vez; no entregues archivos de producción completos.
- Si revisás código, citá archivo y línea y clasificá BLOCKER, MAJOR, MINOR o SUGGESTION.
${profile ? `\n<learner_profile path="course/00-PERFIL.md">\n${profile}\n</learner_profile>\n` : ''}
<context_file path="${contextPath}">
${fs.readFileSync(safe(contextPath), 'utf8')}
</context_file>
`;
}

// The core's own actions. A course adds its own in course/catalog.json "commands" (scripts/commands.mjs).
const coreCommands = {
  doctor: {label: 'Diagnosticar entorno', description: 'Comprueba Node, git, tu agente, Chispa y las herramientas que pide el curso, sin instalar ni modificar nada.', group: 'quality', args: () => [script('doctor')]},
  check: {label: 'Validar repositorio', description: 'Revisa catálogo, documentos, links, comandos y las pruebas del core.', group: 'quality', args: () => [script('check')], resources: ['workspace'], long: true},
  'course-check': {label: 'Validar esta etapa', description: 'Comprueba las evidencias de la etapa y registra su relación con los archivos actuales.', group: 'quality', args: module => [script('course-check'), module.id], requiresModule: true, resources: ['workspace']},
  'mentor-explain': {
    label: 'Explicame el concepto actual',
    description: 'Tu agente usa 02-CONCEPTOS como contexto y no edita código.',
    group: 'mentor',
    requiresModule: true,
    mentor: true,
    contextFile: '02-CONCEPTOS.md',
    objective: 'Elegí el concepto más inmediato para este módulo y explicalo con un ejemplo pequeño no copiable al entregable.',
  },
  'mentor-next': {
    label: 'Dame el próximo paso',
    description: 'Tu agente usa 06-PLAN-DE-IMPLEMENTACION y propone un único paso.',
    group: 'mentor',
    requiresModule: true,
    mentor: true,
    contextFile: '06-PLAN-DE-IMPLEMENTACION.md',
    objective: 'Inspeccioná el estado actual y proponé exactamente el próximo paso técnico verificable, sin implementarlo.',
  },
  'mentor-review': {
    label: 'Pedir review final al mentor',
    description: 'Tu agente usa 11-PROMPT-DE-REVIEW y revisa sin editar.',
    group: 'mentor',
    requiresModule: true,
    mentor: true,
    contextFile: '11-PROMPT-DE-REVIEW.md',
    objective: 'Realizá el review final solicitado por el archivo de contexto. No hagas cambios.',
    long: true,
  },
};

function commandDefinition(commandId, catalog) {
  if (typeof commandId !== 'string') return null;
  if (Object.hasOwn(coreCommands, commandId)) {
    const definition = coreCommands[commandId];
    return {...definition, id: commandId, resources: definition.resources || [], core: true};
  }
  const course = courseCommands(catalog).commands.get(commandId);
  return course ? {...course, course: true} : null;
}

const runs = new Map();
let sequence = 0;
const eventClients = new Set();

function sendJson(response, status, value) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  response.end(JSON.stringify(value));
}

function send(response, status, value, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {'content-type': contentType, 'cache-control': 'no-store'});
  response.end(value);
}

function broadcast(type, value) {
  const message = `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
  for (const client of eventClients) client.write(message);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Payload demasiado grande');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function assertLocalRequest(request, write = false) {
  const requestHost = String(request.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestHost)) throw new Error('Host no permitido');
  if (write) {
    const origin = request.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      throw new Error('Origin no permitido');
    }
    const contentType = String(request.headers['content-type'] || '');
    if (!contentType.startsWith('application/json')) throw new Error('Content-Type no permitido');
  }
}

function publicRun(run) {
  return {
    id: run.id,
    commandId: run.commandId,
    label: run.label,
    moduleId: run.moduleId,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    log: run.log,
    contextPath: run.contextPath,
    agent: run.agent,
    steps: run.steps,
    resources: run.resources,
  };
}

function persistRun(run) {
  fs.writeFileSync(path.join(runDirectory, `${run.id}.log`), run.log, 'utf8');
  const {state} = load();
  state.runs = [publicRun(run), ...(state.runs || [])]
    .slice(0, 30)
    .map(item => ({...item, log: item.log.slice(-8000)}));
  save(state);
  broadcast('course', {reason: 'run-completed', runId: run.id});
  // Failed checks and builds become incident drafts for Chispa; a later pass marks them recovered.
  try {
    if (recordRun(run)) broadcast('chispa', {type: 'memory'});
  } catch (error) {
    console.warn(`Chispa no pudo registrar la ejecución: ${error.message}`);
  }
}

function moduleCheckSteps(module) {
  return module.checks.map((check, index) => ({
    id: `check-${index + 1}`,
    label: check.label || (check.kind === 'command' ? `Prueba ejecutable: ${check.command}` : `Evidencia: ${path.basename(check.path || '')}`),
    status: index === 0 ? 'running' : 'queued',
    detail: check.kind === 'command' ? `commandId: ${check.command}` : `Ruta: ${check.path}`,
    technicalTarget: check.kind === 'command' ? `command:${check.command}` : check.path,
  }));
}

function mentorSteps(contextPath, agent) {
  return [
    {id: 'context', label: `Cargar ${path.basename(contextPath)}`, status: 'passed', detail: contextPath},
    {id: 'agent', label: `Iniciar ${agent.label}`, status: 'running', detail: 'Esperando la primera salida'},
    {id: 'response', label: 'Recibir la respuesta', status: 'queued', detail: 'Pendiente'},
  ];
}

function markMentorResponding(run) {
  const agentStep = run.steps.find(step => step.id === 'agent');
  if (agentStep?.status !== 'running') return;
  agentStep.status = 'passed';
  agentStep.detail = 'Respondiendo';
  const response = run.steps.find(step => step.id === 'response');
  response.status = 'running';
  response.detail = 'Recibiendo texto';
}

function advanceModuleCheck(run, text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\[(PASS|FAIL|SKIP|NOT RUN)]\s+(.+?)(?::\s+(.+))?$/);
    if (!match) continue;
    const [, outcome, target, detail = 'Completado'] = match;
    const index = run.steps.findIndex(step =>
      target.includes(step.technicalTarget || step.label)
      || (step.technicalTarget || step.label).includes(target));
    if (index < 0) continue;
    run.steps[index].status = outcome === 'PASS' ? 'passed' : outcome === 'FAIL' ? 'failed' : 'skipped';
    run.steps[index].detail = detail;
    const next = run.steps.find(step => step.status === 'queued');
    if (next) {
      next.status = 'running';
      next.detail = 'Comprobando';
    }
  }
}

function appendLog(run, value) {
  run.log = `${run.log}${value}`.slice(-200000);
  if (run.commandId === 'course-check') advanceModuleCheck(run, value);
  broadcast('run', publicRun(run));
}

const shown = arg => (path.isAbsolute(arg) && arg.startsWith(`${ROOT}${path.sep}`) ? path.relative(ROOT, arg).split(path.sep).join('/') : arg);

function startRun(commandId, moduleId, confirmation) {
  const {catalog} = load();
  const definition = commandDefinition(commandId, catalog);
  if (!definition) throw new Error('Comando no permitido');
  if (!availableOnThisPlatform(definition)) {
    throw new Error(`Comando disponible sólo en ${definition.platforms.map(item => platformNames[item] || item).join(', ')}`);
  }
  const {agent, reason: agentProblem} = definition.mentor ? mentorAgent() : {agent: null, reason: null};
  if (definition.mentor && !agent) throw new Error(agentProblem);
  if (definition.confirmation && confirmation !== commandId) throw new Error(`Confirmación requerida: ${definition.confirmation}`);

  const active = [...runs.values()].find(run => run.commandId === commandId && run.moduleId === (moduleId || null) && run.status === 'running');
  if (active) return active;

  const conflict = [...runs.values()].find(run =>
    run.status === 'running'
    && definition.resources.some(resource => run.resources.includes(resource)));
  if (conflict) throw new Error(`Recurso ocupado por “${conflict.label}”. Detenelo o esperá a que termine.`);

  const module = definition.requiresModule ? getModule(catalog, moduleId) : null;
  const contextPath = definition.contextFile
    ? path.relative(ROOT, path.join(moduleDir(module), definition.contextFile)).split(path.sep).join('/')
    : null;
  let executable;
  let args;
  let cwd = ROOT;
  let input = null;
  let header;
  if (definition.mentor) {
    const prompt = mentorPrompt(module, contextPath, definition.objective);
    executable = agent.executable;
    args = [...agent.args, ...(agent.prompt === 'arg' ? [prompt] : [])];
    if (agent.prompt === 'stdin') input = prompt;
    header = `$ ${[agent.command, ...agent.args].join(' ')} [${contextPath}] · ${agent.label}`;
  } else if (definition.course) {
    ({executable, args, cwd} = resolveCommand(definition, module));
    header = `$ ${[definition.command, ...args].join(' ')}${definition.cwd === '.' ? '' : `   (en ${definition.cwd})`}`;
  } else {
    executable = process.execPath;
    args = definition.args(module);
    header = `$ node ${args.map(shown).join(' ')}`;
  }
  const id = `${Date.now()}-${++sequence}`;
  const run = {
    id,
    commandId,
    label: definition.label,
    moduleId: module?.id || null,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    log: `${header}\n\n`,
    contextPath,
    agent: definition.mentor ? agent.label : null,
    steps: commandId === 'course-check'
      ? moduleCheckSteps(module)
      : definition.mentor ? mentorSteps(contextPath, agent) : [],
    child: null,
    resources: definition.resources,
  };

  const child = spawn(executable, args, {
    cwd,
    shell: false,
    detached: process.platform !== 'win32',
    env: {...process.env, PATH: runtimePath(), FORCE_COLOR: '0'},
  });
  run.child = child;
  runs.set(id, run);
  broadcast('run', publicRun(run));

  child.stdout.on('data', chunk => {
    if (definition.mentor) markMentorResponding(run);
    appendLog(run, chunk.toString());
  });
  child.stderr.on('data', chunk => appendLog(run, chunk.toString()));
  child.stdin.on('error', () => {});
  child.stdin.end(input ?? undefined);
  child.on('error', error => {
    appendLog(run, `\n[spawn error] ${error.message}\n`);
    run.spawnFailed = true;
    for (const step of run.steps.filter(step => ['queued', 'running'].includes(step.status))) {
      step.status = 'failed';
      step.detail = 'Ejecución interrumpida';
    }
  });
  child.on('close', code => {
    run.exitCode = code;
    const incomplete = /\[(?:SKIP|NOT RUN)]/i.test(run.log);
    run.status = !run.spawnFailed && incomplete ? 'partial' : code === 0 && !run.spawnFailed ? 'passed' : 'failed';
    run.endedAt = new Date().toISOString();
    for (const step of run.steps.filter(step => ['queued', 'running'].includes(step.status))) {
      step.status = run.status === 'passed' ? 'passed' : run.status === 'partial' ? 'skipped' : 'failed';
      step.detail = run.status === 'passed' ? 'Completado' : run.status === 'partial' ? 'No ejecutado o saltado' : 'No se pudo completar';
    }
    broadcast('run', publicRun(run));
    persistRun(run);
  });
  return run;
}

function stopRun(run) {
  if (run.status !== 'running') throw new Error('La ejecución no está activa');
  if (process.platform === 'win32') run.child.kill('SIGTERM');
  else process.kill(-run.child.pid, 'SIGTERM');
  run.log += '\n[dashboard] stop solicitado\n';
  broadcast('run', publicRun(run));
}

// Modules declare their own buttons; only ids that exist (core or course) are honored.
function recommendedCommands(module, known) {
  const recommended = new Set(['course-check']);
  for (const id of module.recommendedCommands || []) {
    if (known.has(id)) recommended.add(id);
  }
  return recommended;
}

const remediationByTool = [
  [/^Node/i, 'Instalá Node >= 22.11 con tu gestor preferido (la versión recomendada está en .nvmrc) y volvé a comprobar.'],
  [/^git$/i, 'Instalá git: Chispa lo usa para ver qué cambió en tu laboratorio.'],
  [/^Agente de review/i, 'Copiá mentor.config.example.json a mentor.config.json y elegí tu agente (04-COMO-USAR-EL-MENTOR.md).'],
  [/^Claude Code/i, 'Instalá Claude Code e iniciá sesión para conversar con Chispa (05-CHISPA.md).'],
  [/^Editor/i, 'Revisá "editor" en mentor.config.json: tiene que ser un programa de tu PATH.'],
  [/^Curso$|^Catálogo del curso/i, 'Creá o corregí el curso con module-builder; npm run check dice qué falta (06-CREAR-MODULOS.md).'],
  [/^Comandos del curso|^Doctor del curso|^Programa /i, 'Instalá el programa que falta o corregí "commands" y "doctor" en course/catalog.json (06-CREAR-MODULOS.md).'],
];

function environmentData(state, catalog) {
  const latestDoctor = (state.runs || []).find(run => run.commandId === 'doctor');
  const hints = new Map(doctorTools(catalog).tools.filter(tool => tool.hint).map(tool => [tool.name, tool.hint]));
  const results = [];
  if (latestDoctor) {
    for (const line of String(latestDoctor.log || '').split(/\r?\n/)) {
      const match = line.match(/^\[(PASS|FAIL|WARN|SKIP|NOT RUN)]\s+([^:]+):\s*(.*)$/);
      if (!match) continue;
      const [, status, rawName, detail] = match;
      const name = rawName.trim();
      const remediation = status === 'FAIL' || status === 'WARN'
        ? hints.get(name) || remediationByTool.find(([pattern]) => pattern.test(name))?.[1] || 'Revisá la salida técnica, corregí la herramienta y volvé a comprobar.'
        : null;
      results.push({status, name, detail, remediation});
    }
  }
  return {
    doctorExecuted: Boolean(latestDoctor),
    doctorAt: latestDoctor?.endedAt || null,
    toolchainReady: Boolean(latestDoctor && latestDoctor.status === 'passed' && !results.some(result => ['FAIL', 'SKIP', 'NOT RUN'].includes(result.status))),
    results,
  };
}

// Everything the concept library can open, grouped by track: top-level docs, module material
// and the reference index (when the track has one), plus the mentor's guide and course-wide docs.
// Read-only; /api/doc enforces the same set.
function libraryData() {
  const {catalog} = load();
  const references = new Set(referenceDocs(catalog));
  const docsByTrack = trackDocs(catalog);
  return {
    mentorDocs: mentorDocs(),
    courseDocs: courseWideDocs(),
    tracks: Object.fromEntries(Object.entries(catalog.tracks).map(([track, info]) => {
      const referenceIndex = `course/${track}/referencia/00-INDICE.md`;
      return [track, {
        title: info.title,
        trackDocs: docsByTrack.filter(doc => doc.startsWith(`course/${track}/`)),
        referenceIndex: references.has(referenceIndex) ? referenceIndex : null,
        modules: catalog.modules
          .filter(module => module.track === track)
          .map(module => ({id: module.id, title: module.title, docs: docs(module)})),
      }];
    })),
  };
}

function argumentsResolve(definition, module) {
  if (!definition.course) return true;
  try {
    commandArgs(definition, module);
    return true;
  } catch {
    return false;
  }
}

function courseData() {
  const {catalog, state} = load();
  const stateFor = module => state.modules[module.id] || {
    status: 'not_started',
    review: 'pending',
    manualCriteria: {},
    notes: '',
    lastCheck: null,
  };
  const activeRuns = [...runs.values()].filter(run => run.status === 'running');
  const mentor = mentorAgent();
  const moduleViews = catalog.modules.map(module => {
    const record = stateFor(module);
    const snapshot = evidenceSnapshot(module);
    return {
      ...module,
      docs: docs(module),
      state: {
        ...record,
        evidenceHash: snapshot.hash,
        completion: completionRequirements(module, state, record, snapshot),
        lab: labStatus(module),
        reading: readingStatus(module, record),
      },
    };
  });
  const course = courseCommands(catalog);
  const definitions = [
    ...Object.keys(coreCommands).map(id => commandDefinition(id, catalog)),
    ...[...course.commands.values()].map(definition => ({...definition, course: true})),
  ];
  const known = new Set(definitions.map(definition => definition.id));
  return {
    catalog: {
      ...catalog,
      modules: moduleViews,
      references: referenceDocs(catalog),
      commandProblems: [...course.problems, ...doctorTools(catalog).problems],
    },
    mentorDocs: mentorDocs(),
    state,
    stats: stats(catalog, state),
    commands: definitions.map(definition => {
      const blockers = activeRuns.filter(run => definition.resources.some(resource => run.resources.includes(resource)));
      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        group: definition.group,
        course: Boolean(definition.course),
        requiresModule: Boolean(definition.requiresModule),
        available: availableOnThisPlatform(definition) && (!definition.mentor || Boolean(mentor.agent)),
        long: Boolean(definition.long),
        contextFile: definition.contextFile || null,
        confirmation: definition.confirmation || null,
        lockedBy: blockers.map(run => ({id: run.id, label: run.label})),
        recommendedFor: moduleViews.filter(module => recommendedCommands(module, known).has(definition.id)).map(module => module.id),
        availableFor: moduleViews.filter(module => !definition.requiresModule || argumentsResolve(definition, module)).map(module => module.id),
      };
    }),
    activeRuns: activeRuns.map(publicRun),
    environment: environmentData(state, catalog),
    capabilities: {
      live: true,
      mentor: Boolean(mentor.agent),
      mentorAgent: mentor.agent?.label || null,
      mentorProblem: mentor.reason,
      editor: editorTool()?.label || null,
    },
  };
}

function mutateModule(payload) {
  const {catalog, state} = load();
  const module = getModule(catalog, payload.moduleId);
  state.modules[module.id] ||= {status: 'not_started', review: 'pending', manualCriteria: {}, notes: '', lastCheck: null};
  const record = state.modules[module.id];
  if (payload.action === 'start') {
    const pending = module.depends.filter(id => state.modules[id]?.status !== 'done');
    if (pending.length) throw new Error(`Dependencias pendientes: ${pending.join(', ')}`);
    state.currentModule = module.id;
    record.status = 'in_progress';
  } else if (payload.action === 'criterion') {
    const index = Number(payload.index);
    if (!Number.isInteger(index) || index < 0 || index >= module.criteria.length) throw new Error('Criterio inválido');
    record.manualCriteria[`AC${index + 1}`] = Boolean(payload.value);
  } else if (payload.action === 'review') {
    if (!['pending', 'pass', 'fail'].includes(payload.value)) throw new Error('Review inválido');
    if (record.review) {
      record.reviewHistory = [{
        value: record.review,
        at: record.reviewAt || null,
        evidenceHash: record.reviewEvidenceHash || null,
      }, ...(record.reviewHistory || [])].slice(0, 30);
    }
    record.review = payload.value;
    record.reviewAt = new Date().toISOString();
    record.reviewEvidenceHash = evidenceSnapshot(module).hash;
    delete record.reviewStaleAt;
    delete record.reviewStaleReason;
  } else if (payload.action === 'read') {
    const item = readingList(module).find(entry => entry.name === payload.doc);
    if (!item) throw new Error('Documento fuera de la lista de lectura de la etapa');
    record.readDocs ||= {};
    if (payload.value === false) delete record.readDocs[item.name];
    else record.readDocs[item.name] = new Date().toISOString();
  } else if (payload.action === 'notes') {
    record.notes = String(payload.value || '').slice(0, 4000);
  } else if (payload.action === 'done') {
    const requirements = completionRequirements(module, state, record, evidenceSnapshot(module));
    if (!requirements.ready) throw new Error(`No se puede completar: ${requirements.missing.join(' · ')}`);
    record.status = 'done';
  } else {
    throw new Error('Acción inválida');
  }
  save(state);
  broadcast('course', {reason: payload.action, moduleId: module.id});
  return courseData();
}

// ---------- Chispa ----------
// The browser sends only the learner's text (≤ 4000 chars) and whether to start a new conversation.
// Model, effort, tools, permissions and the boot context are fixed on the server (companion/claude.mjs).
let chispaTurn = null;
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const conversationFile = id => path.join(CONVERSATIONS_DIR, `${id}.json`);

function latestConversation() {
  try {
    const [latest] = fs.readdirSync(CONVERSATIONS_DIR)
      .filter(name => CONVERSATION_ID.test(name.replace(/\.json$/, '')))
      .map(name => ({name, at: fs.statSync(path.join(CONVERSATIONS_DIR, name)).mtimeMs}))
      .sort((left, right) => right.at - left.at);
    return latest ? JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, latest.name), 'utf8')) : null;
  } catch {
    return null;
  }
}

function saveConversation(conversation) {
  fs.mkdirSync(CONVERSATIONS_DIR, {recursive: true});
  const temporary = `${conversationFile(conversation.id)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(conversation, null, 2));
  fs.renameSync(temporary, conversationFile(conversation.id));
}

function chispaMood(snapshot) {
  if (chispaTurn) return 'thinking';
  const latest = snapshot.runs[0];
  const recent = latest?.endedAt && Date.now() - new Date(latest.endedAt).getTime() < 3 * 36e5;
  if (recent && latest.status === 'passed') return 'happy';
  // A failing course-check usually just reports pending TODO markers: work in progress, not trouble.
  if (recent && latest.status === 'failed' && latest.commandId !== 'course-check') return 'worried';
  if (snapshot.hoursSinceProgress != null && snapshot.hoursSinceProgress >= chispaConfig().thresholds.noProgressHours) return 'sleepy';
  return 'idle';
}

function chispaData() {
  const executable = claudeExecutable();
  const config = chispaConfig();
  const conversation = latestConversation();
  const shards = listShards({inbox: true});
  let snapshot = null;
  try { snapshot = progressSnapshot(); } catch {}
  return {
    available: Boolean(executable),
    problem: executable ? null : 'No encuentro el CLI "claude" en PATH. Instalá Claude Code e iniciá sesión.',
    model: config.model,
    effort: config.effort,
    learnerName: config.learnerName,
    mood: snapshot ? chispaMood(snapshot) : 'idle',
    hoursSinceProgress: snapshot?.hoursSinceProgress ?? null,
    conversation: conversation ? {id: conversation.id, startedAt: conversation.startedAt, messages: conversation.messages.slice(-40)} : null,
    turn: chispaTurn ? {conversationId: chispaTurn.conversation.id, text: chispaTurn.text, tools: chispaTurn.tools} : null,
    drafts: shards.filter(shard => shard.inbox).map(summary),
    memoryCount: shards.filter(shard => !shard.inbox).length,
  };
}

function startChispaTurn(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !['message', 'fresh'].includes(key))) {
    throw new Error('Sólo se acepta tu mensaje (message) y fresh; el resto lo decide el servidor');
  }
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!message) throw new Error('Escribí un mensaje para Chispa');
  if (message.length > 4000) throw new Error('El mensaje supera 4000 caracteres');
  if (chispaTurn) throw new Error('Chispa todavía está respondiendo el mensaje anterior');
  if (!claudeExecutable()) throw new Error('No encuentro el CLI "claude" en PATH.');

  const previous = payload.fresh === true ? null : latestConversation();
  const conversation = previous || {id: crypto.randomUUID(), startedAt: new Date().toISOString(), messages: []};
  const resume = conversation.messages.some(item => item.role === 'chispa' && !item.error);
  // A conversation whose only answers failed may have left a half-created session behind: start a new one.
  if (!resume && conversation.messages.some(item => item.role === 'chispa')) {
    fs.rmSync(conversationFile(conversation.id), {force: true});
    conversation.id = crypto.randomUUID();
  }
  conversation.messages.push({role: 'user', text: message, at: new Date().toISOString()});
  saveConversation(conversation);

  const turn = {conversation, text: '', tools: [], child: null};
  chispaTurn = turn;
  broadcast('chispa', {type: 'turn-start', conversationId: conversation.id});
  const {child, done} = runTurn({
    message,
    sessionId: conversation.id,
    resume,
    systemPrompt: resume ? null : bootText(),
    onEvent: event => {
      if (event.type === 'delta') turn.text += event.text;
      else turn.tools.push({name: event.name, detail: event.detail});
      broadcast('chispa', {...event, conversationId: conversation.id});
    },
  });
  turn.child = child;
  done
    .then(({text}) => {
      conversation.messages.push({role: 'chispa', text, tools: turn.tools, at: new Date().toISOString()});
      broadcast('chispa', {type: 'turn-end', conversationId: conversation.id});
    })
    .catch(error => {
      conversation.messages.push({role: 'chispa', text: turn.text, error: error.message, tools: turn.tools, at: new Date().toISOString()});
      broadcast('chispa', {type: 'turn-error', conversationId: conversation.id, error: error.message});
    })
    .finally(() => {
      saveConversation(conversation);
      chispaTurn = null;
    });
  return {conversationId: conversation.id};
}

function chispaMemory(payload) {
  if (!payload || typeof payload !== 'object' || Object.keys(payload).some(key => !['action', 'id'].includes(key))) {
    throw new Error('Sólo se aceptan action e id');
  }
  if (payload.action === 'save') approveShard(payload.id);
  else if (payload.action === 'discard') discardShard(payload.id);
  else throw new Error('Acción de memoria inválida');
  broadcast('chispa', {type: 'memory'});
  return chispaData();
}

function openLabFile(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !['moduleId', 'index'].includes(key))) {
    throw new Error('Sólo se aceptan moduleId e index; no rutas ni programas');
  }
  const {catalog} = load();
  const module = getModule(catalog, payload.moduleId);
  const check = Number.isInteger(payload.index) ? module.checks[payload.index] : null;
  if (!check || !isLabFile(check)) throw new Error('Esa evidencia no es un archivo del laboratorio');
  const file = safe(check.path);
  if (!fs.existsSync(file)) throw new Error(`No existe ${check.path}`);
  const editor = editorTool();
  if (!editor) throw new Error('Agregá "editor" a mentor.config.json para abrir archivos desde el dashboard.');
  const child = spawn(editor.executable, [...editor.args, file], {
    cwd: ROOT,
    shell: false,
    detached: true,
    stdio: 'ignore',
    env: {...process.env, PATH: runtimePath()},
  });
  child.on('error', () => {});
  child.unref();
  return {opened: check.path, editor: editor.label};
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  try {
    assertLocalRequest(request, request.method === 'POST');
    const url = new URL(request.url, `http://${host}:${port}`);

    if (request.method === 'GET' && url.pathname === '/api/course') return sendJson(response, 200, courseData());
    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write(`event: hello\ndata: ${JSON.stringify({live: true, mentor: Boolean(mentorAgent().agent)})}\n\n`);
      eventClients.add(response);
      request.on('close', () => eventClients.delete(response));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/module') return sendJson(response, 200, mutateModule(await readJsonBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/run') {
      const payload = await readJsonBody(request);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).some(key => !['commandId', 'moduleId', 'confirmation'].includes(key))) {
        throw new Error('Sólo se aceptan identificadores de acciones; no comandos, argumentos, prompts ni rutas');
      }
      return sendJson(response, 202, publicRun(startRun(payload.commandId, payload.moduleId, payload.confirmation)));
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/run/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/run/'.length));
      const run = runs.get(id);
      return run ? sendJson(response, 200, publicRun(run)) : sendJson(response, 404, {error: 'No encontrado'});
    }
    if (request.method === 'POST' && /^\/api\/run\/[^/]+\/stop$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const run = runs.get(id);
      if (!run) return sendJson(response, 404, {error: 'No encontrado'});
      stopRun(run);
      return sendJson(response, 200, publicRun(run));
    }
    if (request.method === 'POST' && url.pathname === '/api/open') return sendJson(response, 200, openLabFile(await readJsonBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/reading') {
      const {catalog, state} = load();
      const module = getModule(catalog, url.searchParams.get('moduleId'));
      return sendJson(response, 200, {moduleId: module.id, reading: readingStatus(module, state.modules[module.id])});
    }
    if (request.method === 'GET' && url.pathname === '/api/chispa') return sendJson(response, 200, chispaData());
    if (request.method === 'POST' && url.pathname === '/api/chispa') return sendJson(response, 202, startChispaTurn(await readJsonBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/chispa/stop') {
      if (!chispaTurn) throw new Error('Chispa no está respondiendo');
      chispaTurn.child.kill('SIGTERM');
      return sendJson(response, 200, {stopped: true});
    }
    if (request.method === 'POST' && url.pathname === '/api/chispa/memory') return sendJson(response, 200, chispaMemory(await readJsonBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/library') return sendJson(response, 200, libraryData());
    if (request.method === 'GET' && url.pathname === '/api/doc') {
      const relative = url.searchParams.get('path') || '';
      const {catalog} = load();
      const allowedDocs = new Set([...catalog.modules.flatMap(docs), ...referenceDocs(catalog), ...trackDocs(catalog), ...courseDocs()]);
      if (!allowedDocs.has(relative)) return sendJson(response, 403, {error: 'Documento no permitido'});
      return send(response, 200, fs.readFileSync(safe(relative), 'utf8'), 'text/markdown; charset=utf-8');
    }

    const relative = url.pathname === '/' ? 'dashboard/index.html' : `dashboard${url.pathname}`;
    const file = safe(relative);
    const dashboardRoot = path.join(ROOT, 'dashboard');
    if (file !== dashboardRoot && !file.startsWith(`${dashboardRoot}${path.sep}`)) return send(response, 403, 'Forbidden');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(response, 404, 'Not found');
    return send(response, 200, fs.readFileSync(file), mimeTypes[path.extname(file)] || 'application/octet-stream');
  } catch (error) {
    return sendJson(response, 400, {error: error.message});
  }
});

let changeTimer;
function markStaleEvidence(relative) {
  const {catalog, state} = load();
  let changed = false;
  for (const module of catalog.modules) {
    const record = state.modules[module.id];
    if (!record?.lastCheck && !record?.reviewEvidenceHash) continue;
    const snapshot = evidenceSnapshot(module);
    if (record.lastCheck?.evidenceHash && record.lastCheck.evidenceHash !== snapshot.hash && !record.lastCheck.staleAt) {
      record.lastCheck.staleAt = new Date().toISOString();
      record.lastCheck.staleReason = `Cambió ${relative}`;
      changed = true;
    }
    if (record.reviewEvidenceHash && record.reviewEvidenceHash !== snapshot.hash && !record.reviewStaleAt) {
      record.reviewStaleAt = new Date().toISOString();
      record.reviewStaleReason = `Cambió ${relative}`;
      changed = true;
    }
  }
  if (changed) {
    save(state);
    broadcast('course', {reason: 'evidence-stale', path: relative});
  }
}

try {
  fs.watch(ROOT, {recursive: true}, (_event, filename) => {
    const relative = String(filename || '').split(path.sep).join('/');
    const stateWrite = relative === 'course-state.json' || /^course-state\.json\.\d+\.tmp$/.test(relative);
    if (!relative || stateWrite || relative.split('/').some(part => IGNORED_NAMES.has(part))) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      try {
        markStaleEvidence(relative);
      } catch (error) {
        console.warn(`No pude revisar la evidencia: ${error.message}`);
      }
      broadcast('change', {path: relative, at: new Date().toISOString()});
    }, 180);
  });
} catch (error) {
  console.warn(`Live reload de archivos no disponible: ${error.message}`);
}

server.listen(port, host, () => {
  const address = `http://${host}:${port}`;
  console.log(`Dashboard: ${address}`);
  console.log('localhost only · fixed allowlist · shell=false');
  if (shouldOpen) {
    const opener = process.platform === 'darwin'
      ? ['open', [address]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', address]]
        : ['xdg-open', [address]];
    execFile(opener[0], opener[1], () => {});
  }
});
