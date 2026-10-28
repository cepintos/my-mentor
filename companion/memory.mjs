// Chispa's memory: one Markdown file per shard. The "indicativa" line in the frontmatter is what the
// boot file loads; the body (síntoma, stacktrace, RCA, pasos…) is read only when needed.
// Chispa can only propose shards (memory/inbox/); the learner saves or discards them in the dashboard.
import fs from 'node:fs';
import path from 'node:path';
import {INBOX_DIR, MEMORY_DIR} from './config.mjs';

export const SHARD_TYPES = ['incidente', 'concepto', 'decision', 'victoria'];
export const SHARD_SECTIONS = [
  ['sintoma', 'Síntoma'],
  ['stacktrace', 'Stacktrace'],
  ['rca', 'Mini RCA'],
  ['pasos', 'Pasos'],
  ['concepto', 'Concepto vinculado'],
  ['reconocer', 'Cómo reconocerlo la próxima vez'],
];
const FIELDS = ['id', 'fecha', 'modulo', 'tipo', 'estado', 'tags', 'indicativa', 'origen', 'recuperado'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,99}$/;
const MODULE_PATTERN = /^([A-Z]\d\d|general)$/;

const plain = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

function slugify(text) {
  return plain(text).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).slice(0, 6).join('-') || 'nota';
}

function parse(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split('\n')) {
    const [, key, raw] = line.match(/^([a-z]+):\s*(.*)$/) || [];
    if (!key) continue;
    try {
      meta[key] = raw.startsWith('"') || raw.startsWith('[') ? JSON.parse(raw) : raw;
    } catch {
      meta[key] = raw;
    }
  }
  return {meta, body: match[2]};
}

