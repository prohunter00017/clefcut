// clefcut/clefcut.yaml: per-project settings. Every key is optional.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { clefcutDir } from './paths.mjs';

export const DEFAULTS = { schedule: 'clefcut/schedule.json', brand: 'clefcut/brand.yaml', workers: 4, test_width: null,
  question_bank: null, sweep_bank: null, composition: null, audio: 'auto' };   // audio: auto | required | none (deliver-check)

export const TEST_WIDTH = { '16:9': 350, '9:16': 210, '1:1': 375 };

export function loadConfig(root) {
  const file = path.join(clefcutDir(root), 'clefcut.yaml');
  let cfg = {};
  if (fs.existsSync(file)) cfg = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  const out = { ...DEFAULTS, ...cfg, root, file };
  for (const k of ['schedule', 'brand']) if (typeof out[k] !== 'string' || !out[k].trim()) out[k] = DEFAULTS[k];   // "brand:" with no value
  if (!(Number.isInteger(out.workers) && out.workers >= 1)) out.workers = DEFAULTS.workers;
  out.schedulePath = path.resolve(root, out.schedule);
  out.questionBankPath = typeof out.question_bank === 'string' && out.question_bank.trim() ? path.resolve(root, out.question_bank) : null;
  out.brandPath = path.resolve(root, out.brand);
  return out;
}
