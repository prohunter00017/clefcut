import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandRuns, computeNumbers, renderCard, fmtUsd, fmtSeconds, openedImages, ESTIMATE_METHOD, HOUSE_METHOD } from '../../src/commands/numbers.mjs';
import { HOUSE_REVIEW } from '../../src/core/costs.mjs';
import { clefUsd } from '../../src/core/clef.mjs';

const sweep = { video_sha256_12: 'aaaaaaaaaaaa', frames_read: 600, usd: 0.011186, seconds: 187 };
const triage = { usd: 0.000072, seconds: 12, residual_runs: 2, counts: { 'cleared-by-clef': 1, confirmed: 1, 'to-measure': 0, 'cleared-by-measurement': 0 } };
const baseline = { id: 'abcd1234', video_sha256_12: 'aaaaaaaaaaaa', frames_reviewed: 10, usd_per_frame: 0.2, seconds_per_frame: 12.5 };

test('computeNumbers: measured part sums the runs; estimate is per-frame baseline x frames read', () => {
  const n = computeNumbers({ sweeps: [sweep], triages: [triage], opened: ['a', 'b', 'a'], baseline, model: 'clef' });
  assert.equal(n.clefcut.frames_read, 600);
  assert.equal(n.clefcut.clef_usd, 0.011258);
  assert.equal(n.clefcut.qa_seconds, 199);
  assert.equal(n.clefcut.frames_opened_by_claude, 2);        // distinct
  assert.equal(n.clefcut.critics_usd, null);
  assert.equal(n.old_review_estimate.usd, 120);
  assert.equal(n.old_review_estimate.seconds, 7500);
  assert.equal(n.old_review_estimate.estimate, true);
  assert.equal(n.old_review_estimate.method, ESTIMATE_METHOD(10));
  assert.deepEqual(n.problems, []);
});

test('the method line is exact', () => {
  assert.equal(ESTIMATE_METHOD(10), 'estimate from 10 measured frames, Claude API list prices');
});

