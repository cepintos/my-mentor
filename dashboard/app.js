import {routeFor, routeModules, routeProgress, nextInRoute} from './course-routes.mjs';
import {renderMarkdown} from './markdown.js';

let data;
let selectedRoute;
try { selectedRoute = localStorage.getItem('mentor-route'); } catch {}
let selectedId;
let activeTab = 'journey';
let activeRunId;
let activeRun;
let pollTimer;
let refreshTimer;
let sourceChanged = false;
let liveConnected = false;
// Phase sections the learner opened or closed by hand ("A00:build" → open?); the rest follow the current phase.
const phaseOpen = new Map();

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {'content-type': 'application/json'},
    ...options,
  });
  const result = response.headers.get('content-type')?.includes('json')
    ? await response.json()
    : await response.text();
  if (!response.ok) throw new Error(result.error || result || `HTTP ${response.status}`);
  return result;
}

// All documents open in the concept library (dashboard/reader.html); one named tab is reused.
const READER_TAB = 'biblioteca-de-conceptos';
const readerUrl = path => `/reader.html?doc=${encodeURIComponent(path)}`;
const openReader = path => window.open(readerUrl(path), READER_TAB)?.focus();

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 2600);
}

// A fresh copy of the core has no course yet: the page then shows how to create one (renderEmptyCourse).
const hasModules = () => Boolean(data?.catalog.modules.length);
const currentModule = () => data.catalog.modules.find(module => module.id === data.state.currentModule) || data.catalog.modules[0];
const selectedModule = () => data.catalog.modules.find(module => module.id === selectedId) || currentModule();
const isUnlocked = module => module.depends.every(id => data.state.modules[id]?.status === 'done');
const statusName = status => ({not_started: 'No iniciado', in_progress: 'En curso', done: 'Listo'}[status] || status);
const reviewName = review => ({pending: 'Pending', pass: 'Pass', fail: 'Fail'}[review] || review);
const runStatusName = status => ({running: 'Ejecutando', passed: 'PASS', partial: 'Revisión parcial', failed: 'FAIL'}[status] || status);
const checkPassed = module => Boolean(module.state.completion?.freshCheck);

function checkedCriteriaCount(module) {
  return Object.values(module.state.manualCriteria || {}).filter(Boolean).length;
}

const moduleById = id => data.catalog.modules.find(module => module.id === id);
const questionFor = module => module.question || module.goal;
const missingDependencies = module => module.depends.filter(id => data.state.modules[id]?.status !== 'done');

function nodeState(module) {
  if (module.state.status === 'done') return 'done';
  if (module.state.status === 'in_progress') return 'in_progress';
  return isUnlocked(module) ? 'available' : 'locked';
}

