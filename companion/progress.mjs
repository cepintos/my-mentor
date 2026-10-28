// What is true about the learner's progress right now, read from course-state.json and the lab files.
// Shared by Chispa's boot file, its MCP tools and the reminder engine. Nothing here is estimated.
import fs from 'node:fs';
import {
  completionRequirements,
  docs,
  evidenceSnapshot,
  getModule,
  labStatus,
  load,
  readingStatus,
  safe,
} from '../scripts/lib.mjs';

export const PHASES = ['Entender', 'Hacer', 'Comprobar', 'Cerrar'];

const EMPTY_RECORD = {status: 'not_started', review: 'pending', manualCriteria: {}, notes: '', lastCheck: null};
const fileName = relative => String(relative).split('/').pop();

function mtime(relative) {
  try {
    return fs.statSync(safe(relative)).mtime.toISOString();
  } catch {
    return null;
  }
}

// Same order as nextAction() in dashboard/app.js: read, work on the lab, check, close.
function nextStep(module, record, state, completion, lab, reading) {
  if (record.status === 'done') return {phase: PHASES.length, text: 'Etapa completada'};
  const pending = module.depends.filter(id => state.modules[id]?.status !== 'done');
  if (pending.length) return {phase: -1, text: `Bloqueada: falta ${pending.join(', ')}`};
  if (record.status === 'not_started') return {phase: 0, text: 'Empezar la etapa con 00 · Empezá acá'};
  const unread = reading.find(item => !item.read);
  if (unread && !lab.some(item => item.pass)) return {phase: 0, text: `Leer ${unread.name}`};
  const file = lab.find(item => !item.pass);
  if (file) return {phase: 1, text: `Completar ${fileName(file.path)} (${file.detail})`, path: file.path};
  if (!completion.freshCheck) return {phase: 2, text: 'Validar evidencia'};
  if (completion.missingCriteria.length) return {phase: 2, text: `Marcar criterios (${completion.missingCriteria.length} pendientes)`};
  if (!completion.freshReview) return {phase: 3, text: 'Pedir el review final'};
  return {phase: 3, text: 'Completar la etapa'};
}

export function stageView(state, module) {
  const record = state.modules[module.id] || EMPTY_RECORD;
  const completion = completionRequirements(module, state, record, evidenceSnapshot(module));
  const lab = labStatus(module);
  const reading = readingStatus(module, record);
  const step = nextStep(module, record, state, completion, lab, reading);
  // Progress is content: lab edits, reading marks, a passing check, a review. A failing check is activity.
  const passingCheck = record.lastCheck && record.lastCheck.total > 0 && record.lastCheck.passed === record.lastCheck.total;
  const progressDates = [
    ...lab.map(item => mtime(item.path)),
    ...Object.values(record.readDocs || {}),
    record.reviewAt,
    passingCheck ? record.lastCheck.at : null,
  ].filter(Boolean).sort();
  return {
    id: module.id,
    title: module.title,
    question: module.question || module.goal,
    deliverable: module.deliverable,
    status: record.status,
    phase: step.phase,
    phaseName: PHASES[step.phase] || (step.phase < 0 ? 'Bloqueada' : 'Completada'),
    nextStep: step.text,
    nextPath: step.path || null,
    reading: reading.map(({name, path, read}) => ({name, path, read})),
    planDoc: docs(module).find(doc => doc.endsWith('/06-PLAN-DE-IMPLEMENTACION.md')) || null,
    lab: lab.map(({index, path, pass, detail}) => ({index, path, pass, detail})),
    lastCheck: record.lastCheck
      ? {at: record.lastCheck.at, passed: record.lastCheck.passed, total: record.lastCheck.total, fresh: completion.freshCheck}
      : null,
    criteria: {done: module.criteria.length - completion.missingCriteria.length, total: module.criteria.length},
    review: record.review,
    lastProgressAt: progressDates.at(-1) || null,
  };
}

const hoursSince = iso => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 36e5) : null);

// stage is null while the course has no modules yet.
export function progressSnapshot() {
  const {catalog, state} = load();
  const runs = (state.runs || []).slice(0, 10).map(run => ({
    id: run.id,
    label: run.label,
    commandId: run.commandId,
    moduleId: run.moduleId,
    status: run.status,
    endedAt: run.endedAt,
  }));
  if (!catalog.modules.length) {
    return {at: new Date().toISOString(), stage: null, inProgress: [], done: [], runs, hoursSinceProgress: null};
  }
  const current = catalog.modules.find(module => module.id === state.currentModule) || catalog.modules[0];
  const stage = stageView(state, current);
  const inProgress = catalog.modules
    .filter(module => module.id !== current.id && state.modules[module.id]?.status === 'in_progress')
    .map(module => module.id);
  return {
    at: new Date().toISOString(),
    stage,
    inProgress,
    done: catalog.modules.filter(module => state.modules[module.id]?.status === 'done').map(module => module.id),
    runs,
    hoursSinceProgress: hoursSince(stage.lastProgressAt),
  };
}

export function stageById(id) {
  const {catalog, state} = load();
  return stageView(state, getModule(catalog, id));
}