test('no baseline: the old review is estimated at the reference build rate, and says so', () => {
  const n = computeNumbers({ sweeps: [sweep], model: 'clef' });
  const e = n.old_review_estimate;
  assert.equal(e.reference, 'house');
  assert.equal(e.estimate, true);
  assert.equal(e.usd, Number((HOUSE_REVIEW.usd_per_frame * 600).toFixed(2)));    // 600 x $0.101 = $60.60
  assert.equal(e.seconds, Math.round(HOUSE_REVIEW.seconds_per_frame * 600));     // 600 x 8.6 s
  assert.equal(e.method, HOUSE_METHOD);
  assert.match(HOUSE_METHOD, /another film, not a measurement of this video/);
  assert.match(HOUSE_METHOD, /list prices/);
  assert.equal(n.baseline_note, null);
  assert.match(renderCard(n, []), /the reference build's rate/);
});

test('the reference rate is the measured one: $101.96 / 1,009 frames, 2.41 h / 1,009 frames', () => {
  assert.equal(HOUSE_REVIEW.usd_per_frame, Number((HOUSE_REVIEW.usd / HOUSE_REVIEW.frames_viewed).toFixed(3)));
  assert.equal(HOUSE_REVIEW.seconds_per_frame, Number((HOUSE_REVIEW.clock_hours * 3600 / HOUSE_REVIEW.frames_viewed).toFixed(1)));
});

test('no sweep: no comparison', () => {
  const n = computeNumbers({ gates: [{ video_sha256_12: 'aaaaaaaaaaaa', billed_input_tokens: 100, image_tokens: 500, output_tokens: 0, seconds: 30 }] });
  assert.equal(n.old_review_estimate, null);
  assert.match(n.baseline_note, /no sweep/);
});

test('Clef cost: image tokens are charged at the input rate', () => {
  // one 960x540 frame with 4 questions: 434 text + 513 image tokens
  assert.equal(clefUsd({ billed_input_tokens: 434, image_tokens: 513, output_tokens: 1 }, 'clef'), 947 * 0.24 / 1e6);
  assert.equal(clefUsd({ billed_input_tokens: 434, output_tokens: 0 }, 'clef'), 434 * 0.24 / 1e6);
});

test('a run file with usage is priced from its tokens, not from a stored text-only usd', () => {
  const old = { ...sweep, usd: 0.0001, usage: { billed_input_tokens: 1000, image_tokens: 2000, output_tokens: 0 }, model: 'clef' };
  const n = computeNumbers({ sweeps: [old] });
  assert.equal(n.clefcut.clef_usd, Number((3000 * 0.24 / 1e6).toFixed(6)));
});

test('a baseline with no list price gives no comparison', () => {
  const n = computeNumbers({ sweeps: [sweep], baseline: { ...baseline, usd_per_frame: null, price_unknown: ['claude-fable-5-1'] } });
  assert.equal(n.old_review_estimate, null);
  assert.match(n.baseline_note, /no list price/);
});

test('runs from two different videos are refused; a baseline of another video gives no comparison', () => {
  const n = computeNumbers({ sweeps: [sweep, { ...sweep, video_sha256_12: 'bbbbbbbbbbbb' }] });
  assert.equal(n.problems.length, 1);
  assert.match(n.problems[0], /different videos/);
  const m = computeNumbers({ sweeps: [sweep], baseline: { ...baseline, video_sha256_12: 'cccccccccccc' } });
  assert.equal(m.old_review_estimate, null);
  assert.equal(m.problems.length, 1);
});

test('gate findings: Clef cost from billed tokens at the model rate', () => {
  const n = computeNumbers({ sweeps: [sweep], gates: [{ billed_input_tokens: 1_000_000, output_tokens: 0, seconds: 5, video_sha256_12: 'aaaaaaaaaaaa' }], model: 'clef-flash' });
  assert.equal(n.clefcut.clef_usd_parts.gate, 0.038);
  assert.equal(n.clefcut.qa_seconds, 192);
});

test('critics from the session files: USD, tokens, image views and distinct images are two numbers', () => {
  const critics = { usd: 1.5, price_unknown: [], tokens: { input: 1 }, agents: 2, image_views: 30, distinct_images: 12 };
  const n = computeNumbers({ sweeps: [sweep], critics });
  assert.equal(n.clefcut.critics_usd, 1.5);
  const card = renderCard(n, []);
  assert.match(card, /image views: 30 \(12 different images\)/);
  assert.match(card, /Critics' cost: \$1\.50 at Claude API list prices/);
});

test('card: every number is in the data; estimates are marked; method line present', () => {
  const n = computeNumbers({ sweeps: [sweep], triages: [triage], baseline });
  const card = renderCard(n, ['sweep.json']);
  assert.match(card, /Frames Clef read: 600/);
  assert.match(card, /QA time: 3 min 19 s/);
  assert.match(card, /Clef cost: \$0\.0113 \(clef model rate\)/);
  assert.match(card, /Time: 125 min 0 s \(estimate\)/);
  assert.match(card, /Cost: \$120\.00 \(estimate\)/);
  assert.ok(card.includes('estimate from 10 measured frames, Claude API list prices'));
  assert.match(card, /Open items after triage/);
});

test('formatting', () => {
  assert.equal(fmtUsd(0.5), '$0.5000'); assert.equal(fmtUsd(12), '$12.00'); assert.equal(fmtUsd(null), 'not measured');
  assert.equal(fmtSeconds(45), '45 s'); assert.equal(fmtSeconds(125), '2 min 5 s'); assert.equal(fmtSeconds(undefined), 'not measured');
});

test('openedImages reads the known opened.json shapes', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-open-'));
  const w = (n, o) => { const f = path.join(d, n); fs.writeFileSync(f, JSON.stringify(o)); return f; };
  assert.deepEqual(openedImages(w('a.json', { images: ['x', 'y'] })), ['x', 'y']);
  assert.deepEqual(openedImages(w('b.json', { opened_by_opus: ['z'] })), ['z']);
  assert.deepEqual(openedImages(w('c.json', ['p', { path: 'q' }, { sha256: 'r' }])), ['p', 'q', 'r']);
  assert.deepEqual(openedImages(w('d.json', {})), []);
  fs.rmSync(d, { recursive: true, force: true });
});

test('expandRuns: repeated and multi-folder forms', () => {
  assert.deepEqual(expandRuns(['--runs', 'A', '--runs', 'B']), ['--runs', 'A', '--runs', 'B']);
  assert.deepEqual(expandRuns(['--runs', 'A', 'B', 'C', '--critics-marker', 'M']), ['--runs', 'A', '--runs', 'B', '--runs', 'C', '--critics-marker', 'M']);
});

test('openedImages: new shape counts distinct frame values', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-open2-'));
  const f = path.join(d, 'o.json');
  fs.writeFileSync(f, JSON.stringify({ images: [{ frame: 10, reason: 'x' }, { frame: 10 }, { frame: 20 }] }));
  const n = computeNumbers({ sweeps: [], opened: openedImages(f) });
  assert.equal(n.clefcut.frames_opened_by_claude, 2);
  fs.rmSync(d, { recursive: true, force: true });
});

test('with no opened.json the card says "not recorded", not 0', () => {
  const none = computeNumbers({ sweeps: [sweep], triages: [triage], opened: [], openedRecorded: false, baseline, model: 'clef' });
  assert.equal(none.clefcut.frames_opened_by_claude, null);
  assert.match(renderCard(none, []), /Frames recorded as opened by Claude: not recorded \(no opened\.json in the run\)/);
  const some = computeNumbers({ sweeps: [sweep], triages: [triage], opened: ['a', 'b'], openedRecorded: true, baseline, model: 'clef' });
  assert.equal(some.clefcut.frames_opened_by_claude, 2);
  assert.match(renderCard(some, []), /Frames recorded as opened by Claude \(from opened\.json\): 2/);
});

