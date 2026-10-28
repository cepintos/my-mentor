#!/usr/bin/env node
// npm run course -- list|show|start|review|done|reset|status: the dashboard's rules, from a terminal.
import {completionRequirements, docs, evidenceSnapshot, getModule, learningOrder, load, save, stats} from './lib.mjs';

const emptyRecord = () => ({status: 'not_started', review: 'pending', manualCriteria: {}, notes: '', lastCheck: null});
const [action = 'status', key, value] = process.argv.slice(2);
const {catalog, state} = load();
const record = module => (state.modules[module.id] ||= emptyRecord());

function show(module) {
  const item = record(module);
  console.log(`\n${module.id} — ${module.title}\ntrack ${module.track} · scaffold ${module.scaffold ?? '-'} · ${item.status} · review ${item.review}\n${module.goal || module.question || ''}`);
  console.log('\nDocs:');
  docs(module).forEach(doc => console.log(` - ${doc}`));
  console.log('\nCriterios:');
  module.criteria.forEach((criterion, index) => console.log(` [${item.manualCriteria?.[`AC${index + 1}`] ? 'x' : ' '}] AC${index + 1} ${criterion}`));
  if (item.lastCheck) console.log(`\nCheck ${item.lastCheck.passed}/${item.lastCheck.total}`);
}

try {
  if (!catalog.modules.length && ['list', 'status'].includes(action)) {
    console.log('Todavía no hay etapas. Creá la primera con module-builder: ver 06-CREAR-MODULOS.md.');
  } else if (action === 'list') {
    for (const [track, meta] of Object.entries(catalog.tracks)) {
      console.log(`\n${meta.title || track}`);
      catalog.modules
        .filter(module => module.track === track)
        .sort((left, right) => learningOrder(left) - learningOrder(right))
        .forEach(module => {
          const status = state.modules[module.id]?.status;
          console.log(`${status === 'done' ? '✓' : status === 'in_progress' ? '→' : '·'} ${module.id} ${module.title} [${module.scaffold ?? '-'}]`);
        });
    }
  } else if (action === 'show') {
    show(getModule(catalog, key || state.currentModule || catalog.modules[0]?.id));
  } else if (action === 'start') {
    const module = getModule(catalog, key);
    const blocked = module.depends.filter(id => state.modules[id]?.status !== 'done');
    if (blocked.length) throw new Error(`Dependencias pendientes: ${blocked.join(', ')}`);
    state.currentModule = module.id;
    record(module).status = 'in_progress';
    save(state);
    console.log(`Actual: ${module.id}. Abrí ${docs(module)[0]}`);
  } else if (action === 'review') {
    const module = getModule(catalog, key);
    const item = record(module);
    if (!['pass', 'fail', 'pending'].includes(value)) throw new Error('review: pass|fail|pending');
    if (item.review) {
      item.reviewHistory = [{value: item.review, at: item.reviewAt || null, evidenceHash: item.reviewEvidenceHash || null}, ...(item.reviewHistory || [])].slice(0, 30);
    }
    item.review = value;
    item.reviewAt = new Date().toISOString();
    item.reviewEvidenceHash = evidenceSnapshot(module).hash;
    delete item.reviewStaleAt;
    delete item.reviewStaleReason;
    save(state);
    console.log(`Review ${module.id}: ${value}`);
  } else if (action === 'done') {
    const module = getModule(catalog, key);
    const requirements = completionRequirements(module, state, record(module), evidenceSnapshot(module));
    if (!requirements.ready) throw new Error(`No se puede completar:\n- ${requirements.missing.join('\n- ')}`);
    record(module).status = 'done';
    save(state);
    console.log(`✓ ${module.id}`);
  } else if (action === 'reset') {
    const module = getModule(catalog, key);
    state.modules[module.id] = emptyRecord();
    save(state);
    console.log(`Reset ${module.id}; no se tocó código.`);
  } else if (action === 'status') {
    const summary = stats(catalog, state);
    const current = catalog.modules.find(module => module.id === state.currentModule) || catalog.modules[0];
    console.log(`Progreso ${summary.done}/${summary.total} (${summary.percent}%) · actual ${state.currentModule || 'ninguna'}`);
    show(current);
  } else {
    throw new Error('Uso: list|show|start|review|done|reset|status');
  }
} catch (error) {
  console.error(`[course] ${error.message}`);
  process.exitCode = 1;
}
