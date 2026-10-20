import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as onboard from '../../src/commands/onboard.mjs';
import * as init from '../../src/commands/init.mjs';
import * as doctor from '../../src/commands/doctor.mjs';
import { loadConfig } from '../../src/core/config.mjs';
import { validateSchedule } from '../../src/core/schedule.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-test-platform-'));
process.env.SAGECUT_HOME = path.join(tmp, 'home');
const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ dependencies: { remotion: '4.0.0' } }));
const ctx = () => ({ root: proj, config: loadConfig(proj) });

async function capture(fn) {
  const out = []; const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  try { const code = await fn(); return { code, text: out.join('\n') }; } finally { console.log = orig; }
}

test('hooks.json is the exec form with the plugin root', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const e = h.hooks.SessionStart[0].hooks[0];
  assert.equal(e.type, 'command'); assert.equal(e.command, 'node');
  assert.deepEqual(e.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/welcome.mjs']);
});

test('welcome hook prints once and never fails', () => {
  const data = path.join(tmp, 'plugin-data');
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data };
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'welcome.mjs')], { env, encoding: 'utf8' });
  const a = run(); assert.equal(a.status, 0);
  assert.deepEqual(JSON.parse(a.stdout), { systemMessage: 'SageCut is installed. Type /sagecut:start to begin.' });
  const b = run(); assert.equal(b.status, 0); assert.equal(b.stdout, '');
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'welcome.mjs')], { env: { ...process.env, CLAUDE_PLUGIN_DATA: path.join(__filename_dummy(), 'x') }, encoding: 'utf8' });
  assert.equal(bad.status, 0);
});
function __filename_dummy() { return path.join(tmp, 'plugin-data', 'welcomed'); }   // a file, so mkdir below it fails

test('onboard status, welcome, done', async () => {
  let r = await capture(() => onboard.run(['status', '--json'], ctx()));
  const s = JSON.parse(r.text);
  assert.equal(s.onboarded, false); assert.equal(s.isRemotionProject, true); assert.equal(s.hasBrand, false); assert.ok(s.keyPage);
  r = await capture(() => onboard.run(['welcome'], ctx()));
  assert.match(r.text, /SageCut/);
  r = await capture(() => onboard.run(['done'], ctx()));
  assert.equal(r.code, 0);
  r = await capture(() => onboard.run(['status', '--json'], ctx()));
  assert.equal(JSON.parse(r.text).onboarded, true);
  assert.ok(fs.existsSync(path.join(tmp, 'home', 'state.json')));
});

test('init writes the files and never overwrites', async () => {
  fs.writeFileSync(path.join(proj, '.gitignore'), 'node_modules\n.env\n');
  let r = await capture(() => init.run(['--composition', 'Promo', '--fps', '60', '--frames', '600'], ctx()));
  assert.equal(r.code, 0);
  for (const f of ['sagecut/sagecut.yaml', 'sagecut/schedule.json', 'src/sagecut/useSchedule.ts', '.env.example']) assert.ok(fs.existsSync(path.join(proj, f)), f);
  assert.ok(fs.existsSync(path.join(proj, 'sagecut', 'metrics')));
  const sched = JSON.parse(fs.readFileSync(path.join(proj, 'sagecut', 'schedule.json'), 'utf8'));
  assert.deepEqual(validateSchedule(sched), []);
  assert.equal(sched.fps, 60);
  assert.deepEqual(sched.effects, []);
  assert.equal(sched.beats[0].elements[0].role, 'headline');
  assert.match(sched._help, /role/);
  assert.match(fs.readFileSync(path.join(proj, 'sagecut', 'sagecut.yaml'), 'utf8'), /^audio: auto\s+#/m);
  const gi = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
  assert.equal(gi.split('\n').filter((l) => l === '.env').length, 1);
  assert.match(gi, /sagecut\/qa\/\*\/raw\//);
  assert.match(fs.readFileSync(path.join(proj, 'sagecut', 'sagecut.yaml'), 'utf8'), /^composition: Promo$/m);
  const ts = fs.readFileSync(path.join(proj, 'src', 'sagecut', 'useSchedule.ts'), 'utf8');
  assert.match(ts, /export function useBeat/); assert.match(ts, /export const Scheduled/);
  // second run keeps everything
  fs.writeFileSync(path.join(proj, 'sagecut', 'schedule.json'), '{"mine":true}');
  r = await capture(() => init.run([], ctx()));
  assert.match(r.text, /Kept/);
  assert.equal(fs.readFileSync(path.join(proj, 'sagecut', 'schedule.json'), 'utf8'), '{"mine":true}');
});

test('doctor reports every check and masks the key', async () => {
  const saved = { acc: process.env.CLOUDFLARE_ACCOUNT_ID, tok: process.env.CLOUDFLARE_API_TOKEN };
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-test'; process.env.CLOUDFLARE_API_TOKEN = 'cf-test-secret-1234';
  try {
    const checks = await doctor.checks(ctx());
    const names = checks.map((c) => c.name);
    for (const n of ['node', 'ffmpeg', 'clef key', 'clef model', 'ocr', 'brand', 'schedule']) assert.ok(names.includes(n), n);
    assert.ok(!JSON.stringify(checks).includes('secret'));
    assert.match(checks.find((c) => c.name === 'clef key').detail, /1234/);
    assert.equal(checks.find((c) => c.name === 'node').status, 'pass');
    assert.equal(checks.find((c) => c.name === 'ocr').status, 'pass');
  } finally {
    for (const [k, v] of [['CLOUDFLARE_ACCOUNT_ID', saved.acc], ['CLOUDFLARE_API_TOKEN', saved.tok]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }); });

test('cli: the savings hooks never fail on a broken sagecut.yaml (a Stop hook exit 2 blocks the agent)', () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-hook-'));
  fs.mkdirSync(path.join(p, 'sagecut'), { recursive: true });
  fs.writeFileSync(path.join(p, 'sagecut', 'sagecut.yaml'), 'brand: [unclosed\n\tbad: tab\n');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.mjs'), 'savings', 'stop'], { cwd: p, encoding: 'utf8', env: { ...process.env, SAGECUT_HOME: path.join(p, 'home') } });
  assert.equal(r.status, 0, r.stderr);
  fs.rmSync(p, { recursive: true, force: true });
});

test('cli: --root=DIR works like --root DIR', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-root-')), here = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cwd-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.mjs'), 'init', `--root=${target}`], { cwd: here, encoding: 'utf8', env: { ...process.env, SAGECUT_HOME: path.join(here, 'home') } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(target, 'sagecut', 'schedule.json')));
  assert.ok(!fs.existsSync(path.join(here, 'sagecut')));
  fs.rmSync(target, { recursive: true, force: true }); fs.rmSync(here, { recursive: true, force: true });
});

test('init: the schedule skeleton ends on the last frame, not one past it', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-init-'));
  await capture(() => init.run(['--frames', '300'], { root: d, config: loadConfig(d) }));
  const s = JSON.parse(fs.readFileSync(path.join(d, 'sagecut', 'schedule.json'), 'utf8'));
  assert.equal(s.beats[0].end, 299);
  assert.equal(s.beats[0].elements[0].out, 299);
  assert.deepEqual(validateSchedule(s), []);
  fs.rmSync(d, { recursive: true, force: true });
});