function serialize(meta, body) {
  const lines = FIELDS.filter(key => meta[key] != null && meta[key] !== '').map(key => {
    const value = meta[key];
    return `${key}: ${typeof value === 'string' && !/[":[\]#]|^\s|\s$/.test(value) && key !== 'indicativa' ? value : JSON.stringify(value)}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body.trimEnd()}\n`;
}

function shardFiles(directory) {
  try {
    return fs.readdirSync(directory).filter(name => name.endsWith('.md')).map(name => path.join(directory, name));
  } catch {
    return [];
  }
}

function readFile(file, inbox) {
  const parsed = parse(fs.readFileSync(file, 'utf8'));
  if (!parsed) return null;
  return {...parsed.meta, id: parsed.meta.id || path.basename(file, '.md'), inbox, file, body: parsed.body};
}

export function listShards({inbox = false} = {}) {
  return [...shardFiles(MEMORY_DIR).map(file => readFile(file, false)), ...(inbox ? shardFiles(INBOX_DIR).map(file => readFile(file, true)) : [])]
    .filter(Boolean)
    .sort((left, right) => String(right.fecha).localeCompare(String(left.fecha)));
}

export const summary = shard => ({
  id: shard.id, fecha: shard.fecha, modulo: shard.modulo, tipo: shard.tipo, estado: shard.estado,
  tags: shard.tags || [], indicativa: shard.indicativa, recuperado: shard.recuperado || null, borrador: shard.inbox,
});

function locate(id) {
  if (!ID_PATTERN.test(String(id))) throw new Error('id de shard inválido');
  for (const [directory, inbox] of [[MEMORY_DIR, false], [INBOX_DIR, true]]) {
    const file = path.join(directory, `${id}.md`);
    if (fs.existsSync(file)) return readFile(file, inbox);
  }
  throw new Error(`No existe el shard ${id}`);
}

export function readShard(id) {
  const shard = locate(id);
  return fs.readFileSync(shard.file, 'utf8');
}

export function searchShards(query) {
  const terms = plain(query).split(/\s+/).filter(term => term.length > 1);
  return listShards()
    .filter(shard => {
      const haystack = plain(`${shard.indicativa} ${(shard.tags || []).join(' ')} ${shard.modulo} ${shard.body}`);
      return terms.every(term => haystack.includes(term));
    })
    .map(summary);
}

function uniqueId(base) {
  let id = base.slice(0, 90);
  for (let suffix = 2; [MEMORY_DIR, INBOX_DIR].some(directory => fs.existsSync(path.join(directory, `${id}.md`))); suffix += 1) {
    id = `${base.slice(0, 86)}-${suffix}`;
  }
  return id;
}

const clip = (value, max) => String(value || '').slice(0, max);

// The only write Chispa can make: a draft in inbox/, validated field by field.
export function proposeShard(fields, origen = 'chispa') {
  const tipo = SHARD_TYPES.includes(fields.tipo) ? fields.tipo : null;
  if (!tipo) throw new Error(`tipo debe ser uno de: ${SHARD_TYPES.join(', ')}`);
  const modulo = MODULE_PATTERN.test(String(fields.modulo)) ? fields.modulo : null;
  if (!modulo) throw new Error('modulo debe ser un id de etapa (p. ej. A00) o "general"');
  const indicativa = String(fields.indicativa || '').replace(/\s+/g, ' ').trim();
  if (indicativa.length < 10 || indicativa.length > 300) throw new Error('indicativa debe tener entre 10 y 300 caracteres');
  const tags = (Array.isArray(fields.tags) ? fields.tags : [])
    .map(tag => plain(tag).replace(/[^a-z0-9-]/g, '').slice(0, 30)).filter(Boolean).slice(0, 8);
  const fecha = today();
  const id = uniqueId(`${fecha}-${modulo.toLowerCase()}-${slugify(indicativa)}`);
  const body = SHARD_SECTIONS
    .filter(([key]) => fields[key])
    .map(([key, title]) => `## ${title}\n\n${key === 'stacktrace' ? `\`\`\`text\n${clip(fields[key], 12000)}\n\`\`\`` : clip(fields[key], 8000)}`)
    .join('\n\n');
  fs.mkdirSync(INBOX_DIR, {recursive: true});
  const meta = {id, fecha, modulo, tipo, estado: fields.estado === 'resuelto' ? 'resuelto' : 'abierto', tags, indicativa, origen};
  fs.writeFileSync(path.join(INBOX_DIR, `${id}.md`), serialize(meta, body || '## Síntoma\n\n(sin detalle todavía)'), 'utf8');
  return id;
}

export function approveShard(id) {
  const shard = locate(id);
  if (!shard.inbox) throw new Error('Ese shard ya está guardado');
  fs.mkdirSync(MEMORY_DIR, {recursive: true});
  fs.renameSync(shard.file, path.join(MEMORY_DIR, `${shard.id}.md`));
  return shard.id;
}

export function discardShard(id) {
  const shard = locate(id);
  if (!shard.inbox) throw new Error('Sólo se descartan borradores; un shard guardado se edita a mano');
  fs.rmSync(shard.file);
  return shard.id;
}

function updateShard(shard, changes, body = shard.body) {
  const {file, inbox: _inbox, body: _body, ...meta} = shard;
  fs.writeFileSync(file, serialize({...meta, ...changes}, body), 'utf8');
}

const runKey = run => `run:${run.commandId}:${run.moduleId || 'global'}`;

// A course-check that only reports pending TODO markers is normal work in progress, not an incident.
function isIncident(run) {
  if (run.commandId !== 'course-check') return true;
  const failures = String(run.log || '').split('\n').filter(line => /^\[FAIL]/.test(line));
  return failures.some(line => !/contiene TODO_LEARNER|: ausente$/.test(line));
}

function firstError(log) {
  const lines = String(log).split('\n').map(line => line.trim()).filter(Boolean);
  return (lines.find(line => /\[FAIL]|error|exception|invariant|failed|FAILURE/i.test(line)) || lines.at(-1) || 'sin salida').slice(0, 160);
}

// Failed runs become one open incident draft per command and stage; a later pass marks it recovered
// so Chispa asks what fixed it.
export function recordRun(run) {
  if (!run?.commandId || run.commandId.startsWith('mentor-') || run.commandId === 'doctor') return null;
  const key = runKey(run);
  const open = listShards({inbox: true}).find(shard => shard.origen === key && shard.estado === 'abierto');
  const tail = String(run.log || '').split('\n').slice(-80).join('\n');
  if (run.status === 'failed' && isIncident(run)) {
    if (open) {
      const body = open.body.replace(/## Stacktrace\n\n```text\n[\s\S]*?\n```/, `## Stacktrace\n\n\`\`\`text\n${tail}\n\`\`\``);
      updateShard(open, {fecha: today(), recuperado: null}, body);
      return open.id;
    }
    return proposeShard({
      tipo: 'incidente',
      modulo: run.moduleId || 'general',
      indicativa: `${run.label} falló${run.moduleId ? ` en ${run.moduleId}` : ''} el ${today()}: ${firstError(run.log)}`,
      sintoma: `\`${run.label}\` terminó con salida ${run.exitCode ?? 'desconocida'} (run ${run.id}).`,
      stacktrace: tail,
      tags: [run.commandId],
    }, key);
  }
  if (run.status === 'passed' && open && !open.recuperado) {
    updateShard(open, {recuperado: new Date().toISOString()});
    return open.id;
  }
  return null;
}