function relativeTime(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'hace instantes';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

// Signals come only from recorded evidence; nothing here is estimated.
function signalsFor(module) {
  const record = module.state;
  const check = record.lastCheck;
  const signals = [];
  if (record.review === 'fail') signals.push({level: 'bad', text: 'Review FAIL: revisá la devolución antes de seguir'});
  if (check && check.passed < check.total) {
    const failing = (check.results || []).filter(result => result.required && !result.pass);
    signals.push({level: 'bad', text: `${check.passed}/${check.total} checks · ${failing.map(result => (result.path || '').split('/').pop()).slice(0, 2).join(', ')}`});
  } else if (check && !record.completion?.freshCheck) {
    signals.push({level: 'warn', text: 'La evidencia cambió después del último check'});
  }
  if (record.review === 'pass' && !record.completion?.freshReview) signals.push({level: 'warn', text: 'Review PASS quedó stale frente a la evidencia actual'});
  if (record.status === 'in_progress' && !check) signals.push({level: 'info', text: 'En curso, todavía sin validar'});
  return signals;
}

function renderLiveStatus(message) {
  const status = $('#liveStatus');
  status.classList.toggle('connected', liveConnected);
  status.classList.toggle('changed', sourceChanged);
  status.lastChild.textContent = ` ${message}`;
}

function nextRecommended() {
  return nextInRoute(data.catalog, data.state, selectedRoute);
}

function renderRouteChoice() {
  const route = routeFor(data.catalog, selectedRoute);
  $('#learningRoute').disabled = false;
  $('#learningRoute').innerHTML = data.catalog.routes.map(item =>
    `<option value="${escapeHtml(item.id)}" ${item.id === route.id ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('');
  const modules = routeModules(data.catalog, route.id);
  $('#pathStrip').innerHTML = modules.map(module => {
    const state = nodeState(module);
    const missing = missingDependencies(module);
    const hint = state === 'locked' ? `Requiere ${missing.join(', ')}` : statusName(module.state.status);
    return `<li><button type="button" class="path-node ${state} ${module.id === data.state.currentModule ? 'current' : ''} ${module.id === selectedId ? 'selected' : ''}"
      data-select="${module.id}" title="${escapeHtml(`${module.id} — ${module.title} · ${hint}`)}" aria-label="${escapeHtml(`${module.id} ${module.title}: ${hint}`)}">${escapeHtml(module.id)}</button></li>`;
  }).join('');
}

function renderContext() {
  const module = currentModule();
  const route = routeFor(data.catalog, selectedRoute);
  const progress = routeProgress(data.catalog, data.state, route.id);
  $('#contextLine').textContent = `${route.title} · ${progress.done}/${progress.total} etapas · actual ${module.id}`;
}

function renderSignals() {
  const signals = routeModules(data.catalog, selectedRoute)
    .flatMap(module => signalsFor(module).map(signal => ({...signal, module})))
    .sort((left, right) => ['bad', 'warn', 'info'].indexOf(left.level) - ['bad', 'warn', 'info'].indexOf(right.level));
  $('#weakAreas').innerHTML = signals.length
    ? signals.slice(0, 6).map(({level, text, module}) => `<li class="signal ${level}"><button type="button" class="link-button" data-focus="${module.id}"><b>${escapeHtml(module.id)}</b> ${escapeHtml(module.title)}</button><span>${escapeHtml(text)}</span></li>`).join('')
    : '<li class="empty">Sin señales todavía. Aparecen cuando validás una etapa o marcás un review.</li>';
  renderRecentActivity();
}

function renderRecentActivity() {
  const runs = (data.state.runs || []).slice(0, 6);
  $('#recentActivity').innerHTML = runs.length
    ? runs.map(run => `<li class="activity ${escapeHtml(run.status)}"><span class="status-chip">${escapeHtml(runStatusName(run.status))}</span><span><b>${escapeHtml(run.label)}</b><small>${escapeHtml(run.moduleId || 'global')} · ${escapeHtml(relativeTime(run.endedAt || run.startedAt))}</small></span></li>`).join('')
    : '<li class="empty">Todavía no ejecutaste acciones desde el dashboard.</li>';
}

const docEnding = (module, name) => module.docs.find(doc => doc.endsWith(name)) || module.docs[0];
const fileName = path => String(path).split('/').pop();

// The learning loop of every stage. Each phase reports only recorded or observable facts.
const PHASES = [
  {id: 'learn', label: 'Entender'},
  {id: 'build', label: 'Hacer'},
  {id: 'verify', label: 'Comprobar'},
  {id: 'close', label: 'Cerrar'},
];

const documentTitles = {
  '00': 'Empezá acá', '01': 'Brief', '02': 'Conceptos', '03': 'Guía de lenguaje', '04': 'Arquitectura',
  '05': 'Ejemplos', '06': 'Plan de implementación', '07': 'Criterios de aceptación', '08': 'Plan de pruebas',
  '09': 'Fallos comunes', '10': 'Fuentes', '11': 'Prompt de review', '12': 'Guía web', '13': 'Anatomía del ecosistema',
};

const documentDescriptions = {
  '00': 'Orden de lectura y primer movimiento',
  '01': 'Problema, alcance y resultado esperado',
  '02': 'Conceptos que necesitás para esta etapa',
  '03': 'Sintaxis y lenguaje justo a tiempo',
  '04': 'Mapa de componentes y fronteras',
  '05': 'Ejemplos pequeños para comparar',
  '06': 'Secuencia sugerida de implementación',
  '07': 'Qué tiene que quedar demostrado',
  '08': 'Casos y escenarios que conviene probar',
  '09': 'Síntomas típicos y dónde mirar',
  '10': 'Documentación oficial seleccionada',
  '11': 'Contexto para pedir el review final',
  '12': 'Guía web explicada y curada',
  '13': 'Qué archivos y herramientas reales intervienen',
};

const docTitle = name => `${name.slice(0, 2)} · ${documentTitles[name.slice(0, 2)] || name.replace(/^\d\d-|\.md$/g, '')}`;

function docLink(module, name) {
  const doc = module.docs.find(item => item.endsWith(name));
  return doc
    ? `<a href="${escapeHtml(readerUrl(doc))}" target="${READER_TAB}">${escapeHtml(docTitle(name))}</a>`
    : `<code>${escapeHtml(name)}</code>`;
}

const commandById = id => data.commands.find(command => command.id === id);
const isRunning = (commandId, moduleId) => data.activeRuns.some(run =>
  run.status === 'running' && run.commandId === commandId && (!moduleId || run.moduleId === moduleId));

// The single next thing to do for a module, in learning order: read, work on the lab, check, close.
// Reading marks are what the learner ticked; lab status is the file content right now.
function nextAction(module) {
  const record = module.state;
  const completion = record.completion || {};
  const reading = record.reading || [];
  const lab = record.lab || [];
  if (record.status === 'done') return {phase: PHASES.length, title: 'Etapa completada', note: 'El material sigue disponible para repasar.'};
  if (!isUnlocked(module)) return {phase: -1, title: 'Etapa bloqueada', note: `Primero completá ${missingDependencies(module).join(', ')}.`};
  if (record.status === 'not_started') {
    return {phase: 0, title: 'Empezá por la guía de la etapa', label: 'Empezar la etapa', kind: 'start', doc: docEnding(module, '00-EMPEZA-ACA.md'),
      note: 'Abre 00 · Empezá acá en la biblioteca: el orden de lectura y qué vas a entregar.'};
  }
  const unread = reading.find(item => !item.read);
  if (unread && !lab.some(item => item.pass)) {
    return {phase: 0, title: `Leé ${docTitle(unread.name)}`, label: 'Abrir en la biblioteca', kind: 'doc', doc: unread.path, readName: unread.name,
      note: `${documentDescriptions[unread.name.slice(0, 2)] || 'Material de la etapa'}. Al terminar, marcalo como leído al pie del documento o con “Ya lo leí”.`};
  }
  const pending = lab.find(item => !item.pass);
  if (pending) {
    const editor = data.capabilities?.editor;
    return {phase: 1, title: `Completá ${fileName(pending.path)}`, path: pending.path, detail: pending.detail,
      label: editor ? `Abrir en ${editor}` : 'Copiar ruta', kind: editor ? 'open' : 'copy', index: pending.index,
      note: 'Seguí 06 · Plan de implementación, un paso por vez. Cuando guardes el archivo sin TODO_LEARNER, el dashboard pasa solo al siguiente.'};
  }
  if (!completion.freshCheck) {
    return {phase: 2, title: lab.length ? 'Tus archivos están listos: registrá la evidencia' : 'Registrá la evidencia', label: 'Validar evidencia', kind: 'command', command: 'course-check',
      note: 'El check confirma lo verificable (marcadores, comandos); el razonamiento lo mira el review.'};
  }
  if (checkedCriteriaCount(module) < module.criteria.length) {
    return {phase: 2, title: 'Marcá los criterios que cumple tu evidencia', label: 'Ir a los criterios', kind: 'scroll',
      note: 'Releé tus archivos con cada criterio al lado y marcá sólo lo que podés mostrar.'};
  }
  if (!completion.freshReview) {
    return commandById('mentor-review')?.available
      ? {phase: 3, title: 'Pedí el review final', label: 'Pedir review al mentor', kind: 'command', command: 'mentor-review', note: 'Cuando leas la devolución, marcá Pass o Fail en Cerrar.'}
      : {phase: 3, title: 'Pedí el review final', label: 'Abrir prompt de review', kind: 'doc', doc: docEnding(module, '11-PROMPT-DE-REVIEW.md'), note: 'Pegalo en tu agente y marcá Pass o Fail en Cerrar.'};
  }
  return {phase: 3, title: 'Todo listo para cerrar', label: 'Completar etapa', kind: 'done', note: 'Checks, criterios y review corresponden a la evidencia actual.'};
}

function phaseSummary(module, phaseId) {
  const record = module.state;
  if (phaseId === 'learn') {
    const reading = record.reading || [];
    return `${reading.filter(item => item.read).length}/${reading.length} leídos`;
  }
  if (phaseId === 'build') {
    const lab = record.lab || [];
    return `${lab.filter(item => item.pass).length}/${lab.length} archivos`;
  }
  if (phaseId === 'verify') {
    const check = record.lastCheck;
    const checkText = record.completion?.freshCheck ? 'check ✓' : check ? `check ${check.passed}/${check.total}` : 'sin check';
    return `${checkText} · ${checkedCriteriaCount(module)}/${module.criteria.length} criterios`;
  }
  return `review ${reviewName(record.review).toLowerCase()}`;
}

function renderModuleHeader(module, action) {
  const running = action.command && isRunning(action.command, module.id);
  const stepper = action.phase >= 0 ? `<ol class="phase-stepper" aria-label="Fases de la etapa">${PHASES.map((phase, index) => {
    const state = index < action.phase ? 'done' : index === action.phase ? 'current' : '';
    return `<li class="${state}" ${state === 'current' ? 'aria-current="step"' : ''}><b>${phase.label}</b><span>${escapeHtml(phaseSummary(module, phase.id))}</span></li>`;
  }).join('')}</ol>` : '';
  const phaseLabel = PHASES[action.phase]?.label;
  const primary = action.label
    ? `<button id="primaryAction" type="button" class="${running ? 'is-loading' : ''}" ${running ? 'disabled aria-busy="true"' : ''}>${running ? '<span class="spinner" aria-hidden="true"></span> Ejecutando…' : escapeHtml(action.label)}</button>`
    : '';
  const alreadyRead = action.readName ? `<button type="button" class="quiet" data-read="${escapeHtml(action.readName)}">Ya lo leí</button>` : '';
  const help = action.phase === 1 && chispa?.available
    ? `<button type="button" class="link-button help-link" data-chispa-ask="hint">¿Trabado? Pedile una pista a Chispa</button>`
    : '';
  return `<div class="module-kicker"><span class="module-id">${escapeHtml(module.id)}</span><span class="pill ${nodeState(module)}">${escapeHtml(statusName(module.state.status))}</span></div>
    <h2>${escapeHtml(module.title)}</h2>
    <p class="module-question">${escapeHtml(questionFor(module))}</p>
    ${stepper}
    <section class="next-step ${action.label ? '' : 'quiet-step'}" aria-labelledby="nextStepTitle">
      <small>${phaseLabel ? `TU PRÓXIMO PASO · ${phaseLabel.toUpperCase()}` : 'ESTADO'}</small>
      <h3 id="nextStepTitle">${escapeHtml(action.title)}</h3>
      ${action.path ? `<p class="next-step-path"><code>${escapeHtml(action.path)}</code> · ${escapeHtml(action.detail)}</p>` : ''}
      ${primary || alreadyRead || help ? `<div class="next-step-actions">${primary}${alreadyRead}${help}</div>` : ''}
      <p class="next-step-note">${escapeHtml(action.note)}</p>
    </section>`;
}

function evidenceLabel(check) {
  if (check.label) return check.label;
  if (check.kind === 'command') {
    if (check.command === 'doctor') return 'Entorno comprobado';
    return `Prueba ejecutable: ${commandById(check.command)?.label || check.command}`;
  }
  return `Evidencia: ${fileName(check.path || '')}`;
}

function resultState(result, stale) {
  if (stale && result?.pass) return 'stale';
  if (!result) return 'not-run';
  if (result.status) return result.status.toLowerCase().replace(/\s+/g, '-');
  return result.pass ? 'pass' : 'fail';
}

function resultIcon(state) {
  return ({pass: '✓', fail: '×', skip: '↷', 'not-run': '·', stale: '!'})[state] || '·';
}

// Why a recorded check no longer matches the files. A module.json change comes from the course, not the learner.
function staleText(check) {
  const changed = String(check?.staleReason || '').replace(/^Cambió\s+/, '');
  if (changed.endsWith('/module.json')) return 'El curso actualizó la definición de la etapa después de ese check.';
  if (changed) return `Cambió ${fileName(changed)} después de ese check.`;
  return 'Los archivos de la etapa cambiaron después de ese check.';
}

function checkSummary(module) {
  const check = module.state.lastCheck;
  if (!check) return 'Todavía no validaste esta etapa.';
  const when = relativeTime(check.at);
  if (module.state.completion?.freshCheck) return `Check al día: ${check.passed}/${check.total} · ${when}.`;
  if (check.passed < check.total) return `Último check: ${check.passed}/${check.total} · ${when}.`;
  return `Último check: ${check.passed}/${check.total} · ${when}. ${staleText(check)}`;
}

function commandButton(command, module) {
  const running = isRunning(command.id, command.requiresModule ? module.id : null);
  const locked = command.lockedBy.length > 0;
  const disabledReason = locked ? `Recurso ocupado por ${command.lockedBy.map(item => item.label).join(', ')}` : '';
  return `<button class="runbtn ${running ? 'is-loading' : ''}" data-command="${command.id}" ${command.requiresModule ? `data-module="${module.id}"` : ''} ${running || locked ? `disabled title="${escapeHtml(disabledReason)}"` : ''} ${running ? 'aria-busy="true"' : ''}>
      <b>${running ? '<span class="spinner" aria-hidden="true"></span> Ejecutando…' : escapeHtml(command.label)}</b>
      <span>${escapeHtml(command.description)}${command.long ? ' Puede tardar varios minutos.' : ''}${command.confirmation ? ' Pedirá confirmación.' : ''}${disabledReason ? ` ${escapeHtml(disabledReason)}.` : ''}</span>
    </button>`;
}

function phaseSection(module, action, index, body) {
  const phase = PHASES[index];
  const key = `${module.id}:${phase.id}`;
  const current = index === action.phase;
  const open = phaseOpen.has(key) ? phaseOpen.get(key) : current;
  const state = index < action.phase ? 'done' : current ? 'current' : 'pending';
  return `<details class="phase-section ${state}" id="phase-${phase.id}" data-phase-key="${key}" ${open ? 'open' : ''}>
    <summary><span class="phase-index" aria-hidden="true">${state === 'done' ? '✓' : index + 1}</span><b>${phase.label}</b><span class="phase-count">${escapeHtml(phaseSummary(module, phase.id))}</span></summary>
    <div class="phase-body">${body}</div>
  </details>`;
}

function renderJourney(module, action) {
  const record = module.state;
  const reading = record.reading || [];
  const lab = record.lab || [];
  const editor = data.capabilities?.editor;
  const notStarted = record.status === 'not_started';

  const learn = reading.length
    ? `<p class="phase-hint">Leé en este orden y marcá cada documento al terminarlo. Es tu registro: nadie lo valida.</p>
      <ul class="reading-list">${reading.map(item => `<li>
        <label class="check"><input type="checkbox" data-read="${escapeHtml(item.name)}" ${item.read ? 'checked' : ''}>
          <span><b>${escapeHtml(item.name.slice(0, 2))}</b> ${escapeHtml(documentTitles[item.name.slice(0, 2)] || item.name)}<small>${escapeHtml(documentDescriptions[item.name.slice(0, 2)] || '')}</small></span></label>
        <a class="row-link" href="${escapeHtml(readerUrl(item.path))}" target="${READER_TAB}">Abrir ↗</a>
      </li>`).join('')}</ul>`
    : '<p class="phase-hint">Esta etapa no tiene lectura previa propia: empezá por el plan.</p>';

  const tools = data.commands.filter(command => command.available && command.recommendedFor.includes(module.id)
    && command.id !== 'course-check' && command.group !== 'mentor');
  const build = `<p class="phase-hint">Tu entregable vive en <code>${escapeHtml(module.deliverable)}</code>. Seguí ${docLink(module, '06-PLAN-DE-IMPLEMENTACION.md')}; si algo falla, ${docLink(module, '09-FALLOS-COMUNES.md')}.</p>
    ${lab.length ? `<ol class="evidence-list lab-list">${lab.map(item => `<li class="evidence ${item.pass ? 'pass' : 'fail'}">
        <span class="status-icon" aria-hidden="true">${item.pass ? '✓' : '×'}</span>
        <span><b>${escapeHtml(fileName(item.path))}</b><small>${escapeHtml(item.path)} · ${escapeHtml(item.pass ? 'sin marcadores pendientes' : item.detail)}</small></span>
        <span class="row-actions">${editor ? `<button type="button" class="quiet" data-open-lab="${item.index}">Abrir</button>` : ''}<button type="button" class="quiet" data-copy="${escapeHtml(item.path)}">Copiar ruta</button></span>
      </li>`).join('')}</ol>
      <p class="hint">Se actualiza al guardar. Verde sólo significa que no quedan marcadores; el contenido lo juzga el review.</p>` : ''}
    ${tools.length ? `<div class="phase-tools"><small>HERRAMIENTAS DE ESTA ETAPA</small><div class="action-grid">${tools.map(command => commandButton(command, module)).join('')}</div></div>` : ''}`;

  const latestResults = new Map((record.lastCheck?.results || []).map(result => [result.path, result]));
  const stale = Boolean(record.lastCheck && !record.completion?.freshCheck);
  const otherChecks = module.checks.filter(check => !['file', 'contains'].includes(check.kind)).map(check => {
    const target = check.kind === 'command' ? `command:${check.command}` : check.path;
    const result = latestResults.get(target);
    const state = resultState(result, stale);
    const detail = state === 'stale' ? 'pasó, pero la evidencia cambió después' : result ? result.detail : 'sin validar';
    return `<li class="evidence ${state}" title="${escapeHtml(target)}"><span class="status-icon" aria-hidden="true">${resultIcon(state)}</span><span><b>${escapeHtml(evidenceLabel(check))}</b><small>${escapeHtml(detail)}</small></span></li>`;
  }).join('');
  const checking = isRunning('course-check', module.id);
  const criteria = module.criteria.map((criterion, index) => `
    <label class="check">
      <input type="checkbox" data-criterion="${index}" ${record.manualCriteria?.[`AC${index + 1}`] ? 'checked' : ''} ${notStarted ? 'disabled' : ''}>
      <span><b>AC${index + 1}</b> ${escapeHtml(criterion)}</span>
    </label>`).join('');
  const verify = `<div class="check-summary"><p>${escapeHtml(checkSummary(module))}</p>
      <button type="button" class="quiet ${checking ? 'is-loading' : ''}" data-command="course-check" data-module="${module.id}" ${checking || notStarted ? 'disabled' : ''}>${checking ? '<span class="spinner" aria-hidden="true"></span> Validando…' : 'Validar evidencia'}</button></div>
    ${otherChecks ? `<ol class="evidence-list">${otherChecks}</ol>` : ''}
    <div id="criteria" class="criteria-block">
      <div class="section-heading"><h3>Criterios</h3><span>${checkedCriteriaCount(module)}/${module.criteria.length}</span></div>
      ${criteria}
    </div>`;

  const canReview = action.phase >= 3 || record.review !== 'pending';
  const reviewer = commandById('mentor-review')?.available
    ? 'tu mentor, con “Pedir review al mentor”'
    : `tu agente, con ${docLink(module, '11-PROMPT-DE-REVIEW.md')}`;
  const close = `${canReview ? `<div class="review-row"><span>Resultado del review: <b>${escapeHtml(reviewName(record.review))}</b>${record.reviewStaleAt ? ' · quedó stale' : ''}</span>
      <div class="review-options" role="group" aria-label="Resultado del review">
        ${['pass', 'fail'].map(value => `<button type="button" class="review-option review-${value}" data-review="${value}" aria-pressed="${record.review === value}"><span class="review-dot" aria-hidden="true"></span>${reviewName(value)}</button>`).join('')}
      </div></div>` : '<p class="phase-hint">Se habilita cuando el check está al día y marcaste los criterios.</p>'}
    <p class="phase-hint">El review lo hace ${reviewer}: revisa contra los criterios y no parchea tu código.${commandById('mentor-review')?.available ? '' : ` Para pedirlo desde acá, configurá el agente de review (<a href="${escapeHtml(readerUrl('04-COMO-USAR-EL-MENTOR.md'))}" target="${READER_TAB}">cómo</a>).`}</p>`;

  const info = [
    module.requirements ? `<details class="mission-section"><summary>Qué puede demostrar cada entorno</summary><div class="requirements-grid">${Object.entries(module.requirements).map(([label, value]) => `<div><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`).join('')}</div></details>` : '',
    module.gates ? `<details class="mission-section"><summary>Gates independientes</summary><div class="requirements-grid">${module.gates.map(gate => `<div><b>${escapeHtml(gate.id)} · ${escapeHtml(gate.title)}</b><span>${escapeHtml(gate.core)}</span></div>`).join('')}</div></details>` : '',
  ].join('');

  return `<p class="module-goal">${escapeHtml(module.goal)}</p>
    ${[learn, build, verify, close].map((body, index) => phaseSection(module, action, index, body)).join('')}
    ${info}`;
}

const GROUP_LABELS = {
  quality: ['Validación', 'Convertí tus cambios en evidencia automática.'],
  course: ['Herramientas del curso', 'Comandos que declara el curso en course/catalog.json; ninguno acepta texto libre.'],
  maintenance: ['Mantenimiento', 'Tareas explícitas que define el curso, como limpiar artefactos regenerables.'],
};

function commandGroups(commands, module) {
  return Object.entries(GROUP_LABELS).map(([group, [title, description]]) => {
    const groupCommands = commands.filter(command => command.group === group);
    if (!groupCommands.length) return '';
    return `<section class="action-group"><div><h3>${title}</h3><p>${description}</p></div><div class="action-grid">${groupCommands.map(command => commandButton(command, module)).join('')}</div></section>`;
  }).join('');
}

function environmentSection() {
  return `<section class="environment-status">
    <div class="section-heading"><div><small>ENTORNO</small><h3>${data.environment.doctorExecuted ? 'Doctor ejecutado' : 'Doctor todavía NOT RUN'}</h3></div><span>${data.environment.toolchainReady ? 'ENTORNO LISTO' : 'ENTORNO NO DEMOSTRADO'}</span></div>
    <p>Ejecutar y comprender el doctor es evidencia pedagógica; tener todas las herramientas listas es un estado distinto.</p>
    ${data.environment.results.filter(result => ['FAIL', 'WARN'].includes(result.status)).map(result => `<article class="remediation-card ${result.status.toLowerCase()}"><b>${escapeHtml(result.status)} · ${escapeHtml(result.name)}</b><span>${escapeHtml(result.detail)}</span><p>${escapeHtml(result.remediation)}</p></article>`).join('')}
  </section>`;
}

// Entries of course/catalog.json that the server refused to run; npm run check explains each one.
function catalogProblems() {
  const problems = data.catalog.commandProblems || [];
  return problems.length
    ? `<article class="remediation-card fail"><b>course/catalog.json tiene entradas que no se pueden usar</b><span>${problems.map(escapeHtml).join('<br>')}</span><p>Corregilas y guardá: el dashboard las relee solo. npm run check muestra el detalle.</p></article>`
    : '';
}

function renderActions(module) {
  const moduleCommands = data.commands.filter(command => command.available && command.group !== 'mentor' && command.availableFor.includes(module.id));
  const recommendedIds = new Set(moduleCommands.filter(command => command.recommendedFor.includes(module.id)).map(command => command.id));
  const environment = recommendedIds.has('doctor') ? environmentSection() : '';
  // course-check lives in Comprobar, so it is not repeated among the stage's tools.
  const recommended = moduleCommands.filter(command => recommendedIds.has(command.id) && command.id !== 'course-check');
  const allTools = moduleCommands.filter(command => !recommendedIds.has(command.id) || command.id === 'course-check');
  return `${catalogProblems()}${environment}${recommended.length ? `<div class="recommended-actions"><small>LO QUE USA ${escapeHtml(module.id)}</small>${commandGroups(recommended, module)}</div>` : '<p class="hint">Esta etapa no necesita herramientas extra: todo se hace leyendo y escribiendo evidencia.</p>'}
    <details class="all-tools"><summary>Todas las herramientas (${allTools.length})</summary>${commandGroups(allTools, module)}</details>`;
}

// ---------- empty course ----------
const mentorDocLink = (doc, label) => ((data.mentorDocs || []).includes(doc)
  ? `<a class="row-link" href="${escapeHtml(readerUrl(doc))}" target="${READER_TAB}">${escapeHtml(label)} ↗</a>`
  : '');

function renderFirstSteps() {
  const doctor = commandById('doctor');
  const doctorButton = doctor?.available
    ? `<button type="button" class="quiet" data-command="doctor" ${isRunning('doctor') ? 'disabled aria-busy="true"' : ''}>${isRunning('doctor') ? 'Diagnosticando…' : 'Diagnosticar'}</button>`
    : '';
  const steps = [
    ['Diagnosticá el entorno', 'Node, git, tu agente y Chispa. No instala nada.', doctorButton],
    ['Elegí tu agente de review', 'Copiá mentor.config.example.json a mentor.config.json y poné en "active" el que uses.', mentorDocLink('04-COMO-USAR-EL-MENTOR.md', 'Cómo')],
    ['Creá el curso con module-builder', 'Te entrevista, arma un currículo con prerrequisitos y escribe los módulos cuando lo aprobás.', mentorDocLink('06-CREAR-MODULOS.md', 'Cómo')],
    ['Leé cómo enseña', 'Primero el problema y un modelo mínimo; el nombre técnico llega al final.', mentorDocLink('01-COMO-ENSENA.md', 'Leer')],
  ];
  return `<ol class="evidence-list lab-list first-steps">${steps.map(([title, note, action], index) => `<li class="evidence">
      <span class="status-icon" aria-hidden="true">${index + 1}</span>
      <span><b>${escapeHtml(title)}</b><small>${escapeHtml(note)}</small></span>
      <span class="row-actions">${action}</span>
    </li>`).join('')}</ol>`;
}

function renderMentorDocs() {
  return `<div class="doc-list">${(data.mentorDocs || []).map(doc => `
    <a class="docbtn" href="${escapeHtml(readerUrl(doc))}" target="${READER_TAB}">
      <span class="doc-number">${escapeHtml(doc.slice(0, 2))}</span>
      <span><b>${escapeHtml(doc)}</b><small>Guía del mentor</small></span>
    </a>`).join('')}</div>`;
}

function renderGlobalActions() {
  const commands = data.commands.filter(command => command.available && !command.requiresModule && command.group !== 'mentor');
  return `${catalogProblems()}${environmentSection()}${commandGroups(commands, null)}`;
}

function renderEmptyCourse() {
  $('#learningRoute').innerHTML = '<option>Sin recorridos todavía</option>';
  $('#learningRoute').disabled = true;
  $('#pathStrip').innerHTML = '<li class="empty">Las etapas aparecen acá apenas module-builder las escribe.</li>';
  $('#contextLine').textContent = 'Todavía no hay etapas · creá la primera con module-builder';
  $('#moduleHeader').innerHTML = `<div class="module-kicker"><span class="module-id">INICIO</span><span class="pill available">Sin curso todavía</span></div>
    <h2>Tu mentor está listo; falta el curso</h2>
    <p class="module-question">¿Qué querés aprender?</p>
    <section class="next-step" aria-labelledby="nextStepTitle">
      <small>TU PRÓXIMO PASO</small>
      <h3 id="nextStepTitle">Creá tu primer módulo con module-builder</h3>
      <div class="next-step-actions"><button id="primaryAction" type="button">Cómo crear módulos</button><button type="button" class="quiet" data-copy="/module-builder">Copiar /module-builder</button></div>
      <p class="next-step-note">Abrí tu agente en esta carpeta y pedí <code>/module-builder</code> (Claude Code) o <code>$module-builder</code> (Codex). Te pregunta qué querés aprender y qué querés poder hacer, arma un currículo y, cuando lo aprobás, escribe los módulos en <code>course/</code>. Esta página los muestra sola.</p>
    </section>`;
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === activeTab));
  $('#tab').innerHTML = activeTab === 'docs' ? renderMentorDocs() : activeTab === 'actions' ? renderGlobalActions() : renderFirstSteps();
  $('#weakAreas').innerHTML = '<li class="empty">Sin señales todavía. Aparecen cuando validás una etapa o marcás un review.</li>';
  renderRecentActivity();
  renderChispaChips();
}

const renderView = () => (hasModules() ? renderModule() : renderEmptyCourse());

function renderMaterial(module) {
  const referenceIndex = (data.catalog.references || []).find(doc => doc === `course/${module.track}/referencia/00-INDICE.md`);
  const docs = module.docs.map((doc, index) => `
    <a class="docbtn" href="${escapeHtml(readerUrl(doc))}" target="${READER_TAB}">
      <span class="doc-number">${String(index).padStart(2, '0')}</span>
      <span><b>${escapeHtml(fileName(doc))}</b><small>${escapeHtml(documentDescriptions[fileName(doc).slice(0, 2)] || 'Material complementario')}</small></span>
    </a>`).join('');
  return `${referenceIndex ? `<a class="docbtn reference-link" href="${escapeHtml(readerUrl(referenceIndex))}" target="${READER_TAB}"><span class="doc-number">ref</span><span><b>Biblioteca de conceptos ↗</b><small>Todo el material se abre ahí, en otra pestaña y sin internet</small></span></a>` : ''}
    <div class="doc-list">${docs}</div>
    <details class="notes"><summary>Notas personales</summary>
      <textarea id="notes" data-module="${module.id}" placeholder="Opcionales; no son evidencia. Se guardan al salir del campo.">${escapeHtml(module.state.notes || '')}</textarea>
    </details>`;
}

function renderModule() {
  const module = selectedModule();
  selectedId = module.id;
  const action = nextAction(module);
  $('#moduleHeader').innerHTML = renderModuleHeader(module, action);
  renderChispaChips();
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === activeTab));
  // A live refresh must not wipe notes the learner is still typing.
  if (document.activeElement?.id === 'notes' && document.activeElement.dataset.module === module.id) return;
  if (activeTab === 'journey') $('#tab').innerHTML = renderJourney(module, action);
  else if (activeTab === 'docs') $('#tab').innerHTML = renderMaterial(module);
  else $('#tab').innerHTML = renderActions(module);
}

async function openLab(index) {
  const result = await api('/api/open', {method: 'POST', body: JSON.stringify({moduleId: selectedModule().id, index})});
  toast(`Abriendo ${fileName(result.opened)} en ${result.editor}`);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copiado: ${text}`);
  } catch {
    toast('No se pudo copiar; seleccioná el texto a mano');
  }
}

