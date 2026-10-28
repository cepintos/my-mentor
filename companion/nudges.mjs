#!/usr/bin/env node
// Chispa's reminders. Fixed rules decide WHEN (no progress for N hours, one file left, check ready,
// review pending, an incident that passed without RCA); the model only writes WHAT, in Chispa's voice.
// The plan goes to .companion/nudges.json; on macOS each hourly run shows the entries that are due.
//
//   node companion/nudges.mjs              compute the plan, write it, notify what is due
//   node companion/nudges.mjs --dry-run    print the plan with template texts; writes nothing
//   node companion/nudges.mjs agent install|uninstall|status   hourly LaunchAgent (macOS)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../scripts/lib.mjs';
import {generateText} from './claude.mjs';
import {chispaConfig, COMPANION_DIR, NUDGES_FILE} from './config.mjs';
import {listShards} from './memory.mjs';
import {progressSnapshot} from './progress.mjs';

const HOUR = 36e5;
const minutes = time => {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
};

// Moves a date out of quiet hours (which may wrap past midnight) to the moment they end.
export function outsideQuietHours(date, quietHours) {
  const from = minutes(quietHours.from);
  const to = minutes(quietHours.to);
  const now = date.getHours() * 60 + date.getMinutes();
  const quiet = from < to ? now >= from && now < to : now >= from || now < to;
  if (!quiet) return date;
  const end = new Date(date);
  end.setHours(Math.floor(to / 60), to % 60, 0, 0);
  if (end <= date) end.setDate(end.getDate() + 1);
  return end;
}

const fileName = relative => String(relative).split('/').pop();

// Each trigger carries only facts the dashboard can show; the text is written later.
// Without a course (stage null) only the incident trigger can fire.
export function triggersFor({snapshot, shards, config}) {
  const {stage} = snapshot;
  const triggers = [];
  const lab = stage?.lab || [];
  const pending = lab.filter(item => !item.pass);
  if (stage?.status === 'in_progress' && snapshot.hoursSinceProgress != null && snapshot.hoursSinceProgress >= config.thresholds.noProgressHours) {
    triggers.push({
      key: `no-progress:${stage.id}`, kind: 'no-progress', priority: 2, moduleId: stage.id,
      facts: {etapa: `${stage.id} — ${stage.title}`, horasSinProgreso: snapshot.hoursSinceProgress, fase: stage.phaseName, proximoPaso: stage.nextStep},
    });
  }
  if (lab.length >= 2 && pending.length === 1) {
    triggers.push({
      key: `almost:${stage.id}:${fileName(pending[0].path)}`, kind: 'almost', priority: 1, moduleId: stage.id,
      facts: {etapa: `${stage.id} — ${stage.title}`, archivoQueFalta: fileName(pending[0].path), archivosListos: lab.length - 1, total: lab.length},
    });
  }
  if (stage?.phase === 2 && stage.nextStep === 'Validar evidencia') {
    triggers.push({key: `check-ready:${stage.id}`, kind: 'check-ready', priority: 1, moduleId: stage.id,
      facts: {etapa: `${stage.id} — ${stage.title}`, situacion: 'los archivos del laboratorio ya no tienen marcadores; falta validar'}});
  }
  if (stage?.phase === 3) {
    triggers.push({key: `review:${stage.id}`, kind: 'review', priority: 1, moduleId: stage.id,
      facts: {etapa: `${stage.id} — ${stage.title}`, situacion: stage.nextStep}});
  }
  for (const shard of shards.filter(item => item.recuperado && item.estado === 'abierto').slice(0, 1)) {
    triggers.push({key: `rca:${shard.id}`, kind: 'rca', priority: 3, moduleId: shard.modulo,
      facts: {incidente: shard.indicativa, situacion: 'volvió a pasar y no tiene RCA: preguntar qué lo arregló'}});
  }
  return triggers.sort((left, right) => left.priority - right.priority).slice(0, 2);
}

