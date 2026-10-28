// Chispa's settings: the "chispa" section of mentor.config.json (local, outside git) over safe defaults.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from '../scripts/lib.mjs';

export const COMPANION_DIR = path.join(ROOT, '.companion');
export const MEMORY_DIR = path.join(COMPANION_DIR, 'memory');
export const INBOX_DIR = path.join(MEMORY_DIR, 'inbox');
export const EDITS_DIR = path.join(COMPANION_DIR, 'edits');
export const CONVERSATIONS_DIR = path.join(COMPANION_DIR, 'conversations');
export const NUDGES_FILE = path.join(COMPANION_DIR, 'nudges.json');
export const PERSONA_FILE = path.join(ROOT, 'companion', 'PERSONA.md');
// What the learner already knows and wants: written with module-builder, read by every mentor.
export const PROFILE_FILE = path.join(ROOT, 'course', '00-PERFIL.md');

const DEFAULTS = {
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  nudgeEffort: 'low',
  learnerName: null,
  quietHours: {from: '23:00', to: '08:30'},
  thresholds: {noProgressHours: 20, repeatAfterHours: 24},
  // Documentation sites Chispa may read in full. Each course adds its own in mentor.config.json.
  webFetchDomains: [
    'developer.mozilla.org', 'docs.python.org', 'nodejs.org', 'github.com', 'en.wikipedia.org', 'es.wikipedia.org',
  ],
};

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const isTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const isDomain = value => typeof value === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);

function gitFirstName() {
  const result = spawnSync('git', ['config', 'user.name'], {cwd: ROOT, encoding: 'utf8', shell: false});
  return String(result.stdout || '').trim().split(/\s+/)[0] || null;
}

// Invalid values fall back to the default instead of failing: a typo must not silence Chispa.
export function chispaConfig() {
  let section = {};
  try {
    section = JSON.parse(fs.readFileSync(path.join(ROOT, 'mentor.config.json'), 'utf8')).chispa || {};
  } catch {}
  const pick = (key, valid) => (valid(section[key]) ? section[key] : DEFAULTS[key]);
  const thresholds = section.thresholds || {};
  return {
    model: pick('model', value => typeof value === 'string' && /^[a-z0-9.-]+$/.test(value)),
    effort: pick('effort', value => EFFORTS.has(value)),
    nudgeEffort: pick('nudgeEffort', value => EFFORTS.has(value)),
    learnerName: typeof section.learnerName === 'string' && section.learnerName.trim()
      ? section.learnerName.trim().slice(0, 40)
      : gitFirstName(),
    quietHours: isTime(section.quietHours?.from) && isTime(section.quietHours?.to) ? section.quietHours : DEFAULTS.quietHours,
    thresholds: {
      noProgressHours: Number.isFinite(thresholds.noProgressHours) && thresholds.noProgressHours > 0 ? thresholds.noProgressHours : DEFAULTS.thresholds.noProgressHours,
      repeatAfterHours: Number.isFinite(thresholds.repeatAfterHours) && thresholds.repeatAfterHours > 0 ? thresholds.repeatAfterHours : DEFAULTS.thresholds.repeatAfterHours,
    },
    webFetchDomains: Array.isArray(section.webFetchDomains) && section.webFetchDomains.every(isDomain)
      ? section.webFetchDomains
      : DEFAULTS.webFetchDomains,
  };
}
