import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATALOG = path.join(ROOT, 'course/catalog.json');
export const STATE = path.join(ROOT, 'course-state.json');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function atomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function learningOrder(module) {
  return Number.isFinite(module.recommendedOrder) ? module.recommendedOrder : module.order;
}

// A fresh copy of the core has no course: course/catalog.json is written by module-builder and
// course-state.json by the first change of progress. Until then both read as empty.
const EMPTY_CATALOG = {version: 2, title: 'My Mentor', tracks: {}, routes: [], defaultRoute: null, commands: {}, doctor: []};
export const emptyState = () => ({version: 1, currentModule: null, modules: {}, runs: []});

function readOptional(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback();
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path.relative(ROOT, file)} no es JSON válido: ${error.message}`);
  }
}

export const MODULE_ID = /^[A-Z]\d\d$/;

// What the dashboard needs from every module.json; anything else is checked by npm run check.
function manifestProblem(module) {
  if (!module || typeof module !== 'object' || Array.isArray(module)) return 'tiene que ser un objeto';
  if (!MODULE_ID.test(String(module.id))) return 'id es una letra mayúscula y dos dígitos (p. ej. A00)';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(module.slug))) return 'slug va en minúsculas, números y guiones';
  if (typeof module.title !== 'string' || !module.title.trim()) return 'falta title';
  for (const key of ['depends', 'criteria', 'checks']) {
    if (!Array.isArray(module[key])) return `${key} tiene que ser una lista`;
  }
  if (!Number.isFinite(learningOrder(module))) return 'order tiene que ser un número';
  return null;
}

// Without routes in the catalog there is still one: every module, in an order that respects dependencies.
function completeRoute(modules) {
  const known = new Set(modules.map(module => module.id));
  const placed = new Set();
  const pending = [...modules];
  const order = [];
  while (pending.length) {
    const ready = pending.findIndex(module => module.depends.every(id => placed.has(id) || !known.has(id)));
    const [next] = pending.splice(ready < 0 ? 0 : ready, 1);
    placed.add(next.id);
    order.push(next.id);
  }
  return {id: 'complete', title: 'Recorrido completo', description: 'Todas las etapas, en un orden que respeta sus dependencias.', modules: order};
}

export function loadCatalog() {
  const metadata = {...EMPTY_CATALOG, ...readOptional(CATALOG, () => ({}))};
  const tracks = metadata.tracks && typeof metadata.tracks === 'object' && !Array.isArray(metadata.tracks) ? metadata.tracks : {};
  const modules = [];

  for (const track of Object.keys(tracks)) {
    const trackDirectory = path.join(ROOT, 'course', track);
    if (!fs.existsSync(trackDirectory)) continue;

    for (const entry of fs.readdirSync(trackDirectory, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(trackDirectory, entry.name, 'module.json');
      if (!fs.existsSync(manifestPath)) continue;
      const module = readOptional(manifestPath, () => null);
      const problem = manifestProblem(module);
      if (problem) throw new Error(`${path.relative(ROOT, manifestPath)}: ${problem}`);
      if (module.track !== track) {
        throw new Error(`${path.relative(ROOT, manifestPath)} declara track ${module.track}; se esperaba ${track}`);
      }
      if (`${module.id}-${module.slug}` !== entry.name) {
        throw new Error(`${path.relative(ROOT, manifestPath)} no coincide con su id/slug`);
      }
      modules.push(module);
    }
  }

  const trackOrder = new Map(Object.keys(tracks).map((track, index) => [track, index]));
  modules.sort((left, right) =>
    trackOrder.get(left.track) - trackOrder.get(right.track)
    || learningOrder(left) - learningOrder(right)
    || left.id.localeCompare(right.id));

  const declared = Array.isArray(metadata.routes) && metadata.routes.length > 0;
  const routes = declared ? metadata.routes : modules.length ? [completeRoute(modules)] : [];
  const defaultRoute = declared ? metadata.defaultRoute : routes[0]?.id ?? null;
  return {...metadata, tracks, routes, defaultRoute, modules};
}

export function load() {
  const state = {...emptyState(), ...readOptional(STATE, emptyState)};
  if (!state.modules || typeof state.modules !== 'object' || Array.isArray(state.modules)) state.modules = {};
  return {catalog: loadCatalog(), state};
}

export function save(state) {
  state.updatedAt = new Date().toISOString();
  atomic(STATE, state);
}

export function getModule(catalog, key) {
  const normalized = String(key || '').toLowerCase();
  const module = catalog.modules.find(item =>
    item.id.toLowerCase() === normalized || item.slug.toLowerCase() === normalized);
  if (!module) throw new Error(`Módulo desconocido: ${key}`);
  return module;
}

export function moduleDir(module) {
  return path.join(ROOT, 'course', module.track, `${module.id}-${module.slug}`);
}

export function docs(module) {
  return fs.readdirSync(moduleDir(module))
    .filter(file => /^\d\d-.*\.md$/.test(file))
    .sort()
    .map(file => path.relative(ROOT, path.join(moduleDir(module), file)).split(path.sep).join('/'));
}

// Local concept library of each track (course/<track>/referencia/*.md); flat, Markdown only.
export function referenceDocs(catalog) {
  return Object.keys(catalog.tracks).flatMap(track => {
    const directory = path.join(ROOT, 'course', track, 'referencia');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, {withFileTypes: true})
      .filter(entry => entry.isFile() && /^[a-z0-9][a-z0-9-]*\.md$/i.test(entry.name))
      .map(entry => `course/${track}/referencia/${entry.name}`);
  });
}

// Numbered docs (00-EMPEZA-ACA.md…). Only this pattern is served from the repo root and from course/,
// so README.md, AGENTS.md and every other root file stay out of the reader.
const NUMBERED_DOC = /^\d\d-[A-Z0-9-]+\.md$/;

// Docs to read before working on the lab, in the order 00-EMPEZA-ACA lists them.
// A module may override it with "reading": ["01-BRIEF.md", ...]; only docs it has count.
const DEFAULT_READING = ['00-EMPEZA-ACA.md', '01-BRIEF.md', '13-ANATOMIA-DEL-ECOSISTEMA.md', '02-CONCEPTOS.md', '12-GUIA-WEB.md'];

export function readingList(module) {
  const available = new Map(docs(module).map(doc => [doc.split('/').pop(), doc]));
  return (Array.isArray(module.reading) ? module.reading : DEFAULT_READING)
    .filter(name => available.has(name))
    .map(name => ({name, path: available.get(name)}));
}

// Static file check shared by course-check and the dashboard's live lab view.
export function evaluateFileCheck(check) {
  const fullPath = check.path ? safe(check.path) : null;
  if (!fullPath || !fs.existsSync(fullPath)) return {pass: false, detail: 'ausente'};
  const content = fs.readFileSync(fullPath, 'utf8');
  const forbidden = (check.not || []).find(value => content.includes(value));
  const missing = (check.contains || []).find(value => !content.includes(value));
  const minimum = check.minBytes || 1;
  const pass = content.trim().length >= minimum && !forbidden && !missing;
  if (forbidden) return {pass: false, detail: `contiene ${forbidden}`};
  if (missing) return {pass: false, detail: `falta ${missing}`};
  return {pass, detail: pass ? 'contenido verificado' : `menos de ${minimum} caracteres`};
}

export const isLabFile = check => check.kind === 'file' || check.kind === 'contains';

// Live view of the lab files: the same static check course-check records, read on every call.
export function labStatus(module) {
  return module.checks
    .map((check, index) => ({check, index}))
    .filter(({check}) => isLabFile(check))
    .map(({check, index}) => {
      try {
        return {index, path: check.path, ...evaluateFileCheck(check)};
      } catch (error) {
        return {index, path: check.path, pass: false, detail: error.message};
      }
    });
}

export const readingStatus = (module, record) =>
  readingList(module).map(item => ({...item, read: Boolean(record?.readDocs?.[item.name])}));

function numberedDocs(relative) {
  const directory = path.join(ROOT, relative);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes: true})
    .filter(entry => entry.isFile() && NUMBERED_DOC.test(entry.name))
    .map(entry => (relative ? `${relative}/${entry.name}` : entry.name))
    .sort();
}

// The mentor's own guide: numbered docs at the repo root. Part of the core.
export const mentorDocs = () => numberedDocs('');
// Docs about this course as a whole (course/00-PERFIL.md, recorridos…). Part of the course.
export const courseWideDocs = () => numberedDocs('course');
// Everything the reader may open besides modules, track docs and references.
export const courseDocs = () => [...courseWideDocs(), ...mentorDocs()];

// Top-level docs of each track (course/<track>/*.md: índice, mapas, kit); flat, Markdown only.
export function trackDocs(catalog) {
  return Object.keys(catalog.tracks).flatMap(track => {
    const directory = path.join(ROOT, 'course', track);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, {withFileTypes: true})
      .filter(entry => entry.isFile() && /^\d\d-[A-Z0-9-]+\.md$/.test(entry.name))
      .map(entry => `course/${track}/${entry.name}`)
      .sort();
  });
}

export function stats(catalog, state) {
  const tracks = {};
  for (const track of Object.keys(catalog.tracks)) {
    const modules = catalog.modules.filter(module => module.track === track);
    const done = modules.filter(module => state.modules[module.id]?.status === 'done').length;
    tracks[track] = {
      done,
      total: modules.length,
      percent: modules.length ? Math.round(done * 100 / modules.length) : 0,
    };
  }
  const done = catalog.modules.filter(module => state.modules[module.id]?.status === 'done').length;
  return {
    done,
    total: catalog.modules.length,
    percent: catalog.modules.length ? Math.round(done * 100 / catalog.modules.length) : 0,
    tracks,
  };
}

export function safe(relative) {
  const resolved = path.resolve(ROOT, relative);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error('Path fuera del repo');
  return resolved;
}

// Names never treated as evidence nor watched for changes: version control, local state, caches and
// build output of the usual toolchains, so that building does not make every check stale.
export const IGNORED_NAMES = new Set([
  '.git', '.course', '.companion', '.DS_Store', '.idea', '.vscode', 'node_modules', '.venv', 'venv',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.gradle', 'Pods', 'DerivedData',
  'build', 'target', '.next', '.expo',
]);

function evidenceRoots(module) {
  const roots = new Set();
  const add = candidate => {
    const relative = String(candidate || '').trim().replace(/^repo completo\s*\+?\s*/i, '');
    if (!relative || relative.includes('*')) return;
    const resolved = safe(relative);
    if (fs.existsSync(resolved)) roots.add(relative.split(path.sep).join('/'));
  };

  for (const candidate of String(module.deliverable || '').split(/\s+\+\s+/)) add(candidate);
  for (const candidate of module.evidencePaths || []) add(candidate);
  for (const check of module.checks || []) {
    if (!check.path) continue;
    const wildcard = check.path.search(/[?*[]/);
    const candidate = wildcard < 0 ? check.path : check.path.slice(0, wildcard).replace(/\/$/, '');
    add(candidate || '.');
  }
  roots.add(path.relative(ROOT, path.join(moduleDir(module), 'module.json')).split(path.sep).join('/'));
  return [...roots].sort();
}

function collectEvidenceFiles(relative, accumulator) {
  const absolute = safe(relative);
  if (!fs.existsSync(absolute)) {
    accumulator.add(`${relative}\0MISSING`);
    return;
  }
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) {
    accumulator.add(relative);
    return;
  }
  for (const entry of fs.readdirSync(absolute, {withFileTypes: true})) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    collectEvidenceFiles(path.join(relative, entry.name).split(path.sep).join('/'), accumulator);
  }
}

export function evidenceSnapshot(module) {
  const collected = new Set();
  for (const root of evidenceRoots(module)) collectEvidenceFiles(root, collected);
  const files = [...collected].sort();
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(module.checks || []));
  for (const relative of files) {
    hash.update(`\0${relative}\0`);
    if (!relative.endsWith('\0MISSING')) hash.update(fs.readFileSync(safe(relative)));
  }
  return {hash: hash.digest('hex'), files: files.filter(file => !file.endsWith('\0MISSING'))};
}

export function hasFreshPassingCheck(module, record, snapshot = evidenceSnapshot(module)) {
  const check = record?.lastCheck;
  return Boolean(
    check
    && Number.isInteger(check.total)
    && check.total > 0
    && check.passed === check.total
    && check.evidenceHash === snapshot.hash
    && !check.staleAt,
  );
}

export function hasFreshPassingReview(record, snapshot) {
  return Boolean(
    record?.review === 'pass'
    && record.reviewEvidenceHash === snapshot.hash
    && !record.reviewStaleAt,
  );
}

export function completionRequirements(module, state, record, snapshot = evidenceSnapshot(module)) {
  const pendingDependencies = module.depends.filter(id => state.modules[id]?.status !== 'done');
  const missingCriteria = module.criteria
    .map((criterion, index) => ({id: `AC${index + 1}`, criterion}))
    .filter(item => !record?.manualCriteria?.[item.id]);
  const freshCheck = hasFreshPassingCheck(module, record, snapshot);
  const freshReview = hasFreshPassingReview(record, snapshot);
  const missing = [
    ...pendingDependencies.map(id => `Completar dependencia ${id}`),
    ...missingCriteria.map(item => `Confirmar ${item.id}: ${item.criterion}`),
    ...(freshCheck ? [] : [record?.lastCheck ? 'Volver a validar: la evidencia no pasa o quedó stale' : 'Validar esta etapa con al menos un check real']),
    ...(freshReview ? [] : [record?.review === 'pass' ? 'Repetir el review: quedó stale frente al código actual' : 'Obtener y marcar review PASS sobre el código actual']),
  ];
  return {ready: missing.length === 0, missing, freshCheck, freshReview, pendingDependencies, missingCriteria};
}