const TEMPLATES = {
  'no-progress': facts => ({title: '⚡ ¡Batería baja!', body: `${facts.etapa.split(' — ')[0]} te espera: ${facts.proximoPaso}. Enchufate 15 minutos y volvemos a encender todo.`}),
  'no-progress-later': facts => ({title: '¿Hacemos contacto hoy? 🔌', body: `Seguimos en ${facts.etapa.split(' — ')[0]}. ${facts.proximoPaso}: un chispazo chiquito y arrancamos.`}),
  almost: facts => ({title: `¡${facts.etapa.split(' — ')[0]} está a un chispazo!`, body: `Sólo queda ${facts.archivoQueFalta}. ${facts.archivosListos} de ${facts.total} ya brillan ⚡`}),
  'check-ready': facts => ({title: '¡A MIL VOLTIOS! ⚡', body: `Tus archivos de ${facts.etapa.split(' — ')[0]} ya no tienen marcadores. ¡Validá la evidencia!`}),
  review: facts => ({title: 'Último chispazo de la etapa', body: `${facts.etapa.split(' — ')[0]}: ${facts.situacion}. ¡Ya casi! 😎`}),
  rca: () => ({title: '¿Qué arregló el cortocircuito?', body: 'Un error volvió a pasar. Contame qué cambiaste así lo recuerdo para siempre ⚡'}),
};

const clip = (value, max) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

async function writeTexts(items, config, useModel) {
  const fallback = items.map(item => TEMPLATES[item.kind](item.facts));
  if (!useModel) return fallback;
  const systemPrompt = [
    `Sos Chispa ⚡, una centella eléctrica tierna, ELECTRIFICANTEMENTE energética y motivadora, companion de ${config.learnerName || 'quien estudia'}. Escribís notificaciones de celular en español rioplatense, de vos, con imágenes eléctricas (chispazo, voltaje, batería, contacto) y a veces un chiste absurdo.`,
    'Para cada aviso devolvés un título de hasta 40 caracteres y un cuerpo de hasta 140, con un dato concreto de los hechos.',
    'Nunca culpás ni exagerás; proponés el paso más chico. Respondé sólo con un arreglo JSON: [{"title": "...", "body": "..."}], en el mismo orden.',
  ].join(' ');
  try {
    const answer = await generateText({systemPrompt, prompt: JSON.stringify(items.map(item => ({tipo: item.kind, hechos: item.facts})))});
    const parsed = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item, index) => (list[index]?.title && list[index]?.body ? list[index] : fallback[index]));
  } catch (error) {
    console.warn(`chispa-nudges: uso plantillas (${error.message})`);
    return fallback;
  }
}

function readPlan() {
  try {
    return JSON.parse(fs.readFileSync(NUDGES_FILE, 'utf8'));
  } catch {
    return {generatedAt: null, signature: null, entries: [], history: [], deliveredMac: []};
  }
}

// Builds the plan. Future entries stay while their trigger is still true; texts are written only for
// triggers that are new and not shown within repeatAfterHours, so a quiet hourly run costs no model call.
// When progress happens the trigger disappears and its pending entries go with it.
export async function buildPlan({now = new Date(), previous = readPlan(), useModel = true, snapshot = progressSnapshot(), shards = listShards({inbox: true})} = {}) {
  const config = chispaConfig();
  const repeatMs = config.thresholds.repeatAfterHours * HOUR;
  const history = (previous.history || []).filter(item => now - new Date(item.at) < 7 * 24 * HOUR);
  const active = triggersFor({snapshot, shards, config});
  const activeKeys = new Set(active.map(trigger => trigger.key));
  const kept = (previous.entries || []).filter(entry => new Date(entry.at) > now && activeKeys.has(entry.key));
  const fresh = active.filter(trigger =>
    !kept.some(entry => entry.key === trigger.key)
    && !history.some(item => item.key === trigger.key && now - new Date(item.at) < repeatMs));

  // A no-progress reminder also leaves a follow-up a repeat window later, in case nothing changes.
  const items = fresh.flatMap(trigger => {
    const due = outsideQuietHours(now, config.quietHours);
    const first = {...trigger, at: due};
    if (trigger.kind !== 'no-progress') return [first];
    return [first, {...trigger, kind: 'no-progress-later', at: outsideQuietHours(new Date(due.getTime() + repeatMs), config.quietHours)}];
  });
  const texts = items.length ? await writeTexts(items, config, useModel) : [];
  const stage = snapshot.stage;
  // What to read next, or the plan to follow: kept with each reminder so a notification can point to it.
  const doc = !stage ? null : stage.phase === 0 ? stage.reading.find(item => !item.read)?.path : stage.planDoc;
  const created = items.map((item, index) => ({
    id: `${item.key}${item.kind.endsWith('-later') ? ':later' : ''}@${item.at.toISOString()}`.replace(/[^a-zA-Z0-9:@._-]/g, '-'),
    key: item.key,
    at: item.at.toISOString(),
    title: clip(texts[index].title, 40),
    body: clip(texts[index].body, 140),
    kind: item.kind,
    moduleId: item.moduleId,
    ...(doc && item.moduleId === stage?.id ? {doc} : {}),
  }));
  return {
    generatedAt: created.length ? now.toISOString() : previous.generatedAt || now.toISOString(),
    checkedAt: now.toISOString(),
    entries: [...kept, ...created].sort((left, right) => left.at.localeCompare(right.at)),
    history: [...history, ...fresh.map(trigger => ({key: trigger.key, at: now.toISOString()}))],
    deliveredMac: (previous.deliveredMac || []).slice(-50),
  };
}

