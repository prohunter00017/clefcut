import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodePng } from '../../src/core/png.mjs';
import { imageSize, imageTokens, toClefRequest, readAnswers, NULL_BAND, ClefClient, clefUsd } from '../../src/core/clef.mjs';
import { loadConfig } from '../../src/core/config.mjs';
import * as doctor from '../../src/commands/doctor.mjs';

const png = (w, h) => `data:image/png;base64,${encodePng(Buffer.alloc(w * h * 3), w, h, 3).toString('base64')}`;
const jpeg = (w, h) => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0),
  0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, ...Array(9).fill(0), 0xff, 0xd9]).toString('base64')}`;

const ENV_KEYS = ['CLEFCUT_HOME', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLEF_MODEL'];

// A temp project and user folder, with the Cloudflare variables cleared; dotenv is written to the project .env.
async function withEnv(dotenv, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-clef-'));
  const home = path.join(tmp, 'home'), proj = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.CLEFCUT_HOME = home;
  if (dotenv) fs.writeFileSync(path.join(proj, '.env'), dotenv);
  try { return await fn(proj); } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Replace fetch for Cloudflare URLs only; everything else goes to the real fetch.
async function withFetch(handler, fn) {
  const orig = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('https://api.cloudflare.com/')) return orig(url, init);
    const call = { url: String(url), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const [status, json] = handler(call);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  try { return await fn(calls); } finally { globalThis.fetch = orig; }
}

const ok = (answers, input = 600) => [200, { result: { model: 'clef', answers, usage: { input_tokens: input, output_tokens: 1 } }, success: true, errors: [], messages: [] }];
const CF_ENV = 'CLOUDFLARE_ACCOUNT_ID=acc-123\nCLOUDFLARE_API_TOKEN=tok-secret-9876\n';
const yesno = [{ id: 'q', kind: 'yesno', instructions: 'Is any word cut off?' }];

test('imageSize reads PNG and JPEG data URIs', () => {
  assert.deepEqual(imageSize(png(64, 48)), { w: 64, h: 48 });
  assert.deepEqual(imageSize(jpeg(1920, 1080)), { w: 1920, h: 1080 });
  assert.equal(imageSize('data:image/webp;base64,UklGRgAAAAA='), null);
});

test('imageTokens: 32 px patches, small pictures scaled up to 256x256, large ones capped at 1,024, plus 3 markers', () => {
  assert.equal(imageTokens({ w: 960, h: 540 }), 513);     // Cloudflare billed exactly this in the live test
  assert.equal(imageTokens({ w: 1920, h: 1080 }), 1027);
  assert.equal(imageTokens({ w: 350, h: 197 }), 69);
  assert.equal(imageTokens({ w: 100, h: 100 }), 67);
});

test('toClefRequest: yes/no becomes noul, scale becomes score with levels lowest first, the picture goes in images', () => {
  const media = png(64, 48);
  const req = toClefRequest('clef', { content: { kind: 'image', media }, questions: [
    { id: 'overlap', kind: 'yesno', instructions: 'Does text overlap?' },
    { id: 'hierarchy', kind: 'scale', instructions: 'How clear?', levels: [{ level: 1, description: 'clear' }, { level: 0, description: 'muddled' }] },
  ] });
  assert.equal(req.model, 'clef');
  assert.deepEqual(req.images, [media]);
  assert.ok(typeof req.state === 'string' && req.state.length > 0);
  assert.deepEqual(req.questions, {
    q0: { type: 'noul', instructions: 'Does text overlap?' },
    q1: { type: 'score', instructions: 'How clear?', criteria: ['muddled', 'clear'] },
  });
  const text = toClefRequest('clef', { content: 'Is this a test?', questions: [{ id: 'q', kind: 'yesno', instructions: 'Is it?' }] });
  assert.equal(text.state, 'Is this a test?');
  assert.equal(text.images, undefined);
});

test('toClefRequest rejects question kinds that Clef cannot answer', () => {
  assert.throws(() => toClefRequest('clef', { content: 'x', questions: [{ id: 'c', kind: 'choice', instructions: 'Which?' }] }), /choice/);
});

test('readAnswers: P(yes) becomes the answer, an unsure middle band is a null answer, score becomes expectation', () => {
  const levels = (from) => [0, 1, 2, 3, 4].map((i) => ({ level: from + i, description: `l${i}` }));
  const group = { questions: [
    { id: 'a', kind: 'yesno' }, { id: 'b', kind: 'yesno' }, { id: 'c', kind: 'yesno' },
    { id: 'd', kind: 'scale', levels: levels(0) }, { id: 'e', kind: 'scale', levels: levels(1) }, { id: 'f', kind: 'yesno' },
  ] };
  const out = readAnswers(group, {
    q0: { type: 'noul', noul: 0.9 }, q1: { type: 'noul', noul: 0.2 }, q2: { type: 'noul', noul: 0.5 + NULL_BAND / 2 },
    q3: { type: 'score', score: 2.5 }, q4: { type: 'score', score: 2.5 },
  });
  assert.deepEqual(out.a, { ok: true, answer: 'yes', p: 0.9, expectation: null });
  assert.deepEqual(out.b, { ok: true, answer: 'no', p: 0.2, expectation: null });
  assert.equal(out.c.ok, true); assert.equal(out.c.answer, null);
  assert.equal(out.d.expectation, 2.5);
  assert.equal(out.e.expectation, 3.5);                   // levels numbered from 1
  assert.deepEqual(out.f, { ok: false, answer: null, p: null, expectation: null, error: 'no answer' });
});

test('clefUsd prices each Clef model at its input rate, with no output charge', () => {
  const u = { billed_input_tokens: 400_000, image_tokens: 600_000, output_tokens: 1000 };
  assert.ok(Math.abs(clefUsd(u, 'clef') - 0.24) < 1e-9);
  assert.ok(Math.abs(clefUsd(u, 'clef-flash') - 0.038) < 1e-9);
  assert.ok(Math.abs(clefUsd(u, 'clef-omni') - 0.15) < 1e-9);
});

test('ClefClient.decide: one request per picture, a bad picture fails alone, usage split into text and image, metrics logged', async () => {
  await withEnv(CF_ENV, (proj) => withFetch(
    (c) => (c.body.state === 'broken' ? [400, { success: false, errors: [{ code: 5006, message: 'bad input' }] }] : ok({ q0: { type: 'noul', noul: 0.92 } })),
    async (calls) => {
      const client = new ClefClient({ root: proj, tag: 'test' });
      assert.equal(client.model, 'clef');
      const r = await client.decide([{ id: 'f1', content: { kind: 'image', media: png(960, 540) }, questions: yesno }, { id: 'f2', content: 'broken', questions: yesno }], { what: 'unit' });
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc-123/ai/run/@cf/cloudflare/clef');
      assert.equal(calls[0].headers.Authorization, 'Bearer tok-secret-9876');
      assert.equal(calls[0].body.images.length, 1);
      assert.deepEqual(r.rows[0], { id: 'f1', label: 'f1', answers: { q: { ok: true, answer: 'yes', p: 0.92, expectation: null } } });
      assert.equal(r.rows[1].answers.q.ok, false);
      assert.match(r.rows[1].answers.q.error, /HTTP 400/);
      assert.deepEqual(r.usage, { billed_input_tokens: 87, output_tokens: 1, image_tokens: 513, calls: 2 });
      assert.ok(Math.abs(r.usd - (600 * 0.24) / 1e6) < 1e-12);
      const log = fs.readFileSync(path.join(proj, 'clefcut', 'metrics', 'clef.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(log.length, 1); assert.equal(log[0].model, 'clef'); assert.equal(log[0].what, 'unit'); assert.equal(log[0].tag, 'test');
    }));
});

test('ClefClient.decide: a rejected key stops the run with the key message', async () => {
  await withEnv(CF_ENV, (proj) => withFetch(() => [401, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }], async () => {
    await assert.rejects(new ClefClient({ root: proj }).decide([{ id: 1, content: 'x', questions: yesno }, { id: 2, content: 'y', questions: yesno }]), /Cloudflare rejected the key/);
  }));
});

test('ClefClient.check: missing credentials or an unknown model give the fix', async () => {
  await withEnv('', async (proj) => assert.throws(() => new ClefClient({ root: proj }).check(), /No Cloudflare key.*CLOUDFLARE_API_TOKEN/));
  await withEnv(`${CF_ENV}CLEF_MODEL=gpt-4\n`, async (proj) => assert.throws(() => new ClefClient({ root: proj }).check(), /not a Clef model.*clef-flash/));
  await withEnv(`${CF_ENV}CLEF_MODEL=clef-flash\n`, async (proj) => {
    const client = new ClefClient({ root: proj });
    client.check();
    assert.equal(client.model, 'clef-flash');
  });
});

test('ClefClient.estimate: counted locally from the pictures, with no request', async () => {
  await withEnv(CF_ENV, (proj) => withFetch(() => [500, {}], async (calls) => {
    const e = new ClefClient({ root: proj }).estimate([{ content: { kind: 'image', media: png(960, 540) }, questions: yesno }]);
    assert.equal(calls.length, 0);
    assert.ok(e.lo > 513 && e.hi >= e.lo, JSON.stringify(e));
  }));
});

test('doctor: checks the Cloudflare key and the model with a test question, and masks them', async () => {
  await withEnv(CF_ENV, (proj) => withFetch(() => ok({ q: { type: 'noul', noul: 0.99 } }, 20), async (calls) => {
    const checks = await doctor.checks({ root: proj, config: loadConfig(proj) });
    const key = checks.find((c) => c.name === 'clef key'), model = checks.find((c) => c.name === 'clef model');
    assert.equal(key.status, 'pass'); assert.match(key.detail, /9876/);
    assert.equal(model.status, 'pass'); assert.match(model.detail, /@cf\/cloudflare\/clef/);
    assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(checks).includes('tok-secret'));
  }));
});

test('onboard status: the Cloudflare credentials are the key', async () => {
  const onboard = await import('../../src/commands/onboard.mjs');
  await withEnv(CF_ENV, async (proj) => assert.equal(onboard.status(proj, loadConfig(proj)).hasKey, true));
  await withEnv('', async (proj) => assert.equal(onboard.status(proj, loadConfig(proj)).hasKey, false));
});

test('ClefClient.estimate brackets what Clef billed in a live run (7 pictures, 24 questions: 3,084 text + 2,703 image tokens)', async () => {
  const YAML = (await import('yaml')).default;
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const sweep = JSON.parse(fs.readFileSync(path.join(root, 'assets/bank/sweep-default.json'), 'utf8'));
  const gate = Object.fromEntries(YAML.parse(fs.readFileSync(path.join(root, 'assets/bank/gate-default.yaml'), 'utf8')).questions.map((q) => [q.id, q]));
  const problems = Object.entries(sweep.problems).map(([id, instructions]) => ({ id, kind: 'yesno', instructions }));
  const legible = [{ id: 'legible_feed', kind: 'yesno', instructions: gate.legible_feed.instructions }];
  const hier = { id: 'hierarchy', kind: 'scale', instructions: gate.hierarchy.instructions, levels: gate.hierarchy.levels };
  const big = png(960, 540), feed = png(350, 197);
  const groups = [[big, [...problems, hier]], [big, problems], [big, [...problems, hier]], [big, problems], [big, problems], [feed, legible], [feed, legible]]
    .map(([media, questions]) => ({ content: { kind: 'image', media }, questions }));
  await withEnv(CF_ENV, async (proj) => {
    const e = new ClefClient({ root: proj }).estimate(groups), billed = 3084 + 2703;
    assert.ok(e.lo <= billed && billed <= e.hi, `estimate ${e.lo}-${e.hi}, billed ${billed}`);
  });
});

test('ask: when Clef returns no answers, the run is an error (exit 2), not a pass', async () => {
  const ask = await import('../../src/commands/ask.mjs');
  await withEnv(CF_ENV, (proj) => withFetch(() => [400, { success: false, errors: [{ message: 'bad input' }] }], async () => {
    const img = path.join(proj, 'a.png');
    fs.writeFileSync(img, encodePng(Buffer.alloc(64 * 48 * 3, 200), 64, 48, 3));
    const out = []; const log = console.log; console.log = (s) => out.push(String(s));
    let code;
    try { code = await ask.run(['--images', img, '--question', 'Is the sky green?', '--control', 'none', '--json'], { root: proj, config: loadConfig(proj) }); }
    finally { console.log = log; }
    assert.equal(code, 2);
    assert.equal(JSON.parse(out.find((s) => s.startsWith('{'))).errors, 1);
  }));
});

test('ClefClient.post: a request that hangs is cut off by the timeout, not waited on forever', async () => {
  await withEnv(CF_ENV, async (proj) => {
    const orig = globalThis.fetch;
    globalThis.fetch = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))); });
    const keepAlive = setInterval(() => {}, 1000);          // a real fetch holds a socket open; this mock holds nothing
    try {
      const t0 = Date.now();
      await assert.rejects(new ClefClient({ root: proj, timeoutMs: 50 }).post({ model: 'clef', state: 'x', questions: {} }, 1), /timed out/);
      assert.ok(Date.now() - t0 < 2000);
    } finally { globalThis.fetch = orig; clearInterval(keepAlive); }
  });
});

test('ClefClient: workers below 1 still run the requests', async () => {
  await withEnv(CF_ENV, (proj) => withFetch(() => ok({ q0: { type: 'noul', noul: 0.1 } }), async (calls) => {
    const r = await new ClefClient({ root: proj, workers: 0 }).decide([{ id: 1, content: 'x', questions: yesno }]);
    assert.equal(calls.length, 1); assert.equal(r.rows[0].answers.q.answer, 'no');
  }));
});

test('loadConfig: question_bank resolves against the project, not the current folder', async () => {
  await withEnv('', async (proj) => {
    fs.mkdirSync(path.join(proj, 'clefcut'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'clefcut', 'clefcut.yaml'), 'question_bank: clefcut/my-bank.yaml\n');
    assert.equal(loadConfig(proj).questionBankPath, path.join(proj, 'clefcut', 'my-bank.yaml'));
  });
});
