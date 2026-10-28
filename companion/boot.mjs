// The file Chispa starts every conversation with: persona + the learner's profile + a snapshot of real
// progress + the indicative line of every memory shard. The full shards stay on disk for memoria_leer.
import fs from 'node:fs';
import {chispaConfig, PERSONA_FILE, PROFILE_FILE} from './config.mjs';
import {listShards} from './memory.mjs';
import {progressSnapshot} from './progress.mjs';

const when = iso => (iso ? new Date(iso).toLocaleString('es-AR', {dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23'}) : 'nunca');
const ago = hours => (hours == null ? '' : hours < 48 ? ` (hace ${hours} h)` : ` (hace ${Math.round(hours / 24)} días)`);

function profile() {
  try {
    const text = fs.readFileSync(PROFILE_FILE, 'utf8').trim();
    return text.length > 4000 ? `${text.slice(0, 4000)}\n…(recortado: el resto está en course/00-PERFIL.md)` : text || null;
  } catch {
    return null;
  }
}

function stageLines(snapshot) {
  const {stage} = snapshot;
  if (!stage) {
    return [
      '- Todavía no hay etapas. El curso lo crea module-builder en el agente de quien estudia (06-CREAR-MODULOS.md);',
      '  vos no podés crearlo. Ayudá a pensar qué quiere aprender y qué quiere poder HACER, y ofrecé llevar eso a esa charla.',
    ];
  }
  return [
    `- Etapa actual: ${stage.id} — ${stage.title} (${stage.status === 'in_progress' ? 'en curso' : stage.status}).`,
    `- Pregunta de la etapa: ${stage.question}`,
    `- Fase: ${stage.phaseName}. Próximo paso: ${stage.nextStep}.`,
    `- Lectura: ${stage.reading.filter(item => item.read).length}/${stage.reading.length} documentos marcados.`,
    `- Laboratorio: ${stage.lab.map(item => `${item.path.split('/').pop()} ${item.pass ? '✓' : `× ${item.detail}`}`).join(' · ') || 'sin archivos estáticos'}.`,
    `- Último check: ${stage.lastCheck ? `${stage.lastCheck.passed}/${stage.lastCheck.total} el ${when(stage.lastCheck.at)}${!stage.lastCheck.fresh && stage.lastCheck.passed === stage.lastCheck.total ? ' (pasó, pero la evidencia cambió después)' : ''}` : 'nunca'}.`,
    `- Criterios: ${stage.criteria.done}/${stage.criteria.total}. Review: ${stage.review}.`,
    `- Último progreso real: ${when(stage.lastProgressAt)}${ago(snapshot.hoursSinceProgress)}.`,
    snapshot.inProgress.length ? `- Otras etapas en curso: ${snapshot.inProgress.join(', ')}.` : null,
    `- Etapas completas: ${snapshot.done.length ? snapshot.done.join(', ') : 'ninguna todavía'}.`,
  ];
}

export function bootText() {
  const config = chispaConfig();
  const snapshot = progressSnapshot();
  const shards = listShards({inbox: true});
  const saved = shards.filter(shard => !shard.inbox);
  const drafts = shards.filter(shard => shard.inbox);
  const recovered = shards.filter(shard => shard.recuperado && shard.estado === 'abierto');
  const failedRuns = snapshot.runs.filter(run => run.status === 'failed').slice(0, 4);

  const lines = [
    fs.readFileSync(PERSONA_FILE, 'utf8').trim(),
    '',
    `# Contexto de arranque · ${when(snapshot.at)}`,
    '',
    `Quien estudia: ${config.learnerName || 'sin nombre configurado'}.`,
    '',
    '## Perfil de quien estudia (course/00-PERFIL.md)',
    '',
    profile() || 'Todavía no hay perfil. Si hace falta, preguntá qué sabe y qué quiere poder hacer, y sugerí escribirlo con module-builder.',
    '',
    '## Dónde está ahora',
    '',
    ...stageLines(snapshot),
    '',
    '## Ejecuciones recientes que fallaron',
    '',
    ...(failedRuns.length
      ? failedRuns.map(run => `- ${run.label}${run.moduleId ? ` (${run.moduleId})` : ''} · ${when(run.endedAt)} · id ${run.id}`)
      : ['- Ninguna.']),
    '',
    '## Memoria (líneas indicativas; leé la completa con memoria_leer)',
    '',
    ...(saved.length
      ? saved.slice(0, 60).map(shard => `- [${shard.id}] ${shard.indicativa} (${shard.tipo}, ${shard.estado})`)
      : ['- Todavía no hay recuerdos guardados.']),
    '',
    drafts.length ? `Borradores esperando que quien estudia los guarde o descarte: ${drafts.length}.` : null,
    ...recovered.map(shard => `Pendiente: [${shard.id}] volvió a pasar el ${when(shard.recuperado)} y no tiene RCA. Preguntá qué lo arregló.`),
  ];
  return lines.filter(line => line !== null).join('\n');
}
