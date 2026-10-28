// Biblioteca de conceptos: único lector de documentos Markdown del dashboard (guía del mentor,
// material de cada módulo y referencia del track), con temas, navegador lateral, zoom, pantalla
// completa y atajos. Vive dentro del dashboard, en la misma pestaña (un iframe que el dashboard
// muestra y oculta); abierto solo, "← Dashboard" vuelve a /. Sólo lee documentos de /api/doc, que
// aplica la allowlist del servidor.
import {renderMarkdown} from './markdown.js';

const $ = selector => document.querySelector(selector);
const topbar = $('#topbar');
const sheet = $('#docSheet');
const scrollArea = $('#scrollArea');
const statusEl = $('#status');
const docNameEl = $('#docName');
const outlineList = $('#outlineList');
const outlineEmpty = $('#outlineEmpty');
const docList = $('#docList');
const searchInput = $('#searchInput');
const themeSelect = $('#themeSelect');
const zoomInput = $('#zoomInput');
const widthSelect = $('#widthSelect');
const fullscreenBtn = $('#fullscreenBtn');
const docPosition = $('#docPosition');
const navTabButtons = [...document.querySelectorAll('[data-nav-tab]')];
const navPanes = [...document.querySelectorAll('[data-nav-pane]')];

const MIN_ZOOM = 60;
const MAX_ZOOM = 220;
const DEFAULT_DOC = '00-EMPEZA-ACA.md';

let library = [];        // [{group, title, path}]: inicio del track, material de módulos, referencia
let libraryData;         // respuesta de /api/library, se pide una sola vez
let currentPath = '';
let currentPosition = -1; // índice en library; un mismo doc puede aparecer en varios grupos
let currentTrack = '';
const embedded = window.parent !== window;
let readDocs = new Map(); // path → leído, de la lista de lectura de cada módulo (readDocs del estado)

