const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function resolveDocPath(currentPath, target) {
  const cleanTarget = String(target || '').split('#')[0].split('?')[0];
  if (!cleanTarget || cleanTarget.startsWith('/')) return '';

  const parts = String(currentPath || '').split('/');
  parts.pop();
  cleanTarget.split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  return parts.join('/');
}

function renderInline(value, currentPath) {
  const tokens = [];
  const stash = html => `\uE000${tokens.push(html) - 1}\uE001`;
  let text = escapeHtml(value);

  text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${code}</code>`));
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (_, label, href) => {
    const safeLabel = label || 'Imagen';
    if (/^https?:\/\//i.test(href)) {
      return stash(`<a class="markdown-image-link" href="${href}" target="_blank" rel="noreferrer noopener">Imagen: ${safeLabel}</a>`);
    }
    return stash(`<span class="markdown-image-reference">Imagen: ${safeLabel}</span>`);
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (_, label, href) => {
    if (/^https?:\/\//i.test(href)) {
      return stash(`<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`);
    }
    if (/^mailto:/i.test(href) || href.startsWith('#')) {
      return stash(`<a href="${href}">${label}</a>`);
    }
    if (/\.md(?:#.*)?$/i.test(href)) {
      const resolved = resolveDocPath(currentPath, href);
      if (resolved) {
        return stash(`<button type="button" class="markdown-doc-link" data-doc-link="${escapeHtml(resolved)}">${label}</button>`);
      }
    }
    return stash(`<span class="markdown-unresolved-link">${label}</span>`);
  });

  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');

  // Tokens can nest (code inside a link label), so restore them recursively.
  const restore = html => html.replace(/\uE000(\d+)\uE001/g, (_, index) => restore(tokens[Number(index)]));
  return restore(text);
}

function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map(cell => cell.trim());
}

function isTableDivider(line) {
  if (!line || !line.includes('|')) return false;
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function tableAlignment(cell) {
  const value = cell.replace(/\s/g, '');
  if (value.startsWith(':') && value.endsWith(':')) return 'center';
  if (value.endsWith(':')) return 'right';
  return 'left';
}

function isBlockStart(lines, index) {
  const line = lines[index] || '';
  const next = lines[index + 1] || '';
  return !line.trim()
    || /^ {0,3}(`{3,}|~{3,})/.test(line)
    || /^ {0,3}#{1,6}\s+/.test(line)
    || /^ {0,3}(?:[-*_]\s*){3,}$/.test(line)
    || /^\s*>/.test(line)
    || /^\s*(?:[-+*]|\d+\.)\s+/.test(line)
    || /^(?: {4}|\t)\S/.test(line)
    || (line.includes('|') && isTableDivider(next));
}

function renderParagraph(lines, currentPath) {
  return lines.map(line => {
    const hardBreak = / {2}$/.test(line);
    const content = renderInline(line.trim(), currentPath);
    return `${content}${hardBreak ? '<br>' : ' '}`;
  }).join('').trim();
}

export function renderMarkdown(markdown, currentPath = '') {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^( {0,3})(`{3,}|~{3,})\s*([^\s]*)\s*$/);
    if (fence) {
      // A fence indented inside a list item drops that indentation from its lines, as CommonMark does.
      const indent = new RegExp(`^ {0,${fence[1].length}}`);
      const marker = fence[2][0];
      const markerLength = fence[2].length;
      const language = fence[3].replace(/[^\w+-]/g, '');
      const code = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${marker}{${markerLength},}\\s*$`).test(lines[index])) {
        code.push(lines[index].replace(indent, ''));
        index += 1;
      }
      if (index < lines.length) index += 1;
      output.push(`<div class="markdown-code-block">${language ? `<span class="markdown-code-language">${escapeHtml(language)}</span>` : ''}<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre></div>`);
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2], currentPath)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^ {0,3}(?:[-*_]\s*){3,}$/.test(line)) {
      output.push('<hr>');
      index += 1;
      continue;
    }

    if (line.includes('|') && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line);
      const dividers = splitTableRow(lines[index + 1]);
      const alignments = dividers.map(tableAlignment);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const headerHtml = headers.map((cell, cellIndex) => `<th class="align-${alignments[cellIndex] || 'left'}">${renderInline(cell, currentPath)}</th>`).join('');
      const rowHtml = rows.map(row => `<tr>${headers.map((_, cellIndex) => `<td class="align-${alignments[cellIndex] || 'left'}">${renderInline(row[cellIndex] || '', currentPath)}</td>`).join('')}</tr>`).join('');
      output.push(`<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></div>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      output.push(`<blockquote>${renderMarkdown(quote.join('\n'), currentPath)}</blockquote>`);
      continue;
    }

    const listItem = line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
    if (listItem) {
      const ordered = /\d+\./.test(listItem[1]);
      const items = [];
      const start = ordered ? Number.parseInt(listItem[1], 10) : 1;
      while (index < lines.length) {
        const match = lines[index].match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
        if (!match || /\d+\./.test(match[1]) !== ordered) break;
        // A wrapped item continues on the next lines until a blank line, another item or another block.
        // An indented line is part of the item (not code), unless it opens a fenced block.
        let text = match[2];
        index += 1;
        while (index < lines.length && lines[index].trim()
          && !/^\s*(?:[-+*]|\d+\.)\s+/.test(lines[index])
          && (/^\s+\S/.test(lines[index]) ? !/^\s*(`{3,}|~{3,})/.test(lines[index]) : !isBlockStart(lines, index))) {
          text += ` ${lines[index].trim()}`;
          index += 1;
        }
        const task = text.match(/^\[([ xX])\]\s+(.+)$/);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(`<li class="task-item"><input type="checkbox" disabled${checked ? ' checked' : ''}><span>${renderInline(task[2], currentPath)}</span></li>`);
        } else {
          items.push(`<li>${renderInline(text, currentPath)}</li>`);
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      const startAttribute = ordered && start !== 1 ? ` start="${start}"` : '';
      output.push(`<${tag}${startAttribute}>${items.join('')}</${tag}>`);
      continue;
    }

    if (/^(?: {4}|\t)\S/.test(line)) {
      const code = [];
      while (index < lines.length && (/^(?: {4}|\t)/.test(lines[index]) || !lines[index].trim())) {
        code.push(lines[index].replace(/^(?: {4}|\t)/, ''));
        index += 1;
      }
      output.push(`<div class="markdown-code-block"><pre><code>${escapeHtml(code.join('\n').trimEnd())}</code></pre></div>`);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    output.push(`<p>${renderParagraph(paragraph, currentPath)}</p>`);
  }

  return output.join('\n');
}
