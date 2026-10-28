// The only way Chispa reaches a model: Claude Code in print mode with a fixed, restricted invocation.
// --restricted removes Bash and every code-running tool and confines file tools to the repo;
// dontAsk denies anything the settings below do not allow. The learner's text goes in on stdin.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT} from '../scripts/lib.mjs';
import {chispaConfig} from './config.mjs';

const MCP_SERVER = path.join(ROOT, 'companion', 'mcp-server.mjs');
const TURN_TIMEOUT_MS = 6 * 60 * 1000;

function findExecutable(name) {
  for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

// CHISPA_CLAUDE lets the tests point at a stub; it is read from the server's environment, never a request.
export function claudeExecutable() {
  return process.env.CHISPA_CLAUDE || findExecutable('claude');
}

function permissions(config) {
  const absolute = relative => `//${path.join(ROOT, relative).replace(/^\//, '')}`;
  return {
    permissions: {
      allow: ['Read', 'Grep', 'Glob', 'WebSearch', 'mcp__chispa', ...config.webFetchDomains.map(domain => `WebFetch(domain:${domain})`)],
      deny: [
        `Read(${absolute('private')}/**)`,
        `Read(${absolute('.companion/conversations')}/**)`,
        'Read(**/.env)',
        'Read(**/.env.*)',
        'Edit', 'Write', 'Bash', 'NotebookEdit',
      ],
    },
  };
}

export function chatArgs({sessionId, resume, systemPrompt}) {
  const config = chispaConfig();
  return [
    '-p', '--restricted',
    '--model', config.model,
    '--effort', config.effort,
    '--tools', 'Read,Grep,Glob,WebSearch,WebFetch',
    '--strict-mcp-config',
    '--mcp-config', JSON.stringify({mcpServers: {chispa: {command: process.execPath, args: [MCP_SERVER]}}}),
    '--permission-mode', 'dontAsk',
    '--settings', JSON.stringify(permissions(config)),
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--system-prompt-snapshot', 'on',
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId, '--append-system-prompt', systemPrompt]),
  ];
}

function spawnClaude(args, input) {
  const executable = claudeExecutable();
  if (!executable) throw new Error('No encuentro el CLI "claude" en PATH: Chispa lo necesita para pensar.');
  const child = spawn(executable, args, {cwd: ROOT, shell: false, env: {...process.env, FORCE_COLOR: '0'}});
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill('SIGTERM'), TURN_TIMEOUT_MS);
  child.on('close', () => clearTimeout(timer));
  return child;
}

// One conversation turn. onEvent receives {type: 'delta', text} and {type: 'tool', name, detail};
// the promise resolves with the shown text, or rejects with what went wrong.
export function runTurn({message, sessionId, resume, systemPrompt, onEvent = () => {}}) {
  const child = spawnClaude(chatArgs({sessionId, resume, systemPrompt}), message);
  let shown = '';
  let buffer = '';
  let stderr = '';
  let result = null;
  const emitText = value => {
    shown += value;
    onEvent({type: 'delta', text: value});
  };
  const handle = event => {
    if (event.type === 'stream_event') {
      const inner = event.event || {};
      if (inner.type === 'message_start' && shown.trim()) emitText('\n\n');
      if (inner.type === 'content_block_delta' && inner.delta?.type === 'text_delta') emitText(inner.delta.text);
    } else if (event.type === 'assistant') {
      for (const block of event.message?.content || []) {
        if (block.type !== 'tool_use') continue;
        const input = block.input || {};
        const detail = input.file_path || input.ruta || input.pattern || input.query || input.url || input.id || input.consulta || '';
        onEvent({type: 'tool', name: block.name.replace(/^mcp__chispa__/, ''), detail: String(detail).slice(0, 120)});
      }
    } else if (event.type === 'result') {
      result = event;
    }
  };
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { handle(JSON.parse(line)); } catch {}
    }
  });
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      if (result && !result.is_error) {
        // Without partial messages (older CLIs) nothing streamed: show the final answer.
        if (!shown.trim() && result.result) emitText(result.result);
        resolve({text: shown.trim() || result.result || '', costUsd: result.total_cost_usd ?? null});
      } else {
        reject(new Error(result?.result || stderr.trim().split('\n').pop() || `claude terminó con código ${code}`));
      }
    });
  });
  return {child, done};
}

// A single answer with no tools at all (reminder blurbs). Returns the model's text.
export function generateText({prompt, systemPrompt, effort}) {
  const config = chispaConfig();
  const child = spawnClaude([
    '-p', '--restricted',
    '--model', config.model,
    '--effort', effort || config.nudgeEffort,
    '--tools', '',
    '--strict-mcp-config',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--output-format', 'json',
    '--append-system-prompt', systemPrompt,
  ], prompt);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) throw new Error(parsed.result || 'error del modelo');
        resolve(String(parsed.result || ''));
      } catch (error) {
        reject(new Error(code === 0 ? error.message : stderr.trim().split('\n').pop() || `claude terminó con código ${code}`));
      }
    });
  });
}