function notifyMac(entry) {
  if (process.platform !== 'darwin') return;
  // Title and body travel as arguments, never inside the AppleScript source.
  execFileSync('osascript', [
    '-e', 'on run argv',
    '-e', 'display notification (item 2 of argv) with title "Chispa" subtitle (item 1 of argv)',
    '-e', 'end run',
    entry.title, entry.body,
  ], {stdio: 'ignore'});
}

function savePlan(plan) {
  fs.mkdirSync(COMPANION_DIR, {recursive: true});
  const temporary = `${NUDGES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`);
  fs.renameSync(temporary, NUDGES_FILE);
}

// One agent per checkout, so two copies of the mentor on the same Mac do not replace each other.
const AGENT_LABEL = `com.mymentor.chispa-nudges.${crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 8)}`;
const agentPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);

function agent(action) {
  if (process.platform !== 'darwin') throw new Error('El LaunchAgent existe sólo en macOS');
  const domain = `gui/${process.getuid()}`;
  if (action === 'status') {
    const result = spawnSync('launchctl', ['print', `${domain}/${AGENT_LABEL}`], {encoding: 'utf8'});
    console.log(result.status === 0 ? `Instalado: ${agentPath}` : 'No instalado.');
    return;
  }
  spawnSync('launchctl', ['bootout', `${domain}/${AGENT_LABEL}`], {stdio: 'ignore'});
  if (action === 'uninstall') {
    fs.rmSync(agentPath, {force: true});
    console.log('LaunchAgent desinstalado.');
    return;
  }
  if (action !== 'install') throw new Error('Usá agent install, agent uninstall o agent status');
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const plist = fs.readFileSync(path.join(ROOT, 'companion/launchd/nudges.plist.template'), 'utf8')
    .replaceAll('{{LABEL}}', AGENT_LABEL)
    .replaceAll('{{NODE}}', escape(process.execPath))
    .replaceAll('{{SCRIPT}}', escape(fileURLToPath(import.meta.url)))
    .replaceAll('{{ROOT}}', escape(ROOT))
    .replaceAll('{{LOG}}', escape(path.join(COMPANION_DIR, 'nudges.log')))
    .replaceAll('{{PATH}}', escape([path.dirname(process.execPath), path.join(os.homedir(), '.local/bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':')));
  fs.mkdirSync(path.dirname(agentPath), {recursive: true});
  fs.mkdirSync(COMPANION_DIR, {recursive: true});
  fs.writeFileSync(agentPath, plist);
  execFileSync('launchctl', ['bootstrap', domain, agentPath]);
  console.log(`LaunchAgent instalado: corre cada hora (${agentPath}).`);
}

async function main(args) {
  if (args[0] === 'agent') return agent(args[1]);
  const dryRun = args.includes('--dry-run');
  const plan = await buildPlan({useModel: !dryRun});
  if (dryRun) {
    console.log(JSON.stringify(plan.entries, null, 2));
    return;
  }
  const now = Date.now();
  const due = plan.entries.filter(entry => new Date(entry.at).getTime() <= now + 5 * 60 * 1000 && !plan.deliveredMac.includes(entry.id));
  for (const entry of due) {
    try {
      notifyMac(entry);
      plan.deliveredMac.push(entry.id);
    } catch (error) {
      console.warn(`chispa-nudges: no pude notificar en la Mac (${error.message})`);
    }
  }
  savePlan(plan);
  console.log(`${new Date().toISOString()} · ${plan.entries.length} recordatorio(s) en el plan · ${due.length} mostrado(s) en la Mac`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`chispa-nudges: ${error.message}`);
    process.exitCode = 1;
  });
}