function focusPhase(module, phaseId, targetId) {
  phaseOpen.set(`${module.id}:${phaseId}`, true);
  activeTab = 'journey';
  renderModule();
  bindDynamic();
  document.getElementById(targetId || `phase-${phaseId}`)?.scrollIntoView({behavior: 'smooth', block: 'start'});
}

// ---------- Chispa ----------
// The panel keeps its own state: a dashboard refresh never wipes the draft or the conversation.
let chispa = null;
let chispaFresh = false;
// Sunglasses are Chispa's signature; a tap (or, a third of the time, the mood of the day) flips them.
let chispaGag = Math.random() < 0.33;

const MOOD_TEXT = {
  idle: '¡Cargada al 100%! ⚡',
  thinking: 'Procesando a mil voltios…',
  happy: '¡ZAAAP! Pasó tu última ejecución 😎',
  worried: 'Cortocircuito detectado: ¿lo miramos juntos?',
  sleepy: 'Batería baja… ¡volvé y me recargás!',
};

const CHISPA_QUIPS = [
  '¡Bzzzt! Cosquillas de alto voltaje ⚡',
  'Me puse los lentes porque tu futuro brilla demasiado 😎',
  '1,21 gigawatts… mentira, funciono con 5 voltios y entusiasmo.',
  '¿Sabías que soy 100% energía renovable? Me recargo con tus commits.',
  'Dato: un rayo dura 0,2 s. Un TODO_LEARNER sin tocar, ¡semanas! Vamos ⚡',
  'Hoy no hay cortocircuitos, hay chispazos de genialidad.',
  'Si me tocás de nuevo me enchufo a tu cargador del celular 🔌',
];

