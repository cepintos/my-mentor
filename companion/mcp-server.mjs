#!/usr/bin/env node
// Chispa's "read commands": a stdio MCP server with fixed tools and no dependencies.
// Every tool reads; the two writes only create drafts the learner approves in the dashboard:
// memoria_proponer (.companion/memory/inbox/) and cambio_proponer (.companion/edits/).
// Nothing here accepts a command, an executable or a path to run.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {execFileSync} from 'node:child_process';
import {ROOT, docs, getModule, load, safe} from '../scripts/lib.mjs';
import {proposeEdit} from './edits.mjs';
import {proposeShard, readShard, searchShards, SHARD_SECTIONS, SHARD_TYPES} from './memory.mjs';
import {progressSnapshot, stageView} from './progress.mjs';

const text = value => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const tail = (value, max) => (value.length > max ? `…(recortado)\n${value.slice(-max)}` : value);

function git(args, max = 16000) {
  try {
    return tail(execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, shell: false}), max) || '(sin cambios)';
  } catch (error) {
    return `git falló: ${error.message}`;
  }
}

function deliverablePaths(module) {
  return String(module.deliverable || '').split(/\s+\+\s+/)
    .map(item => item.trim())
    .filter(item => item && !item.includes('*') && !/^repo completo/i.test(item))
    .filter(item => {
      try { return fs.existsSync(safe(item)); } catch { return false; }
    });
}

const shardProperties = Object.fromEntries(SHARD_SECTIONS.map(([key, title]) => [key, {type: 'string', description: title}]));