test('the card lists the time for each step, and the critics time is in the savings', () => {
  const crit = { usd: 0.36, tokens: {}, agents: 3, image_views: 22, distinct_images: 11, price_unknown: [], seconds: 300 };
  const n = computeNumbers({ sweeps: [sweep], triages: [triage], opened: ['a'], openedRecorded: true, critics: crit, baseline, model: 'clef' });
  assert.equal(n.time_by_step.critics_seconds, 300);
  assert.equal(n.time_by_step.render_seconds, null);
  assert.equal(n.clefcut.qa_seconds, 199);
  const card = renderCard(n, []);
  assert.match(card, /## Time by step/);
  assert.match(card, /- Render: not measured by ClefCut/);
  assert.match(card, /- Critics: 5 min 0 s/);
  assert.match(card, /- Baseline: not measured/);
});

test('numbers: a gate run is priced at the Clef model it records, not at the default model', async () => {
  const { run } = await import('../../src/commands/numbers.mjs');
  const { loadConfig } = await import('../../src/core/config.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-numbers-clef-')), dir = path.join(root, 'clefcut', 'qa', 'gate-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify({ video: path.join(root, 'v.mp4'), video_sha256_12: 'aaaaaaaaaaaa', seconds: 5, clef_asked: 1, clef_errors: [],
    clef: { ran: true, calls: 1, billed_input_tokens: 1_000_000, image_tokens: 0, output_tokens: 0, usd: 0.038, model: 'clef-flash' } }));
  const home = process.env.CLEFCUT_HOME; process.env.CLEFCUT_HOME = path.join(root, 'home');
  const out = []; const log = console.log; console.log = (s) => out.push(String(s));
  try { await run(['--runs', dir, '--json'], { root, config: loadConfig(root) }); }
  finally { console.log = log; if (home === undefined) delete process.env.CLEFCUT_HOME; else process.env.CLEFCUT_HOME = home; }
  const n = JSON.parse(out.find((s) => s.startsWith('{')));
  assert.equal(n.clefcut.clef_usd_parts.gate, 0.038);
  fs.rmSync(root, { recursive: true, force: true });
});

test('frames read: the union of the sweeps, not the largest one', () => {
  const a = { video_sha256_12: 'aaaaaaaaaaaa', range: [0, 599], step: 1, frames_read: 560, failed_frames: Array.from({ length: 40 }, (_, i) => 10 + i), usd: 0, seconds: 1 };
  const b = { video_sha256_12: 'aaaaaaaaaaaa', range: [10, 49], step: 1, frames_read: 40, failed_frames: [], usd: 0, seconds: 1 };
  assert.equal(computeNumbers({ sweeps: [a, b] }).clefcut.frames_read, 600);           // the re-run that sweep's warning asks for
  const h1 = { ...b, range: [0, 299], frames_read: 300 }, h2 = { ...b, range: [300, 599], frames_read: 300 };
  assert.equal(computeNumbers({ sweeps: [h1, h2] }).clefcut.frames_read, 600);
  assert.equal(computeNumbers({ sweeps: [{ ...b, range: [0, 598], step: 2, frames_read: 300 }] }).clefcut.frames_read, 300);
  assert.equal(computeNumbers({ sweeps: [sweep] }).clefcut.frames_read, 600);           // a run file without a range keeps its count
});

test('numbers: the same run folder twice counts once, and the ledger row names the swept video', async () => {
  const { run } = await import('../../src/commands/numbers.mjs');
  const { loadConfig } = await import('../../src/core/config.mjs');
  const { readRows } = await import('../../src/core/savings.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-numbers-dup-')), dir = path.join(root, 'qa-run');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sweep.json'), JSON.stringify({ video: path.join(root, 'film.mp4'), video_sha256_12: 'bbbbbbbbbbbb', range: [0, 99], step: 1,
    frames_read: 100, failed_frames: [], usage: { billed_input_tokens: 1000, image_tokens: 0, output_tokens: 0 }, model: 'clef', usd: 0.00024, seconds: 10, rows: [] }));
  const home = process.env.CLEFCUT_HOME; process.env.CLEFCUT_HOME = path.join(root, 'home');
  const out = []; const log = console.log; console.log = (s) => out.push(String(s));
  try { await run(['--runs', dir, '--runs', dir, '--json'], { root, config: loadConfig(root) }); }
  finally { console.log = log; }
  try {
    const n = JSON.parse(out.find((s) => s.startsWith('{')));
    assert.equal(n.clefcut.clef_usd, 0.00024);
    assert.equal(n.clefcut.qa_seconds, 10);
    assert.equal(readRows(path.join(root, 'home', 'savings.jsonl'))[0].video, 'film.mp4');
  } finally {
    if (home === undefined) delete process.env.CLEFCUT_HOME; else process.env.CLEFCUT_HOME = home;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fmtSeconds never prints 60 s or 120 s', () => {
  assert.equal(fmtSeconds(179.6), '3 min 0 s');
  assert.equal(fmtSeconds(119.7), '2 min 0 s');
  assert.equal(fmtSeconds(119.4), '119 s');
});