function chispaGreeting() {
  const name = chispa?.learnerName ? `, ${chispa.learnerName}` : '';
  if (!hasModules()) {
    return `¡ZAP! ⚡ ¡Hola${name}! Soy Chispa. Todavía no hay etapas: contame qué querés aprender y lo pensamos juntos. Los módulos los escribe **module-builder** en tu agente; yo te acompaño en cada etapa. ¿Le damos voltaje?`;
  }
  const module = selectedModule();
  const action = nextAction(module);
  const phase = PHASES[action.phase]?.label;
  const away = chispa?.hoursSinceProgress >= 48 ? ` Hace ${Math.round(chispa.hoursSinceProgress / 24)} días que no hacemos contacto, pero tranqui: un pasito chiquito y volvemos a encender todo.` : '';
  return `¡ZAP! ⚡ ¡Hola${name}! Soy Chispa y vengo cargadísima. Estás en **${module.id}**${phase ? ` · ${phase}` : ''}: ${action.title.toLowerCase()}.${away} ¿Le damos voltaje?`;
}

function chispaBubble(message, streaming = false) {
  const tools = (message.tools || []).length
    ? `<details class="chispa-tools"><summary>Usó ${message.tools.length} ${message.tools.length === 1 ? 'herramienta' : 'herramientas'}</summary><ul>${message.tools.map(tool => `<li><code>${escapeHtml(tool.name)}</code>${tool.detail ? ` ${escapeHtml(tool.detail)}` : ''}</li>`).join('')}</ul></details>`
    : '';
  if (message.role === 'user') return `<li class="chispa-message from-user"><div class="chispa-bubble">${escapeHtml(message.text)}</div></li>`;
  const body = message.text ? renderMarkdown(message.text) : streaming ? '<p class="chispa-typing"><span></span><span></span><span></span></p>' : '';
  return `<li class="chispa-message from-chispa ${streaming ? 'streaming' : ''}"><div class="chispa-bubble markdown-body">${body}${message.error ? `<p class="chispa-error">No pude terminar: ${escapeHtml(message.error)}</p>` : ''}</div>${tools}</li>`;
}