const tools = {
  estado_del_curso: {
    description: 'Progreso real ahora: etapa actual, fase, próximo paso, lectura, archivos del lab, último check, criterios, review, horas sin progreso y ejecuciones recientes. stage es null si el curso todavía no tiene etapas.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    run: () => progressSnapshot(),
  },
  etapa: {
    description: 'Detalle de una etapa por id (p. ej. A00): pregunta, objetivo, criterios, documentos, lectura, archivos del lab y estado.',
    inputSchema: {type: 'object', properties: {id: {type: 'string'}}, required: ['id'], additionalProperties: false},
    run: ({id}) => {
      const {catalog, state} = load();
      const module = getModule(catalog, id);
      return {
        ...stageView(state, module),
        goal: module.goal,
        concepts: module.concepts,
        criteria: module.criteria,
        failures: module.failures,
        docs: docs(module),
      };
    },
  },
  memoria_buscar: {
    description: 'Busca en los recuerdos guardados (indicativa, tags, etapa y cuerpo). Devuelve las líneas indicativas con su id.',
    inputSchema: {type: 'object', properties: {consulta: {type: 'string'}}, required: ['consulta'], additionalProperties: false},
    run: ({consulta}) => searchShards(String(consulta).slice(0, 200)),
  },
  memoria_leer: {
    description: 'Lee un recuerdo completo por id: síntoma, stacktrace, RCA, pasos, concepto y cómo reconocerlo.',
    inputSchema: {type: 'object', properties: {id: {type: 'string'}}, required: ['id'], additionalProperties: false},
    run: ({id}) => readShard(id),
  },
  memoria_proponer: {
    description: 'Propone un recuerdo nuevo. Queda como borrador hasta que quien estudia lo guarda en el dashboard. La indicativa es una línea que resume qué pasó, por qué y cuándo.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: {type: 'string', enum: SHARD_TYPES},
        modulo: {type: 'string', description: 'Id de etapa (A00, B01…) o "general"'},
        indicativa: {type: 'string', description: '10–300 caracteres'},
        estado: {type: 'string', enum: ['abierto', 'resuelto']},
        tags: {type: 'array', items: {type: 'string'}, maxItems: 8},
        ...shardProperties,
      },
      required: ['tipo', 'modulo', 'indicativa'],
      additionalProperties: false,
    },
    run: fields => `Borrador ${proposeShard(fields, 'chispa')} creado. Espera que quien estudia lo guarde o descarte en el dashboard.`,
  },
  cambio_proponer: {
    description: 'Propone un cambio puntual en un documento del curso (course/…/*.md que abre la biblioteca). No edita: queda pendiente hasta que quien estudia lo aplica en el dashboard. buscar es texto exacto del archivo y debe aparecer una sola vez; reemplazar es el texto nuevo. Rechaza la guía del mentor, archivos del laboratorio, código y configuración.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta: {type: 'string', description: 'Ruta relativa al repo, p. ej. course/<track>/A00-<slug>/01-BRIEF.md'},
        buscar: {type: 'string', description: 'Texto exacto a reemplazar (hasta 4000 caracteres, una sola aparición)'},
        reemplazar: {type: 'string', description: 'Texto nuevo (hasta 4000 caracteres)'},
        motivo: {type: 'string', description: 'Por qué hace falta, 10–300 caracteres'},
      },
      required: ['ruta', 'buscar', 'reemplazar', 'motivo'],
      additionalProperties: false,
    },
    run: fields => `Cambio ${proposeEdit(fields)} propuesto en ${fields.ruta}. Espera que quien estudia lo aplique o descarte en el dashboard; todavía no cambió nada.`,
  },
  ultimas_ejecuciones: {
    description: 'Últimas ejecuciones registradas (checks, tests, comandos del curso) con estado y fecha.',
    inputSchema: {type: 'object', properties: {limite: {type: 'integer', minimum: 1, maximum: 30}}, additionalProperties: false},
    run: ({limite = 10} = {}) => (load().state.runs || []).slice(0, limite).map(run => ({
      id: run.id, label: run.label, commandId: run.commandId, moduleId: run.moduleId,
      status: run.status, exitCode: run.exitCode, endedAt: run.endedAt,
    })),
  },
  ejecucion: {
    description: 'Log real de una ejecución por id (el final, donde suelen estar los errores).',
    inputSchema: {type: 'object', properties: {id: {type: 'string'}}, required: ['id'], additionalProperties: false},
    run: ({id}) => {
      if (!/^\d+-\d+$/.test(String(id))) throw new Error('id de ejecución inválido');
      const file = path.join(ROOT, '.course', 'runs', `${id}.log`);
      if (fs.existsSync(file)) return tail(fs.readFileSync(file, 'utf8'), 12000);
      const run = (load().state.runs || []).find(item => item.id === id);
      if (!run) throw new Error(`No existe la ejecución ${id}`);
      return tail(run.log || '', 12000);
    },
  },
  git_reciente: {
    description: 'Últimos commits que tocaron los entregables del curso (o el repo, si todavía no hay), con archivos cambiados.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    run: () => {
      const paths = [...new Set(load().catalog.modules.flatMap(deliverablePaths))];
      return git(['log', '-n', '15', '--date=iso', '--format=%h %ad %s', '--stat', ...(paths.length ? ['--', ...paths] : [])]);
    },
  },
  diff_del_lab: {
    description: 'Cambios sin commitear en el entregable de una etapa: estado de archivos y diff.',
    inputSchema: {type: 'object', properties: {id: {type: 'string'}}, required: ['id'], additionalProperties: false},
    run: ({id}) => {
      const module = getModule(load().catalog, id);
      const paths = deliverablePaths(module);
      if (!paths.length) return `${module.id} no declara un entregable con ruta concreta (${module.deliverable}).`;
      return `${git(['status', '--short', '--', ...paths], 4000)}\n\n${git(['diff', '--', ...paths], 20000)}`;
    },
  },
};

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id, result})}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id, error: {code, message}})}\n`);
}

function handle(message) {
  const {id, method, params} = message;
  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: {tools: {}},
      serverInfo: {name: 'chispa', version: '1.0.0'},
    });
  }
  if (method === 'ping') return respond(id, {});
  if (method === 'tools/list') {
    return respond(id, {tools: Object.entries(tools).map(([name, tool]) => ({name, description: tool.description, inputSchema: tool.inputSchema}))});
  }
  if (method === 'tools/call') {
    const tool = Object.hasOwn(tools, params?.name) ? tools[params.name] : null;
    if (!tool) return respond(id, {content: [{type: 'text', text: `Herramienta desconocida: ${params?.name}`}], isError: true});
    try {
      return respond(id, {content: [{type: 'text', text: text(tool.run(params.arguments || {}))}]});
    } catch (error) {
      return respond(id, {content: [{type: 'text', text: `Error: ${error.message}`}], isError: true});
    }
  }
  if (id !== undefined) return fail(id, -32601, `Método no soportado: ${method}`);
  return undefined; // notifications (initialized, cancelled…) need no answer
}

readline.createInterface({input: process.stdin}).on('line', line => {
  if (!line.trim()) return;
  try {
    handle(JSON.parse(line));
  } catch (error) {
    process.stderr.write(`chispa-mcp: ${error.message}\n`);
  }
});
