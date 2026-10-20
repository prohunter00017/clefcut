// End to end: a small generated video through the whole gate (measurement only, no Clef, no OCR).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runGate, summaryText } from '../../src/gate/pipeline.mjs';
import { loadConfig } from '../../src/core/config.mjs';
import { locate } from '../../src/core/ffmpeg.mjs';

const tools = locate(process.cwd());
const make = (out, { moving = false, after = '' } = {}) => {
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xF4F0E5:s=320x180:r=30:d=3'];
  const chain = [];
  if (moving) { args.push('-f', 'lavfi', '-i', 'color=c=0x1438D4:s=40x40:r=30:d=3'); chain.push("[0][1]overlay=x='100+t*20':y=60"); }
  if (after) chain.push(after);
  if (chain.length) args.push('-filter_complex', chain.map((c, i) => (i === 0 && !moving ? `[0]${c}` : c)).join(','));
  args.push('-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '12', out);
  return spawnSync(tools.ffmpeg, args, { env: tools.env, encoding: 'utf8' });
};
const canMake = (() => {
  const p = path.join(os.tmpdir(), `sagecut-probe-${process.pid}.mp4`);
  const ok = make(p, { moving: true }).status === 0;
  fs.rmSync(p, { force: true });
  return ok;
})();

const BLACK = (frames) => `drawbox=x=0:y=0:w=320:h=180:color=black:t=fill:enable='${frames}'`;
const SCHEDULE = { film: 'test', fps: 30, frames: 90, width: 320, height: 180, safe_margin_px: 10,
  beats: [{ id: 'one', start: 0, end: 44, hold: [20, 44], elements: [{ id: 'box', in: 4, text: 'Box' }] }, { id: 'two', start: 45, end: 89, hold: [60, 89], elements: [{ id: 'box2', in: 50, text: 'Box' }] }],
  transitions: [{ from: 'one', to: 'two', frames: [44, 50] }] };

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-gate-'));
  fs.mkdirSync(path.join(root, 'sagecut'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sagecut', 'schedule.json'), JSON.stringify(SCHEDULE));
  return root;
}

test('gate finds a black frame, writes every output and exits as findings', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const root = project(), video = path.join(root, 'bad.mp4');
  assert.equal(make(video, { moving: true, after: BLACK('between(n,40,41)') }).status, 0);
  const out = path.join(root, 'run');
  const r = await runGate({ video, root, config: loadConfig(root), outDir: out, noClef: true, noOcr: true });
  assert.ok(r.findings.some((f) => f.check === 'black_frames' && f.frames[0] === 40 && f.frames[1] === 41), JSON.stringify(r.findings.map((f) => f.check)));
  assert.equal(r.clef.ran, false);
  for (const f of ['findings.json', 'summary.md', 'critic-frames/index.json', 'critic-frames/contact.png']) assert.ok(fs.existsSync(path.join(out, f)), f);
  const idx = JSON.parse(fs.readFileSync(path.join(out, 'critic-frames', 'index.json'), 'utf8'));
  assert.ok(idx.frames.length >= 3 && idx.frames.length <= 24);
  assert.ok(idx.frames.some((x) => x.reason.includes('black_frames')) && idx.frames.some((x) => x.reason.includes('settled')) && idx.frames.some((x) => x.reason.includes('transition')));
  for (const x of idx.frames) assert.ok(fs.existsSync(path.join(out, 'critic-frames', x.file)));
  const png = fs.readFileSync(path.join(out, 'critic-frames', 'contact.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const summary = fs.readFileSync(path.join(out, 'summary.md'), 'utf8');
  assert.match(summary, /black_frames f40-41/);
  assert.match(summary, /OCR checks off/);
  assert.match(summary, /Brand colour check skipped/);
  assert.ok(summary.split('\n').length <= 30);
  assert.ok(!/[A-Z0-9]{30,}/.test(summary));
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate: a clean video has no findings; brand motion.designed marks a flash as designed', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const root = project(), clean = path.join(root, 'clean.mp4'), flash = path.join(root, 'flash.mp4');
  assert.equal(make(clean, { moving: true }).status, 0);
  const r0 = await runGate({ video: clean, root, config: loadConfig(root), outDir: path.join(root, 'r0'), noClef: true, noOcr: true });
  assert.deepEqual(r0.findings.map((f) => f.check), [], JSON.stringify(r0.findings));
  assert.equal(r0.escalations.length, 0);
  assert.equal(make(flash, { moving: true, after: BLACK('eq(n,40)') }).status, 0);
  const plain = await runGate({ video: flash, root, config: loadConfig(root), outDir: path.join(root, 'r1'), noClef: true, noOcr: true });
  assert.ok(plain.findings.some((f) => f.check === 'black_frames'));
  fs.writeFileSync(path.join(root, 'sagecut', 'brand.yaml'), 'name: t\ncolors: { background: "#F4F0E5", text: "#0B1233", primary: "#1438D4" }\nfonts: { heading: { family: Geist } }\nmotion: { style: energetic, designed: [flash] }\n');
  const undeclared = await runGate({ video: flash, root, config: loadConfig(root), outDir: path.join(root, 'r2a'), noClef: true, noOcr: true });
  assert.ok(undeclared.findings.some((f) => f.check === 'black_frames'));     // brand alone suppresses nothing
  assert.ok(undeclared.notes.some((n) => /brand allows flash; declare its frames in schedule effects/.test(n)));
  assert.match(summaryText(undeclared, null), /brand allows flash; declare its frames/);
  fs.writeFileSync(path.join(root, 'sagecut', 'schedule.json'), JSON.stringify({ ...SCHEDULE, effects: [{ kind: 'flash', frames: [39, 42] }] }));
  const designed = await runGate({ video: flash, root, config: loadConfig(root), outDir: path.join(root, 'r2'), noClef: true, noOcr: true });
  assert.ok(!designed.findings.some((f) => f.check === 'black_frames'));
  assert.ok(designed.designed.some((f) => f.check === 'black_frames' && f.designed_effect === 'flash'));
  assert.match(summaryText(designed, null), /Marked as designed, not defects/);
  assert.ok(!designed.skipped.some((s) => s.startsWith('Brand colour')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate fails with a fix when the schedule or the video is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-gate-'));
  await assert.rejects(runGate({ video: path.join(root, 'none.mp4'), root, config: loadConfig(root), outDir: path.join(root, 'o'), noClef: true }), /Video not found/);
  fs.writeFileSync(path.join(root, 'v.mp4'), 'x');
  await assert.rejects(runGate({ video: path.join(root, 'v.mp4'), root, config: loadConfig(root), outDir: path.join(root, 'o'), noClef: true }), /No schedule at .*sagecut init/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the command: exit 1 on findings, --json output, --out folder, and the key is never written', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const gate = await import('../../src/commands/gate.mjs');
  const root = project(), video = path.join(root, 'bad.mp4'), out = path.join(root, 'cmd-out');
  assert.equal(make(video, { moving: true, after: BLACK('between(n,40,41)') }).status, 0);
  const secret = 'sk-test-secret-0123456789';
  const prev = process.env.CLOUDFLARE_API_TOKEN; process.env.CLOUDFLARE_API_TOKEN = secret;
  const chunks = []; const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  let code;
  try { code = await gate.run([video, '--json', '--no-clef', '--no-ocr', '--out', out], { root, config: loadConfig(root) }); }
  finally { process.stdout.write = write; if (prev === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = prev; }
  assert.equal(code, 1);
  const j = JSON.parse(chunks.find((c) => c.startsWith('{') && c.includes('"exit"')));
  assert.equal(j.exit, 1); assert.equal(j.out, out); assert.ok(j.counts.findings >= 1 && j.critic_frames.length >= 3);
  assert.ok(j.findings.some((f) => f.check === 'black_frames'));
  for (const f of fs.readdirSync(out, { recursive: true })) {
    const full = path.join(out, f);
    if (fs.statSync(full).isFile() && /\.(json|md)$/.test(f)) assert.ok(!fs.readFileSync(full, 'utf8').includes(secret), f);
  }
  assert.equal(await gate.run([], { root, config: loadConfig(root) }), 2);                                  // no video: usage error
  assert.equal(await gate.run([path.join(root, 'nope.mp4'), '--no-clef'], { root, config: loadConfig(root) }), 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate: the Clef round asks every prepared picture, and the run records the Clef model for pricing', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const root = project(), video = path.join(root, 'clean.mp4');
  assert.equal(make(video, { moving: true }).status, 0);
  fs.writeFileSync(path.join(root, '.env'), 'CLOUDFLARE_ACCOUNT_ID=acc-1\nCLOUDFLARE_API_TOKEN=tok-1\n');
  const keys = ['SAGECUT_HOME', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLEF_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.SAGECUT_HOME = path.join(root, 'home');
  const orig = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    const b = JSON.parse(init.body);
    const answers = Object.fromEntries(Object.entries(b.questions).map(([id, q]) => [id, q.type === 'score' ? { type: 'score', score: 3.8 } : { type: 'noul', noul: 0.03 }]));
    return new Response(JSON.stringify({ result: { model: b.model, answers, usage: { input_tokens: 700, output_tokens: 1 } }, success: true }), { status: 200 });
  };
  try {
    const r = await runGate({ video, root, config: loadConfig(root), outDir: path.join(root, 'r'), noOcr: true });
    assert.equal(r.clef.ran, true);
    assert.ok(calls > 0 && r.clef.calls === calls, `${calls} requests, ${r.clef.calls} calls`);
    assert.equal(r.clef.model, 'clef');
    assert.equal(r.clef.usd, Math.round(((calls * 700 * 0.24) / 1e6) * 1e6) / 1e6);
    assert.deepEqual(r.clef_errors, []);
  } finally {
    globalThis.fetch = orig;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sweep: a frame whose problem questions failed is NOT read, even when its legibility answer came back (exit 2)', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const sweep = await import('../../src/commands/sweep.mjs');
  const root = project(), video = path.join(root, 'v.mp4');
  assert.equal(make(video, { moving: true }).status, 0);
  fs.writeFileSync(path.join(root, '.env'), 'CLOUDFLARE_ACCOUNT_ID=acc-1\nCLOUDFLARE_API_TOKEN=tok-1\n');
  const keys = ['SAGECUT_HOME', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLEF_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.SAGECUT_HOME = path.join(root, 'home');
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body), ids = Object.keys(b.questions);
    if (ids.length > 1) return new Response(JSON.stringify({ success: false, errors: [{ message: 'bad input' }] }), { status: 400 });
    return new Response(JSON.stringify({ result: { answers: { q0: { type: 'noul', noul: 0.95 } }, usage: { input_tokens: 100, output_tokens: 1 } } }), { status: 200 });
  };
  const out = path.join(root, 'sw');
  let code;
  try { code = await sweep.run([video, '--range', '20-24', '--out', out, '--json'], { root, config: loadConfig(root) }); }
  finally {
    globalThis.fetch = orig;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  const r = JSON.parse(fs.readFileSync(path.join(out, 'sweep.json'), 'utf8'));
  assert.equal(code, 2);
  assert.equal(r.frames_read, 0);
  assert.deepEqual(r.failed_frames, [20, 21, 22, 23, 24]);
  fs.rmSync(root, { recursive: true, force: true });
});

// Clef mocked: every yes/no "no" (p 0.03), every scale 3.8, or every request refused.
async function withClef(root, mode, fn) {
  fs.writeFileSync(path.join(root, '.env'), 'CLOUDFLARE_ACCOUNT_ID=acc-1\nCLOUDFLARE_API_TOKEN=tok-1\n');
  const keys = ['SAGECUT_HOME', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLEF_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.SAGECUT_HOME = path.join(root, 'home');
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (mode === 'refuse') return new Response(JSON.stringify({ success: false, errors: [{ message: 'bad input' }] }), { status: 400 });
    const b = JSON.parse(init.body);
    const answers = Object.fromEntries(Object.entries(b.questions).map(([id, q]) => [id, q.type === 'score' ? { type: 'score', score: 3.8 } : { type: 'noul', noul: 0.03 }]));
    return new Response(JSON.stringify({ result: { answers, usage: { input_tokens: 700, output_tokens: 1 } } }), { status: 200 });
  };
  try { return await fn(); } finally {
    globalThis.fetch = orig;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('gate: a render shorter than its schedule is a finding, and beats or transitions past the end do not crash it', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const root = project(), video = path.join(root, 'short.mp4');
  assert.equal(make(video, { moving: true }).status, 0);                                  // 90 frames
  const long = { ...SCHEDULE, frames: 240,
    beats: [...SCHEDULE.beats, { id: 'three', start: 90, end: 239, hold: [120, 239], elements: [{ id: 'box3', in: 95, text: 'Box' }] }],
    transitions: [...SCHEDULE.transitions, { from: 'two', to: 'three', frames: [100, 105] }] };
  fs.writeFileSync(path.join(root, 'sagecut', 'schedule.json'), JSON.stringify(long));
  const r = await withClef(root, 'answer', () => runGate({ video, root, config: loadConfig(root), outDir: path.join(root, 'r'), noOcr: true }));
  const fc = r.findings.find((f) => f.check === 'frame_count');
  assert.ok(fc, JSON.stringify(r.findings.map((f) => f.check)));
  assert.match(fc.evidence, /90 frames.*240/);
  assert.ok(!r.findings.concat(r.escalations).some((f) => f.beat === 'three' && f.check !== 'frame_count'), 'nothing is judged on a beat the video does not have');
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate: a 4-frame video does not crash', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const root = project(), video = path.join(root, 'tiny.mp4');
  const p = spawnSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xF4F0E5:s=320x180:r=30', '-frames:v', '4', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', video], { env: tools.env });
  assert.equal(p.status, 0);
  fs.writeFileSync(path.join(root, 'sagecut', 'schedule.json'), JSON.stringify({ film: 't', fps: 30, frames: 4, width: 320, height: 180, safe_margin_px: 10, beats: [{ id: 'a', start: 0, end: 3, elements: [] }], transitions: [] }));
  const r = await runGate({ video, root, config: loadConfig(root), outDir: path.join(root, 'r'), noClef: true, noOcr: true });
  assert.equal(r.video_info.frames, 4);
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate: two off-palette colours on one frame are two findings with their own id and picture', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const root = project(), video = path.join(root, 'colours.mp4');
  const p = spawnSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xF4F0E5:s=320x180:r=30:d=3',
    '-vf', 'drawbox=x=20:y=20:w=90:h=70:color=0xD01010:t=fill,drawbox=x=200:y=90:w=90:h=70:color=0x10A040:t=fill', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '8', video], { env: tools.env });
  assert.equal(p.status, 0, p.stderr && p.stderr.toString());
  fs.writeFileSync(path.join(root, 'sagecut', 'brand.yaml'), 'name: t\ncolors: { background: "#F4F0E5", text: "#0B1233", primary: "#1438D4" }\nfonts: { heading: { family: Geist } }\n');
  const r = await runGate({ video, root, config: loadConfig(root), outDir: path.join(root, 'r'), noClef: true, noOcr: true });
  const rows = r.findings.filter((f) => f.check === 'brand_colour');
  assert.equal(rows.length, 2, JSON.stringify(r.findings.map((f) => f.check)));
  assert.equal(new Set(rows.map((x) => x.id)).size, 2);
  assert.equal(new Set(rows.map((x) => x.image)).size, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate --json: when every Clef answer fails, the JSON has the errors and notes, stderr says why, exit 2', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const gate = await import('../../src/commands/gate.mjs');
  const root = project(), video = path.join(root, 'v.mp4'), out = path.join(root, 'o');
  assert.equal(make(video, { moving: true }).status, 0);
  const chunks = [], errs = []; const write = process.stdout.write.bind(process.stdout), err = console.error;
  let code;
  await withClef(root, 'refuse', async () => {
    process.stdout.write = (c) => { chunks.push(String(c)); return true; }; console.error = (...a) => errs.push(a.join(' '));
    try { code = await gate.run([video, '--json', '--no-ocr', '--out', out], { root, config: loadConfig(root) }); }
    finally { process.stdout.write = write; console.error = err; }
  });
  assert.equal(code, 2);
  const j = JSON.parse(chunks.find((c) => c.startsWith('{') && c.includes('"exit"')));
  assert.ok(j.clef_errors.length > 0 && j.clef_errors.length === j.clef_asked, JSON.stringify({ e: j.clef_errors && j.clef_errors.length, a: j.clef_asked }));
  assert.ok(Array.isArray(j.notes));
  assert.match(errs.join('\n'), /Clef returned no answer.*HTTP 400/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('probe: a video with 90° display rotation reports the rotated size, as ffmpeg decodes it', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const { probe } = await import('../../src/core/ffmpeg.mjs');
  const root = project(), src = path.join(root, 'src.mp4'), rot = path.join(root, 'rot.mp4');
  spawnSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', src], { env: tools.env });
  const p = spawnSync(tools.ffmpeg, ['-v', 'error', '-y', '-display_rotation', '90', '-i', src, '-c', 'copy', rot], { env: tools.env });
  if (p.status !== 0) { fs.rmSync(root, { recursive: true, force: true }); return; }          // this ffmpeg cannot write rotation
  const i = await probe(rot, { root });
  assert.deepEqual([i.width, i.height], [180, 320]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('frames(): a missing ffmpeg is a clear error, not an uncaught crash', async () => {
  const { frames } = await import('../../src/core/ffmpeg.mjs');
  const saved = { a: process.env.SAGECUT_FFMPEG, b: process.env.SAGECUT_FFPROBE };
  process.env.SAGECUT_FFMPEG = '/nonexistent/ffmpeg'; process.env.SAGECUT_FFPROBE = '/nonexistent/ffprobe';
  try {
    await assert.rejects((async () => { for await (const f of frames('/x.mp4', { width: 8, height: 8, root: fs.mkdtempSync(path.join(os.tmpdir(), 'sc-ff-')) })) void f; })(), /could not start/);
  } finally {
    for (const [k, v] of [['SAGECUT_FFMPEG', saved.a], ['SAGECUT_FFPROBE', saved.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