function renderChispaMessages() {
  const list = $('#chispaMessages');
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const messages = chispaFresh ? [] : chispa?.conversation?.messages || [];
  const turn = chispa?.turn && !chispaFresh ? chispa.turn : null;
  list.innerHTML = [
    ...(messages.length ? [] : [chispaBubble({role: 'chispa', text: chispaGreeting()})]),
    ...messages.map(message => chispaBubble(message)),
    ...(turn ? [chispaBubble({role: 'chispa', text: turn.text, tools: turn.tools}, true)] : []),
  ].join('');
  if (stick || turn) list.scrollTop = list.scrollHeight;
}

function renderChispa() {
  if (!chispa) return;
  const mood = chispa.turn ? 'thinking' : chispa.mood;
  $('#chispaAvatar').className = `chispa-avatar mood-${mood}${chispaGag ? ' gag' : ''}`;
  $('#chispaStatus').textContent = chispa.available
    ? `${MOOD_TEXT[mood] || MOOD_TEXT.idle} · ${chispa.memoryCount} ${chispa.memoryCount === 1 ? 'recuerdo' : 'recuerdos'}`
    : chispa.problem;
  $('#chispaDrafts').innerHTML = chispa.drafts.map(draft => `<article class="chispa-draft">
      <small>CHISPA QUIERE RECORDAR · ${escapeHtml(draft.tipo)} · ${escapeHtml(draft.modulo)}${draft.recuperado ? ' · volvió a pasar' : ''}</small>
      <p>${escapeHtml(draft.indicativa)}</p>
      <div><button type="button" data-shard-save="${escapeHtml(draft.id)}">Guardar</button><button type="button" class="quiet" data-shard-discard="${escapeHtml(draft.id)}">Descartar</button></div>
    </article>`).join('');
  renderChispaMessages();
  const busy = Boolean(chispa.turn) || !chispa.available;
  $('#chispaSend').disabled = busy;
  $('#chispaSend').textContent = chispa.turn ? 'Pensando…' : 'Enviar';
  document.querySelectorAll('[data-chispa-ask]').forEach(button => { button.disabled = busy; });
  bindChispa();
}

