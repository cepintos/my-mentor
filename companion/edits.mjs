// Chispa's proposed edits: one JSON file per proposal in .companion/edits/. Chispa never writes the
// repo; it proposes "replace this exact text with that one" in a course doc, and only the learner's
// Aplicar in the dashboard changes the file. Targets are the course docs the concept library
// serves (libraryDocs under course/). Never the mentor's guide at the root, which belongs to the
// core and arrives with every update, nor lab files, code or config.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {libraryDocs, loadCatalog, safe} from '../scripts/lib.mjs';
import {EDITS_DIR} from './config.mjs';

const ID_PATTERN = /^\d{4}-\d\d-\d\d-[0-9a-f]{8}$/;
const MAX_TEXT = 4000;

function occurrences(content, search) {
  let count = 0;
  for (let index = content.indexOf(search); index !== -1; index = content.indexOf(search, index + 1)) count += 1;
  return count;
}

// Checks that the edit still applies to the doc as it is now; returns the new content.
function applied(relative, buscar, reemplazar) {
  if (!relative.startsWith('course/') || !libraryDocs(loadCatalog()).has(relative)) {
    throw new Error(`${relative} no es un documento del curso: Chispa sólo puede proponer cambios en el material (course/…/*.md)`);
  }
  const content = fs.readFileSync(safe(relative), 'utf8');
  const count = occurrences(content, buscar);
  if (count !== 1) throw new Error(`El texto a reemplazar aparece ${count} veces en ${relative}; tiene que aparecer exactamente una`);
  return content.replace(buscar, () => reemplazar);
}

export function proposeEdit(fields) {
  const ruta = String(fields.ruta || '').replace(/^\.\//, '');
  const buscar = String(fields.buscar || '');
  const reemplazar = String(fields.reemplazar ?? '');
  const motivo = String(fields.motivo || '').replace(/\s+/g, ' ').trim();
  if (!buscar.trim()) throw new Error('buscar no puede estar vacío');
  if (buscar.length > MAX_TEXT || reemplazar.length > MAX_TEXT) throw new Error(`buscar y reemplazar tienen hasta ${MAX_TEXT} caracteres: los cambios son puntuales`);
  if (buscar === reemplazar) throw new Error('buscar y reemplazar son iguales');
  if (motivo.length < 10 || motivo.length > 300) throw new Error('motivo debe tener entre 10 y 300 caracteres');
  applied(ruta, buscar, reemplazar);
  const fecha = new Date().toISOString();
  const id = `${fecha.slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`;
  fs.mkdirSync(EDITS_DIR, {recursive: true});
  fs.writeFileSync(path.join(EDITS_DIR, `${id}.json`), JSON.stringify({id, fecha, ruta, buscar, reemplazar, motivo}, null, 2));
  return id;
}

function locate(id) {
  if (!ID_PATTERN.test(String(id))) throw new Error('id de cambio inválido');
  const file = path.join(EDITS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`No existe el cambio ${id}`);
  return {file, edit: JSON.parse(fs.readFileSync(file, 'utf8'))};
}

export function listEdits() {
  let names = [];
  try { names = fs.readdirSync(EDITS_DIR).filter(name => name.endsWith('.json')); } catch {}
  return names
    .map(name => {
      try { return JSON.parse(fs.readFileSync(path.join(EDITS_DIR, name), 'utf8')); } catch { return null; }
    })
    .filter(edit => edit && ID_PATTERN.test(edit.id))
    .sort((left, right) => String(left.fecha).localeCompare(String(right.fecha)));
}

// Applies an approved edit atomically and removes the proposal. Returns the changed path.
export function applyEdit(id) {
  const {file, edit} = locate(id);
  const content = applied(edit.ruta, edit.buscar, edit.reemplazar);
  const target = safe(edit.ruta);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, target);
  fs.rmSync(file, {force: true});
  return edit.ruta;
}

export function discardEdit(id) {
  fs.rmSync(locate(id).file, {force: true});
}
