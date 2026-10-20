import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('loadClefEnv: project .env wins over the user-level ~/.clefcut/.env, which still works alone; the model defaults to clef', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-env-'));
  const home = path.join(tmp, 'home'); const proj = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const keys = ['CLEFCUT_HOME', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLEF_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.CLEFCUT_HOME = home;
  try {
    const { loadClefEnv } = await import('../../src/core/env.mjs');
    assert.deepEqual(loadClefEnv(proj), { account: '', token: '', model: 'clef', hasKey: false });
    fs.writeFileSync(path.join(home, '.env'), 'CLOUDFLARE_ACCOUNT_ID=user-acc\nCLOUDFLARE_API_TOKEN=user-token\n');
    assert.deepEqual(loadClefEnv(proj), { account: 'user-acc', token: 'user-token', model: 'clef', hasKey: true });
    fs.writeFileSync(path.join(proj, '.env'), 'CLOUDFLARE_API_TOKEN="project-token"\nCLEF_MODEL=clef-flash\n');
    assert.deepEqual(loadClefEnv(proj), { account: 'user-acc', token: 'project-token', model: 'clef-flash', hasKey: true });
    process.env.CLOUDFLARE_API_TOKEN = 'shell-token';
    assert.equal(loadClefEnv(proj).token, 'shell-token');                     // the process environment wins
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadClefEnv: an inline # comment is not part of the value, and an empty value never wipes a value from another file', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-env2-'));
  const home = path.join(tmp, 'home'); const proj = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const keys = ['CLEFCUT_HOME', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLEF_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.CLEFCUT_HOME = home;
  try {
    const { loadClefEnv } = await import('../../src/core/env.mjs');
    fs.writeFileSync(path.join(home, '.env'), 'CLOUDFLARE_ACCOUNT_ID=user-acc\nCLOUDFLARE_API_TOKEN=user-token\n');
    fs.writeFileSync(path.join(proj, '.env'), 'CLOUDFLARE_ACCOUNT_ID=   # filled in ~/.clefcut/.env\nCLOUDFLARE_API_TOKEN=\nCLEF_MODEL=clef-flash   # cheaper\n');
    assert.deepEqual(loadClefEnv(proj), { account: 'user-acc', token: 'user-token', model: 'clef-flash', hasKey: true });
    fs.writeFileSync(path.join(proj, '.env'), 'CLOUDFLARE_API_TOKEN="ab#cd"\nCLOUDFLARE_ACCOUNT_ID=acc#1\n');
    assert.equal(loadClefEnv(proj).token, 'ab#cd');                          // a # inside quotes, or with no space before it, is kept
    assert.equal(loadClefEnv(proj).account, 'acc#1');
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadConfig: an empty or non-text path key falls back to the default instead of crashing', async () => {
  const { loadConfig } = await import('../../src/core/config.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cfg-'));
  fs.mkdirSync(path.join(root, 'clefcut'), { recursive: true });
  fs.writeFileSync(path.join(root, 'clefcut', 'clefcut.yaml'), 'brand:\nschedule: 42\nworkers: 0\n');
  const c = loadConfig(root);
  assert.equal(c.brandPath, path.join(root, 'clefcut', 'brand.yaml'));
  assert.equal(c.schedulePath, path.join(root, 'clefcut', 'schedule.json'));
  assert.equal(c.workers, 4);                                                // 0 workers would never run a request
  fs.rmSync(root, { recursive: true, force: true });
});

test('pluginRoot: CLEFCUT_ROOT (set by the standalone launcher in any agent) wins over CLAUDE_PLUGIN_ROOT', async () => {
  const { pluginRoot } = await import('../../src/core/paths.mjs');
  const saved = { a: process.env.CLEFCUT_ROOT, b: process.env.CLAUDE_PLUGIN_ROOT };
  try {
    process.env.CLAUDE_PLUGIN_ROOT = '/claude/plugin'; process.env.CLEFCUT_ROOT = '/skills/clefcut/runtime';
    assert.equal(pluginRoot(), '/skills/clefcut/runtime');
    delete process.env.CLEFCUT_ROOT;
    assert.equal(pluginRoot(), '/claude/plugin');
  } finally {
    for (const [k, v] of [['CLEFCUT_ROOT', saved.a], ['CLAUDE_PLUGIN_ROOT', saved.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