function renderChispaChips() {
  if (!data) return;
  const module = hasModules() ? selectedModule() : null;
  const phase = module ? PHASES[nextAction(module).phase]?.label : null;
  const chips = module
    ? [
      ['next', '¿Qué hago ahora?'],
      ['explain', phase ? `Explicame ${phase.toLowerCase()}` : 'Explicame esta etapa'],
      ['error', 'Tengo un error'],
      ['remember', 'Recordá esto'],
    ]
    : [
      ['start', '¿Por dónde empiezo?'],
      ['how', '¿Cómo funciona esto?'],
      ['learn', 'Quiero aprender…'],
    ];
  $('#chispaChips').innerHTML = chips.map(([id, label]) => `<button type="button" class="chispa-chip" data-chispa-ask="${id}" ${!chispa?.available || chispa?.turn ? 'disabled' : ''}>${escapeHtml(label)}</button>`).join('');
  bindChispa();
}

function chispaPrompt(kind) {
  if (!hasModules()) {
    return ({
      start: {send: 'Todavía no tengo etapas. ¿Por dónde empiezo?'},
      how: {send: 'Explicame cómo funciona este mentor: las cuatro fases de una etapa, la evidencia y el review.'},
      learn: {fill: 'Quiero aprender '},
    })[kind] || {fill: ''};
  }
  const module = selectedModule();
  const action = nextAction(module);
  const phase = PHASES[action.phase]?.label || 'actual';
  return ({
    next: {send: `¿Qué hago ahora en ${module.id}? Mirá mi estado real y proponeme un solo paso chiquito.`},
    hint: {send: `Estoy trabado en ${module.id}: ${action.title}. Dame una pista, no la solución.`},
    explain: {send: `Explicame el concepto más inmediato que necesito para la fase ${phase} de ${module.id}, con un ejemplo chico que no sea la solución.`},
    error: {fill: `Tengo este error en ${module.id}:\n\n`},
    remember: {fill: 'Quiero que recuerdes esto: '},
  })[kind];
}

async function sendToChispa(message) {
  const fresh = chispaFresh;
  await api('/api/chispa', {method: 'POST', body: JSON.stringify({message, fresh})});
  chispaFresh = false;
  $('#chispaInput').value = '';
  await refreshChispa();
}

async function refreshChispa() {
  chispa = await api('/api/chispa');
  renderChispa();
  renderChispaChips();
}

function handleChispaEvent(event) {
  if (!chispa) return;
  if (event.type === 'delta' || event.type === 'tool') {
    chispa.turn ||= {text: '', tools: []};
    if (event.type === 'delta') chispa.turn.text += event.text;
    else chispa.turn.tools.push({name: event.name, detail: event.detail});
    // Repaint only the answer being written; the rest of the panel stays as it is.
    const streaming = $('#chispaMessages .streaming');
    if (streaming) {
      streaming.outerHTML = chispaBubble({role: 'chispa', text: chispa.turn.text, tools: chispa.turn.tools}, true);
      $('#chispaMessages').scrollTop = $('#chispaMessages').scrollHeight;
    } else {
      renderChispaMessages();
    }
    return;
  }
  refreshChispa().catch(error => toast(error.message));
  if (event.type === 'turn-error') toast(`Chispa: ${event.error}`);
}

function bindChispa() {
  document.querySelectorAll('[data-chispa-ask]').forEach(button => {
    button.onclick = () => {
      const prompt = chispaPrompt(button.dataset.chispaAsk);
      if (prompt.fill) {
        $('#chispaInput').value = prompt.fill;
        $('#chispaInput').focus();
      } else {
        sendToChispa(prompt.send).catch(error => toast(error.message));
      }
    };
  });
  document.querySelectorAll('[data-shard-save], [data-shard-discard]').forEach(button => {
    button.onclick = () => {
      const save = Boolean(button.dataset.shardSave);
      api('/api/chispa/memory', {method: 'POST', body: JSON.stringify({action: save ? 'save' : 'discard', id: button.dataset.shardSave || button.dataset.shardDiscard})})
        .then(result => {
          chispa = result;
          renderChispa();
          toast(save ? 'Chispa lo va a recordar' : 'Borrador descartado');
        })
        .catch(error => toast(error.message));
    };
  });
  $('#chispaMessages').querySelectorAll('[data-doc-link]').forEach(link => {
    link.onclick = () => openReader(link.dataset.docLink);
  });
}

