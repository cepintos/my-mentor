// Shared by the core's tests. Every test works on a disposable copy of the core, never on the
// learner's course, progress, memory or configuration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ROOT} from '../lib.mjs';

// What belongs to the learner (or to this machine) and is never copied.
const LEARNER_OWNED = new Set([
  '.git', 'course', 'learning-labs', 'course-state.json', 'mentor.config.json', '.companion', '.course',
  'private', 'node_modules', '.DS_Store', '.idea', '.vscode',
]);

export const SAMPLE_CRITERIA = [
  'Las notas explican la idea con tus palabras.',
  'El ejemplo propio corre y su salida está pegada.',
];

const MODULE_DOCS = [
  '00-EMPEZA-ACA.md', '01-BRIEF.md', '02-CONCEPTOS.md', '03-GUIA-DE-LENGUAJE.md', '04-ARQUITECTURA.md',
  '05-EJEMPLOS.md', '06-PLAN-DE-IMPLEMENTACION.md', '07-CRITERIOS-DE-ACEPTACION.md', '08-PLAN-DE-PRUEBAS.md',
  '09-FALLOS-COMUNES.md', '10-FUENTES.md', '11-PROMPT-DE-REVIEW.md', '12-GUIA-WEB.md',
];

export function disposableRepo(t, {course = false} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-core-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const entry of fs.readdirSync(ROOT)) {
    if (LEARNER_OWNED.has(entry) || entry.startsWith('course-state.json.')) continue;
    fs.cpSync(path.join(ROOT, entry), path.join(root, entry), {
      recursive: true,
      verbatimSymlinks: true,
      filter: source => !source.includes(`${path.sep}.claude${path.sep}worktrees`),
    });
  }
  if (course) writeSampleCourse(root);
  return root;
}

export function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}

export const readJsonFile = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

// A two-stage course with one course command bound to the stage and one that asks for confirmation.
export function writeSampleCourse(root) {
  write(root, 'course/catalog.json', {
    version: 2,
    title: 'Curso de prueba',
    tracks: {demo: {title: 'Demo', description: 'Curso mínimo para probar el core.'}},
    defaultRoute: 'first',
    routes: [
      {id: 'first', title: 'Primera etapa', description: 'Sólo D00.', modules: ['D00']},
      {id: 'complete', title: 'Completo', description: 'Todas las etapas.', modules: ['D00', 'D01']},
    ],
    commands: {
      'node-version': {label: 'Versión de Node', description: 'Imprime la versión de Node.', command: 'node', args: ['--version']},
      'list-lab': {
        label: 'Listar el laboratorio',
        description: 'Lista los archivos del entregable de la etapa.',
        command: 'node',
        args: ['-e', 'console.log(require("node:fs").readdirSync(process.argv[1]).sort().join("\\n"))', '{deliverable}'],
      },
      'reset-notes': {label: 'Borrar notas', description: 'Pide confirmación.', group: 'maintenance', command: 'node', args: ['--version'], confirmation: 'Esto pide confirmación.'},
    },
    doctor: [
      {name: 'Node para el curso', command: 'node', args: ['--version'], versionPattern: 'v(\\d+\\.\\d+)', min: '18.0', hint: 'Instalá Node 18 o superior.'},
    ],
  });
  const stages = [
    {id: 'D00', slug: 'primera-etapa', title: 'Primera etapa', order: 0, depends: [], scaffold: 5},
    {id: 'D01', slug: 'segunda-etapa', title: 'Segunda etapa', order: 1, depends: ['D00'], scaffold: 4},
  ];
  for (const stage of stages) {
    const directory = `course/demo/${stage.id}-${stage.slug}`;
    write(root, `${directory}/module.json`, {
      id: stage.id,
      track: 'demo',
      order: stage.order,
      slug: stage.slug,
      title: stage.title,
      fullDocumentation: true,
      scaffold: stage.scaffold,
      depends: stage.depends,
      deliverable: `learning-labs/demo/${stage.id}`,
      question: `¿Qué demuestra ${stage.id}?`,
      goal: 'Explicar una idea y probarla con un ejemplo propio.',
      concepts: ['idea'],
      facts: stage.id === 'D00' ? ['Una idea probada con un ejemplo propio se recuerda mejor que tres leídas.'] : undefined,
      criteria: SAMPLE_CRITERIA,
      recommendedCommands: stage.id === 'D00' ? ['node-version', 'list-lab', 'doctor'] : [],
      checks: [
        {kind: 'file', path: `learning-labs/demo/${stage.id}/notas.md`, not: ['TODO_LEARNER']},
        ...(stage.id === 'D00' ? [{kind: 'command', command: 'node-version', label: 'Node responde'}] : []),
      ],
    });
    for (const name of MODULE_DOCS) {
      const body = name === '07-CRITERIOS-DE-ACEPTACION.md'
        ? SAMPLE_CRITERIA.map((criterion, index) => `- [ ] AC${index + 1} — ${criterion}`).join('\n')
        : name === '02-CONCEPTOS.md'
          ? 'Ver [la idea](../referencia/idea.md).'
          : 'Contenido de prueba.';
      write(root, `${directory}/${name}`, `# ${stage.id} · ${name.replace(/\.md$/, '')}\n\n${body}\n`);
    }
    write(root, `learning-labs/demo/${stage.id}/notas.md`, `# Notas de ${stage.id}\n\nTODO_LEARNER\n`);
  }
  write(root, 'course/demo/00-INDICE.md', '# Demo\n\nEmpezá por [D00](D00-primera-etapa/00-EMPEZA-ACA.md).\n');
  write(root, 'course/demo/referencia/00-INDICE.md', '# Referencia\n\n## D00 — Primera etapa\n\n- [La idea](idea.md)\n');
  write(root, 'course/demo/referencia/idea.md', '# La idea\n\nUna idea chica.\n');
  write(root, 'course/00-PERFIL.md', '# Perfil\n\n## Qué sé\n\nSé programar en JavaScript.\n\n## Qué quiero poder hacer\n\nEscribir scripts en Python.\n');
}

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const {port} = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

// The real dashboard server on an ephemeral port of a disposable repo.
export async function startDashboard(t, root, env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'tools/dashboard-server.mjs'), '--no-open', '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, ...env},
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Dashboard did not start: ${output}`)), 8000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Dashboard exited ${code}: ${output}`)); });
    child.stderr.on('data', data => { output += data; });
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('Dashboard:')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const request = (url, payload, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: url,
      method: payload === undefined ? 'GET' : 'POST',
      headers: {'content-type': 'application/json', ...headers},
    }, res => {
      let body = '';
      res.on('data', data => { body += data; });
      res.on('end', () => resolve({status: res.statusCode, body}));
    });
    req.on('error', reject);
    req.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
  const json = async (url, payload, headers) => {
    const response = await request(url, payload, headers);
    return {...response, data: JSON.parse(response.body)};
  };
  // Starts an action and waits until it is no longer running.
  const runToEnd = async (payload, timeoutMs = 30000) => {
    const started = await json('/api/run', payload);
    if (started.status !== 202) throw new Error(`run ${payload.commandId}: ${started.body}`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const {data} = await json(`/api/run/${encodeURIComponent(started.data.id)}`);
      if (data.status !== 'running') return data;
      if (Date.now() > deadline) throw new Error(`run ${payload.commandId} no terminó`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  return {port, request, json, runToEnd};
}