const store = {
  get(key) { try { return localStorage.getItem(`md-study-${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`md-study-${key}`, String(value)); } catch { /* sin storage: sólo no se recuerda */ } },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const setStatus = text => { statusEl.textContent = text; };
// Docs outside course/<track>/ (the mentor's guide, course-wide docs) keep the library that is already open.
const trackFor = path => String(path).match(/^course\/([^/]+)\//)?.[1] || currentTrack || null;
const titleFromFile = path => {
  const name = path.split('/').pop().replace(/\.md$/, '');
  const [, number, rest] = name.match(/^(\d\d)-(.+)$/) || [null, '', name];
  const words = rest.replace(/[-_]/g, ' ').toLowerCase();
  return `${number ? `${number} · ` : ''}${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

async function fetchDoc(path) {
  const response = await fetch(`/api/doc?path=${encodeURIComponent(path)}`);
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try { message = JSON.parse(text).error || text; } catch { /* texto plano */ }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return text;
}

// ---------- preferencias visuales (mismos presets que el lector original) ----------

function setTheme(theme) {
  document.body.className = document.body.className
    .split(/\s+/)
    .filter(name => name && !name.startsWith('theme-'))
    .concat(theme)
    .join(' ');
  themeSelect.value = theme;
  store.set('theme', theme);
}

// The "Dashboard" preset mirrors the dashboard's auto/light/dark toggle (same storage key).
function syncDashboardTheme() {
  let theme = null;
  try { theme = localStorage.getItem('mentor-theme'); } catch { /* sin storage: automático */ }
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function setZoom(value) {
  const zoom = clamp(Math.round(Number(value) || 100), MIN_ZOOM, MAX_ZOOM);
  zoomInput.value = String(zoom);
  document.documentElement.style.setProperty('--reader-zoom', String(zoom / 100));
  store.set('zoom', zoom);
}

function setSheetWidth(value) {
  widthSelect.value = String(value);
  document.documentElement.style.setProperty('--sheet-width', `${Number(value) || 860}px`);
  store.set('width', widthSelect.value);
}

function updateHeaderHeight() {
  const height = Math.ceil(topbar.getBoundingClientRect().height || 74);
  document.documentElement.style.setProperty('--measured-header-height', `${height}px`);
  if (!document.body.classList.contains('header-hidden')) {
    document.documentElement.style.setProperty('--header-height', `${height}px`);
  }
}

function setHeaderHidden(hidden, persist = true) {
  document.body.classList.toggle('header-hidden', hidden);
  document.body.classList.remove('header-reveal-active');
  if (hidden) document.documentElement.style.setProperty('--header-height', '0px');
  else updateHeaderHeight();
  if (persist) store.set('header-hidden', hidden);
}

function setNavCollapsed(collapsed, persist = true) {
  document.body.classList.toggle('nav-collapsed', collapsed);
  document.body.classList.remove('nav-reveal-active');
  if (persist) store.set('nav-collapsed', collapsed);
}

function setNavTab(tabName) {
  const next = tabName === 'docs' ? 'docs' : 'outline';
  navTabButtons.forEach(button => {
    const active = button.dataset.navTab === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  navPanes.forEach(pane => pane.classList.toggle('active', pane.dataset.navPane === next));
  store.set('nav-tab', next);
}

function updateFullscreenButton() {
  const expanded = document.body.classList.contains('expanded-view') || Boolean(document.fullscreenElement);
  fullscreenBtn.classList.toggle('toggle-active', expanded);
  fullscreenBtn.textContent = expanded ? 'Salir pantalla' : '⛶ Pantalla completa';
  fullscreenBtn.setAttribute('aria-pressed', String(expanded));
}

async function toggleFullscreen() {
  const expanded = document.body.classList.contains('expanded-view') || Boolean(document.fullscreenElement);
  if (expanded) {
    document.body.classList.remove('expanded-view');
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => null);
  } else {
    document.body.classList.add('expanded-view');
    await document.documentElement.requestFullscreen?.().catch(() => null);
  }
  updateFullscreenButton();
}

// ---------- índice de la biblioteca ----------

async function loadLibrary(requested) {
  if (!libraryData) {
    libraryData = await fetch('/api/library').then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    readDocs = new Map(Object.values(libraryData.tracks)
      .flatMap(info => info.modules.flatMap(module => module.reading || []))
      .map(entry => [entry.path, entry.read]));
  }
  // The requested track, else the one already open, else the first one; none while the course is empty.
  const track = [requested, currentTrack, Object.keys(libraryData.tracks)[0]]
    .find(candidate => candidate && Object.hasOwn(libraryData.tracks, candidate)) || null;
  if (track === currentTrack && library.length) return;
  currentTrack = track;
  const info = track ? libraryData.tracks[track] : {title: '', trackDocs: [], referenceIndex: null, modules: []};
  const start = `Inicio · ${info.title}`;
  const items = info.trackDocs.map(path => ({group: start, title: titleFromFile(path), path}));

  // Reference pages listed under a heading that names a module (## A00 — …, ### B00 · …,
  // ## Herramientas (C03–C04): the first id wins) go under that module; the rest stay general.
  const moduleReferences = new Map();
  const generalReferences = [];
  if (info.referenceIndex) {
    items.push({group: start, title: 'Índice de la referencia', path: info.referenceIndex});
    const base = info.referenceIndex.split('/').slice(0, -1).join('/');
    const moduleIds = new Set(info.modules.map(module => module.id));
    let target = generalReferences;
    let general = 'Referencia';
    for (const line of (await fetchDoc(info.referenceIndex)).split('\n')) {
      const heading = line.match(/^(#{2,3})\s+(.+)$/);
      if (heading) {
        const id = heading[2].match(/\b[A-Z]\d\d\b/g)?.find(candidate => moduleIds.has(candidate));
        if (id) {
          if (!moduleReferences.has(id)) moduleReferences.set(id, []);
          target = moduleReferences.get(id);
        } else if (heading[1] === '##') {
          general = `Referencia · ${heading[2].trim()}`;
          target = generalReferences;
        }
        continue;
      }
      const link = line.match(/^\s*(?:[-*]|\d+\.)\s+\[([^\]]+)\]\(([^)\s]+\.md)\)/);
      if (link && !link[2].includes('/')) target.push({group: general, title: link[1], path: `${base}/${link[2]}`});
    }
  }

  for (const module of info.modules) {
    const group = `${module.id} — ${module.title}`;
    for (const path of module.docs) items.push({group, section: 'Material', title: titleFromFile(path), path});
    for (const reference of moduleReferences.get(module.id) || []) items.push({...reference, group, section: 'Referencia'});
  }
  items.push(...generalReferences);
  for (const path of libraryData.courseDocs) items.push({group: 'Sobre el curso', title: titleFromFile(path), path});
  for (const path of libraryData.mentorDocs) items.push({group: 'Sobre el mentor', title: titleFromFile(path), path});
  library = items;
}

// The red dot marks the first unread doc of the current module's reading list, the one to read now.
function nextReadingPath() {
  const module = Object.values(libraryData?.tracks || {})
    .flatMap(info => info.modules)
    .find(candidate => candidate.id === libraryData.currentModule);
  return module?.reading?.find(entry => !readDocs.get(entry.path))?.path || null;
}

function renderDocList() {
  const next = nextReadingPath();
  const query = searchInput.value.trim().toLowerCase();
  const visible = library.filter(item => !query
    || item.title.toLowerCase().includes(query)
    || item.group.toLowerCase().includes(query)
    || item.section?.toLowerCase().includes(query)
    || item.path.toLowerCase().includes(query));
  docList.innerHTML = '';
  if (!visible.length) {
    docList.innerHTML = '<div class="outline-empty">Ningún documento coincide.</div>';
    return;
  }
  let lastGroup = null;
  let lastSection = null;
  for (const item of visible) {
    if (item.group !== lastGroup) {
      const title = document.createElement('div');
      title.className = 'doc-group-title';
      title.textContent = item.group;
      docList.appendChild(title);
      lastGroup = item.group;
      lastSection = null;
    }
    if (item.section && item.section !== lastSection) {
      const title = document.createElement('div');
      title.className = 'doc-section-title';
      title.textContent = item.section;
      docList.appendChild(title);
      lastSection = item.section;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    const position = library.indexOf(item);
    button.classList.toggle('active', position === currentPosition);
    button.dataset.path = item.path;
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = item.title;
    button.appendChild(label);
    const read = readDocs.get(item.path);
    const isNext = item.path === next;
    button.classList.toggle('read', Boolean(read));
    button.classList.toggle('next', isNext);
    if (read || isNext) {
      const mark = document.createElement('span');
      mark.className = read ? 'read-mark' : 'next-dot';
      mark.textContent = read ? '✓' : '';
      mark.title = read ? 'Leído' : 'Siguiente para leer';
      mark.setAttribute('aria-label', mark.title);
      button.appendChild(mark);
    }
    button.addEventListener('click', () => openDoc(item.path, {position}));
    docList.appendChild(button);
  }
}

function updateDocPosition() {
  const index = currentPosition;
  docPosition.textContent = index >= 0 ? `${index + 1}/${library.length}` : '–';
  $('#prevDocBtn').disabled = index <= 0;
  $('#nextDocBtn').disabled = index < 0 || index >= library.length - 1;
}

function stepDoc(direction) {
  const position = currentPosition + direction;
  if (currentPosition >= 0 && library[position]) openDoc(library[position].path, {position});
}

// ---------- documento actual ----------

// Scroll only the document area. scrollIntoView would also scroll the window
// (allowed programmatically even with overflow: hidden) and shift the whole layout.
function scrollToElement(element, behavior = 'smooth') {
  const offset = element.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top;
  scrollArea.scrollTo({top: scrollArea.scrollTop + offset - 16, behavior});
}

function slugify(text, used) {
  const base = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seccion';
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

function buildOutline() {
  outlineList.innerHTML = '';
  const used = new Set();
  const headings = [...sheet.querySelectorAll('h1, h2, h3')];
  outlineEmpty.style.display = headings.length ? 'none' : 'block';
  for (const heading of headings) {
    heading.id = slugify(heading.textContent, used);
    const level = Number(heading.tagName.slice(1));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `nav-item outline-item level-${level}`;
    button.style.paddingLeft = `${9 + (level - 1) * 14}px`;
    button.textContent = heading.textContent;
    button.addEventListener('click', () => scrollToElement(heading));
    outlineList.appendChild(button);
  }
}

// Docs in a stage's reading list end with "Marcar como leído" and a link to the next unread one.
// The mark is the learner's own record for the dashboard's Entender phase; nothing validates it.
async function appendReadingFooter(path) {
  const [, moduleId, name] = String(path).match(/^course\/[^/]+\/([A-Z]\d\d)-[^/]+\/(\d\d-[^/]+\.md)$/) || [];
  if (!moduleId) return;
  let reading;
  try {
    const response = await fetch(`/api/reading?moduleId=${encodeURIComponent(moduleId)}`);
    reading = response.ok ? (await response.json()).reading : null;
  } catch {
    return;
  }
  const item = reading?.find(entry => entry.name === name);
  if (!item || currentPath !== path) return;

  const footer = document.createElement('footer');
  footer.className = 'reading-footer';
  const status = document.createElement('span');
  const button = document.createElement('button');
  button.type = 'button';
  const paint = () => {
    status.textContent = item.read ? `Marcado como leído en ${moduleId}.` : `Parte de la lectura de ${moduleId}.`;
    button.textContent = item.read ? 'Desmarcar' : 'Marcar como leído';
    button.className = item.read ? 'reading-undo' : '';
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await fetch('/api/module', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({moduleId, action: 'read', doc: name, value: !item.read}),
      });
      if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
      item.read = !item.read;
      readDocs.set(item.path, item.read);
      paint();
      renderDocList();
    } catch (error) {
      status.textContent = `No se pudo guardar: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
  paint();
  footer.append(status, button);
  const next = reading.find(entry => !entry.read && entry.name !== name);
  if (next) {
    const link = document.createElement('a');
    link.href = `?doc=${encodeURIComponent(next.path)}`;
    link.textContent = `Siguiente: ${titleFromFile(next.path)} →`;
    link.addEventListener('click', event => {
      event.preventDefault();
      openDoc(next.path);
    });
    footer.append(link);
  }
  sheet.append(footer);
}

async function openDoc(path, {push = true, hash = '', position, keepScroll = false} = {}) {
  const scrollTop = scrollArea.scrollTop;
  if (!keepScroll) document.body.classList.add('page-loading');
  setStatus(keepScroll ? 'Actualizando…' : 'Abriendo…');
  try {
    await loadLibrary(trackFor(path));
    const markdown = await fetchDoc(path);
    currentPath = path;
    currentPosition = library[position]?.path === path ? position : library.findIndex(item => item.path === path);
    sheet.innerHTML = renderMarkdown(markdown, path);
    appendReadingFooter(path);
    buildOutline();
    renderDocList();
    updateDocPosition();
    const title = sheet.querySelector('h1')?.textContent || path.split('/').pop();
    document.title = `${title} · Biblioteca de conceptos`;
    docNameEl.textContent = path;
    setStatus(title);
    if (push) history.pushState({path}, '', `?doc=${encodeURIComponent(path)}`);
    const target = hash && document.getElementById(hash);
    if (keepScroll) scrollArea.scrollTo({top: scrollTop, behavior: 'auto'});
    else if (target) scrollToElement(target, 'auto');
    else scrollArea.scrollTo({top: 0, behavior: 'auto'});
  } catch (error) {
    sheet.innerHTML = '';
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = `No se pudo abrir ${path}: ${error.message}`;
    sheet.appendChild(message);
    setStatus('Error al abrir el documento');
  } finally {
    document.body.classList.remove('page-loading');
  }
}

// ---------- volver al dashboard y cambios en vivo ----------

function backToDashboard() {
  if (embedded) window.parent.postMessage({type: 'close-reader'}, location.origin);
  else location.href = '/';
}

// The dashboard reuses this reader: it asks for a doc instead of reloading the iframe.
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type === 'open-doc' && typeof event.data.path === 'string') {
    if (event.data.path === currentPath) return;
    openDoc(event.data.path);
  }
});

// The server watches the repo: when the doc on screen changes it is re-rendered in place, keeping
// the scroll; course changes (a doc marked as read, a new doc) refresh the list and its marks.
let libraryTimer;
function refreshLibrary() {
  clearTimeout(libraryTimer);
  libraryTimer = setTimeout(async () => {
    const track = currentTrack;
    libraryData = undefined;
    currentTrack = '';
    try {
      await loadLibrary(track);
      currentPosition = library.findIndex(item => item.path === currentPath);
      renderDocList();
      updateDocPosition();
    } catch {}
  }, 300);
}

function connectLive() {
  const events = new EventSource('/api/events');
  events.addEventListener('change', event => {
    const {path} = JSON.parse(event.data);
    if (path === currentPath) {
      openDoc(currentPath, {push: false, keepScroll: true, position: currentPosition})
        .then(() => setStatus(`Actualizado ${new Date().toLocaleTimeString()}`));
    }
    if (/^course\/.*\.(md|json)$/.test(path)) refreshLibrary();
  });
  events.addEventListener('course', refreshLibrary);
}

// ---------- eventos ----------

sheet.addEventListener('click', event => {
  const link = event.target.closest?.('[data-doc-link]');
  if (link) openDoc(link.dataset.docLink);
});

window.addEventListener('popstate', event => {
  const path = event.state?.path || new URLSearchParams(location.search).get('doc') || DEFAULT_DOC;
  openDoc(path, {push: false});
});

themeSelect.addEventListener('change', event => setTheme(event.target.value));
$('#zoomOutBtn').addEventListener('click', () => setZoom(Number(zoomInput.value) - 10));
$('#zoomInBtn').addEventListener('click', () => setZoom(Number(zoomInput.value) + 10));
zoomInput.addEventListener('change', () => setZoom(zoomInput.value));
widthSelect.addEventListener('change', () => setSheetWidth(widthSelect.value));
fullscreenBtn.addEventListener('click', toggleFullscreen);
$('#dashboardBtn').addEventListener('click', backToDashboard);
$('#prevDocBtn').addEventListener('click', () => stepDoc(-1));
$('#nextDocBtn').addEventListener('click', () => stepDoc(1));
$('#toggleNavBtn').addEventListener('click', () => setNavCollapsed(!document.body.classList.contains('nav-collapsed')));
$('#collapseNavBtn').addEventListener('click', () => setNavCollapsed(true));
$('#showNavBtn').addEventListener('click', () => setNavCollapsed(false));
$('#hideHeaderBtn').addEventListener('click', () => setHeaderHidden(true));
$('#showHeaderBtn').addEventListener('click', () => setHeaderHidden(false));
navTabButtons.forEach(button => button.addEventListener('click', () => setNavTab(button.dataset.navTab)));
searchInput.addEventListener('input', () => {
  if (searchInput.value) setNavTab('docs');
  renderDocList();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('expanded-view');
  updateFullscreenButton();
});

document.addEventListener('mousemove', event => {
  const nearHeader = document.body.classList.contains('header-hidden') && event.clientY <= 64;
  const nearNav = document.body.classList.contains('nav-collapsed')
    && !document.body.classList.contains('expanded-view') && event.clientX <= 86;
  document.body.classList.toggle('header-reveal-active', nearHeader);
  document.body.classList.toggle('nav-reveal-active', nearNav);
});
document.addEventListener('mouseleave', () => document.body.classList.remove('header-reveal-active', 'nav-reveal-active'));

document.addEventListener('keydown', event => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (event.key === 'Escape' && tag === 'input') { document.activeElement.blur(); return; }
  if (['input', 'select', 'textarea'].includes(tag) || event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (event.key === 'ArrowLeft') { event.preventDefault(); stepDoc(-1); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); stepDoc(1); }
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    scrollArea.scrollBy({top: (event.key === 'ArrowUp' ? -1 : 1) * scrollArea.clientHeight * 0.72, behavior: 'smooth'});
  }
  else if (key === 'n') $('#toggleNavBtn').click();
  else if (key === 'h') setHeaderHidden(!document.body.classList.contains('header-hidden'));
  else if (key === 'f') toggleFullscreen();
  else if (key === 'd') backToDashboard();
  else if (event.key === '/') { event.preventDefault(); searchInput.focus(); }
});

// ---------- arranque ----------

syncDashboardTheme();
window.addEventListener('storage', event => { if (event.key === 'mentor-theme') syncDashboardTheme(); });
setTheme(store.get('theme') || 'theme-dashboard');
setZoom(store.get('zoom') || 100);
setSheetWidth(store.get('width') || 860);
setNavTab(store.get('nav-tab') || 'outline');
if (store.get('nav-collapsed') === 'true') setNavCollapsed(true, false);
if (store.get('header-hidden') === 'true') setHeaderHidden(true, false);
new ResizeObserver(updateHeaderHeight).observe(topbar);
updateHeaderHeight();
updateFullscreenButton();

const initial = new URLSearchParams(location.search).get('doc') || DEFAULT_DOC;
history.replaceState({path: initial}, '', `?doc=${encodeURIComponent(initial)}`);
openDoc(initial, {push: false, hash: decodeURIComponent(location.hash.slice(1))});
connectLive();
