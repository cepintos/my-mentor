import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../lib.mjs';

// The renderer is a browser module (.js without "type"): load a copy as .mjs so Node reads it as ESM.
async function renderer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-markdown-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'markdown.mjs');
  fs.copyFileSync(path.join(ROOT, 'dashboard/markdown.js'), file);
  return (await import(pathToFileURL(file).href)).renderMarkdown;
}

test('wrapped list items stay one item and fenced blocks inside a list still render as code', async t => {
  const render = await renderer(t);
  const html = render([
    '1. Comprobá la versión; si',
    '   tu gestor la soporta, elegila.',
    '2. Iniciá el dashboard:',
    '',
    '   ```bash',
    '   npm run dashboard',
    '   ```',
    '',
    '- primero',
    'sigue sin sangría',
    '- [x] hecho',
    '  con detalle',
    '',
    'Un párrafo aparte.',
  ].join('\n'));
  assert.match(html, /<ol><li>Comprobá la versión; si tu gestor la soporta, elegila\.<\/li><li>Iniciá el dashboard:<\/li><\/ol>/);
  assert.match(html, /<pre><code class="language-bash">npm run dashboard<\/code><\/pre>/);
  assert.match(html, /<ul><li>primero sigue sin sangría<\/li><li class="task-item"><input type="checkbox" disabled checked><span>hecho con detalle<\/span><\/li><\/ul>/);
  assert.match(html, /<p>Un párrafo aparte\.<\/p>/);
});

test('links to local documents become reader links and everything else is escaped', async t => {
  const render = await renderer(t);
  const html = render('Ver [la idea](../referencia/idea.md) y <script>alert(1)</script>.', 'course/demo/D00-x/02-CONCEPTOS.md');
  assert.match(html, /data-doc-link="course\/demo\/referencia\/idea\.md"/);
  assert.doesNotMatch(html, /<script>/);
});