$('#chispaForm').addEventListener('submit', event => {
  event.preventDefault();
  const message = $('#chispaInput').value.trim();
  if (message) sendToChispa(message).catch(error => toast(error.message));
});
$('#chispaInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('#chispaForm').requestSubmit();
  }
});
$('#chispaAvatar').addEventListener('click', () => {
  const avatar = $('#chispaAvatar');
  chispaGag = !chispaGag;
  avatar.classList.toggle('gag', chispaGag);
  avatar.classList.remove('zap');
  void avatar.offsetWidth; // restart the jolt animation
  avatar.classList.add('zap');
  setTimeout(() => avatar.classList.remove('zap'), 550);
  toast(CHISPA_QUIPS[Math.floor(Math.random() * CHISPA_QUIPS.length)]);
});
$('#chispaNew').onclick = () => {
  chispaFresh = true;
  renderChispaMessages();
  $('#chispaInput').focus();
};

async function runPrimary() {
  if (!hasModules()) {
    openReader('06-CREAR-MODULOS.md');
    return;
  }
  const module = selectedModule();
  const action = nextAction(module);
  if (action.kind === 'start') {
    // Open before awaiting so the browser still treats it as a user-initiated tab.
    openReader(action.doc);
    await mutate('start');
  } else if (action.kind === 'command') {
    await runCommand(action.command, module.id);
  } else if (action.kind === 'doc') {
    openReader(action.doc);
  } else if (action.kind === 'open') {
    await openLab(action.index);
  } else if (action.kind === 'copy') {
    await copyText(action.path);
  } else if (action.kind === 'scroll') {
    focusPhase(module, 'verify', 'criteria');
  } else if (action.kind === 'done') {
    await mutate('done');
    toast(`${module.id} completada`);
  }
}

async function refresh() {
  data = await api('/api/course');
  if (!activeRun || activeRun.status !== 'running') {
    activeRun = data.activeRuns[0] || activeRun;
    activeRunId = activeRun?.status === 'running' ? activeRun.id : activeRunId;
  }
  if (hasModules()) {
    selectedRoute = routeFor(data.catalog, selectedRoute).id;
    const visibleModules = routeModules(data.catalog, selectedRoute);
    if (!visibleModules.some(module => module.id === selectedId)) {
      selectedId = visibleModules.find(module => module.id === data.state.currentModule)?.id
        || visibleModules.find(module => module.state.status !== 'done')?.id || (visibleModules[0] || data.catalog.modules[0]).id;
    }
    renderRouteChoice();
    renderContext();
    renderSignals();
    renderModule();
  } else {
    renderEmptyCourse();
  }
  renderActiveRuns();
  bindDynamic();
  if (activeRun) showRun(activeRun);
}

async function mutate(action, extra = {}) {
  await api('/api/module', {
    method: 'POST',
    body: JSON.stringify({moduleId: selectedModule().id, action, ...extra}),
  });
  await refresh();
}

async function runCommand(commandId, moduleId) {
  const command = data.commands.find(item => item.id === commandId);
  if (!command) throw new Error('Acción fuera de la allowlist visible');
  if (command.confirmation && !window.confirm(`${command.label}\n\n${command.confirmation}\n\n¿Querés continuar?`)) return;
  const buttons = [...document.querySelectorAll(`[data-command="${commandId}"]`)]
    .filter(button => !moduleId || button.dataset.module === moduleId);
  buttons.forEach(button => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-loading');
  });
  let run;
  try {
    run = await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({commandId, moduleId, confirmation: command.confirmation ? commandId : undefined}),
    });
  } catch (error) {
    buttons.forEach(button => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.classList.remove('is-loading');
    });
    throw error;
  }
  activeRunId = run.id;
  activeRun = run;
  data.activeRuns = [run, ...data.activeRuns.filter(item => item.id !== run.id)];
  sourceChanged = false;
  renderLiveStatus(liveConnected ? 'Cambios sincronizados' : 'Modo actualización manual');
  // A mentor answer is the point of the run, so its output starts expanded.
  if (command.group === 'mentor') $('.log-details').open = true;
  showRun(run);
  renderActiveRuns();
  renderView();
  bindDynamic();
  clearInterval(pollTimer);
  pollTimer = setInterval(pollRun, 700);
}

function renderActiveRuns() {
  const container = $('#activeRuns');
  const active = data?.activeRuns || [];
  container.innerHTML = active.length ? `<small>EJECUCIONES ACTIVAS</small>${active.map(run => `
    <article class="active-run ${run.id === activeRunId ? 'selected' : ''}">
      <button type="button" class="active-run-view" data-view-run="${escapeHtml(run.id)}"><b>${escapeHtml(run.label)}</b><span>${escapeHtml(run.moduleId || 'global')} · ${escapeHtml(runStatusName(run.status))}</span></button>
      <button type="button" class="danger active-run-stop" data-stop-run="${escapeHtml(run.id)}">Detener</button>
    </article>`).join('')}` : '';
}

function showRun(run) {
  activeRun = run;
  const agent = run.agent ? ` · ${escapeHtml(run.agent)}` : '';
  $('#runStatus').innerHTML = `<b>${escapeHtml(run.label)}</b> · ${escapeHtml(runStatusName(run.status))}${agent}${run.exitCode == null ? '' : ` · salida ${run.exitCode}`}${run.contextPath ? `<small>Contexto: ${escapeHtml(run.contextPath)}</small>` : ''}`;
  $('#log').textContent = run.log;
  $('#log').scrollTop = $('#log').scrollHeight;
  if ($('#logDialog').open) {
    const fullscreenLog = $('#fullscreenLog');
    const followsOutput = fullscreenLog.scrollHeight - fullscreenLog.scrollTop - fullscreenLog.clientHeight < 72;
    fullscreenLog.textContent = run.log;
    if (followsOutput) fullscreenLog.scrollTop = fullscreenLog.scrollHeight;
    $('#logDialogTitle').textContent = run.label;
    $('#logDialogMeta').textContent = run.agent
      ? `${runStatusName(run.status)} · ${run.agent}`
      : runStatusName(run.status);
  }
  $('#stop').hidden = run.status !== 'running';
  $('#runSteps').innerHTML = run.steps?.length ? run.steps.map(step => `
    <li class="run-step ${step.status}">
      <span class="step-icon" aria-hidden="true">${step.status === 'passed' ? '✓' : step.status === 'failed' ? '×' : step.status === 'running' ? '<i class="spinner"></i>' : '·'}</span>
      <span><b>${escapeHtml(step.label)}</b><small>${escapeHtml(step.detail)}</small></span>
    </li>
  `).join('') : actionStep(run.status);
}

// Actions without steps of their own show a single line that follows the run's status.
function actionStep(status) {
  const [state, icon, title, note] = ({
    running: ['running', '<i class="spinner"></i>', 'Ejecutando acción', 'La salida técnica se actualiza en vivo.'],
    passed: ['passed', '✓', 'Acción completada', 'La salida técnica queda abajo.'],
    partial: ['skipped', '↷', 'Revisión parcial', 'Algo no se ejecutó o se saltó: mirá la salida técnica.'],
  })[status] || ['failed', '×', 'Terminó con fallos', 'La salida técnica dice qué falló.'];
  return `<li class="run-step ${state}"><span class="step-icon" aria-hidden="true">${icon}</span><span><b>${title}</b><small>${note}</small></span></li>`;
}

