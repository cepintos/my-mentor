#!/usr/bin/env node
// Stand-in for the Claude Code CLI in tests: records its arguments and prints a short stream-json answer.
import fs from 'node:fs';
import path from 'node:path';

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  fs.mkdirSync(path.join(process.cwd(), '.companion'), {recursive: true});
  fs.appendFileSync(path.join(process.cwd(), '.companion', 'fake-claude-calls.jsonl'), `${JSON.stringify({args, input})}\n`);
  if (input.includes('FAIL')) {
    console.log(JSON.stringify({type: 'result', subtype: 'error', is_error: true, result: 'falla simulada'}));
    return;
  }
  if (args.includes('json')) {
    console.log(JSON.stringify({type: 'result', is_error: false, result: '{"title": "¡Hola!", "body": "Te falta poquito en D00."}'}));
    return;
  }
  const line = value => console.log(JSON.stringify(value));
  line({type: 'system', subtype: 'init', session_id: 'test'});
  line({type: 'stream_event', event: {type: 'message_start'}});
  line({type: 'stream_event', event: {type: 'content_block_delta', delta: {type: 'text_delta', text: 'Miro tu '}}});
  line({type: 'stream_event', event: {type: 'content_block_delta', delta: {type: 'text_delta', text: 'estado.'}}});
  line({type: 'assistant', message: {content: [{type: 'tool_use', name: 'mcp__chispa__estado_del_curso', input: {}}]}});
  line({type: 'stream_event', event: {type: 'message_start'}});
  line({type: 'stream_event', event: {type: 'content_block_delta', delta: {type: 'text_delta', text: 'Leé `00-EMPEZA-ACA.md`.'}}});
  line({type: 'result', is_error: false, result: 'Leé `00-EMPEZA-ACA.md`.', total_cost_usd: 0});
});