async function pollRun() {
  const run = await api(`/api/run/${encodeURIComponent(activeRunId)}`);
  showRun(run);
  if (run.status !== 'running') {
    data.activeRuns = data.activeRuns.filter(item => item.id !== run.id);
    renderActiveRuns();
    clearInterval(pollTimer);
    pollTimer = undefined;
    await refresh();
    toast(run.status === 'passed' ? `${run.label}: completado` : `${run.label}: terminó con fallos`);
  }
}

function scheduleRefresh(delay = 180) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(error => toast(error.message)), delay);
}

function connectLive() {
  const events = new EventSource('/api/events');
  events.addEventListener('hello', () => {
    liveConnected = true;
    renderLiveStatus(sourceChanged ? 'Cambios detectados' : 'Cambios en vivo');
  });
  events.addEventListener('change', event => {
    const change = JSON.parse(event.data);
    sourceChanged = true;
    renderLiveStatus(`Cambio detectado: ${change.path.split('/').pop()}`);
    // Re-read the course so lab files and mentor.config.json show their current state. Nothing runs.
    scheduleRefresh(600);
  });
  events.addEventListener('course', () => scheduleRefresh());
  events.addEventListener('chispa', event => handleChispaEvent(JSON.parse(event.data)));
  events.addEventListener('run', event => {
    const run = JSON.parse(event.data);
    if (!data) return;
    data.activeRuns = run.status === 'running'
      ? [run, ...data.activeRuns.filter(item => item.id !== run.id)]
      : data.activeRuns.filter(item => item.id !== run.id);
    renderActiveRuns();
    bindDynamic();
    if (run.id !== activeRunId) return;
    showRun(run);
    if (run.status !== 'running') {
      clearInterval(pollTimer);
      pollTimer = undefined;
      scheduleRefresh();
    }
  });
  events.onerror = () => {
    liveConnected = false;
    renderLiveStatus('Reconectando…');
  };
}

function focusModule(id, scroll) {
  selectedId = id;
  activeTab = 'journey';
  renderRouteChoice();
  renderModule();
  bindDynamic();
  if (scroll) $('#workspace').scrollIntoView({behavior: 'smooth', block: 'start'});
}

function bindDynamic() {
  document.querySelectorAll('[data-select]').forEach(button => {
    button.onclick = () => focusModule(button.dataset.select, false);
  });
  document.querySelectorAll('[data-focus]').forEach(button => {
    button.onclick = () => focusModule(button.dataset.focus, true);
  });
  document.querySelectorAll('[data-command]').forEach(button => {
    button.onclick = () => runCommand(button.dataset.command, button.dataset.module).catch(error => toast(error.message));
  });
  document.querySelectorAll('[data-read]').forEach(control => {
    const handler = () => mutate('read', {doc: control.dataset.read, value: control.type === 'checkbox' ? control.checked : true})
      .catch(error => toast(error.message));
    if (control.type === 'checkbox') control.onchange = handler;
    else control.onclick = handler;
  });
  document.querySelectorAll('[data-open-lab]').forEach(button => {
    button.onclick = () => openLab(Number(button.dataset.openLab)).catch(error => toast(error.message));
  });
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.onclick = () => copyText(button.dataset.copy);
  });
  document.querySelectorAll('.phase-section > summary').forEach(summary => {
    summary.onclick = () => phaseOpen.set(summary.parentElement.dataset.phaseKey, !summary.parentElement.open);
  });
  document.querySelectorAll('[data-criterion]').forEach(input => {
    input.onchange = () => mutate('criterion', {index: Number(input.dataset.criterion), value: input.checked});
  });
  document.querySelectorAll('[data-review]').forEach(button => {
    button.onclick = async () => {
      const value = button.dataset.review;
      const controls = document.querySelectorAll('[data-review]');
      controls.forEach(control => { control.disabled = true; });
      try {
        await mutate('review', {value});
        document.querySelector(`[data-review="${value}"]`)?.focus();
        toast(`Review: ${reviewName(value)}`);
      } catch (error) {
        controls.forEach(control => { control.disabled = false; });
        toast(error.message);
      }
    };
  });
  document.querySelectorAll('[data-view-run]').forEach(button => {
    button.onclick = () => {
      const run = data.activeRuns.find(item => item.id === button.dataset.viewRun);
      if (!run) return;
      activeRun = run;
      activeRunId = run.id;
      showRun(run);
      renderActiveRuns();
      bindDynamic();
    };
  });
  document.querySelectorAll('[data-stop-run]').forEach(button => {
    button.onclick = () => api(`/api/run/${encodeURIComponent(button.dataset.stopRun)}/stop`, {method: 'POST', body: '{}'}).catch(error => toast(error.message));
  });
  $('#primaryAction')?.addEventListener('click', () => runPrimary().catch(error => toast(error.message)));
  $('#notes')?.addEventListener('change', event => mutate('notes', {value: event.target.value}).then(() => toast('Notas guardadas')).catch(error => toast(error.message)));
}

document.querySelectorAll('[data-tab]').forEach(button => {
  button.onclick = () => {
    activeTab = button.dataset.tab;
    renderView();
    bindDynamic();
  };
});
$('#learningRoute').onchange = async event => {
  selectedRoute = event.target.value;
  try { localStorage.setItem('mentor-route', selectedRoute); } catch {}
  selectedId = null;
  try { await refresh(); } catch (error) { toast(error.message); }
};
$('#stop').onclick = () => api(`/api/run/${encodeURIComponent(activeRunId)}/stop`, {method: 'POST', body: '{}'}).catch(error => toast(error.message));
$('#expandLog').onclick = () => {
  const dialog = $('#logDialog');
  const fullscreenLog = $('#fullscreenLog');
  fullscreenLog.textContent = activeRun?.log || $('#log').textContent;
  $('#logDialogTitle').textContent = activeRun?.label || 'Centro de validación';
  $('#logDialogMeta').textContent = activeRun?.agent
    ? `${runStatusName(activeRun.status)} · ${activeRun.agent}`
    : activeRun ? runStatusName(activeRun.status) : 'SALIDA TÉCNICA';
  if (!dialog.open) dialog.showModal();
  fullscreenLog.scrollTop = fullscreenLog.scrollHeight;
  fullscreenLog.focus();
};
$('#closeLog').onclick = () => $('#logDialog').close();

// Theme toggle: auto (OS) → light → dark. Stored per browser; the dashboard works without storage.
const THEMES = [['auto', 'Tema: automático'], ['light', 'Tema: claro'], ['dark', 'Tema: oscuro']];
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const [, label] = THEMES.find(([id]) => id === theme) || THEMES[0];
  $('#themeToggle').textContent = label;
}
let currentTheme = 'auto';
try { currentTheme = localStorage.getItem('mentor-theme') || 'auto'; } catch {}
applyTheme(currentTheme);
$('#themeToggle').onclick = () => {
  const index = THEMES.findIndex(([id]) => id === currentTheme);
  currentTheme = THEMES[(index + 1) % THEMES.length][0];
  try { localStorage.setItem('mentor-theme', currentTheme); } catch {}
  applyTheme(currentTheme);
};

refresh().then(refreshChispa).catch(error => toast(error.message));
connectLive();
