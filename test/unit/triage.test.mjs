import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeExplainer, splitFlags } from '../../src/sweep/runs.mjs';
import { runVerdict, judgeControl } from '../../src/sweep/controlled.mjs';
import { sampleFrames } from '../../src/commands/triage.mjs';
import { popValues, popRatio } from '../../src/sweep/measure.mjs';
import { loadConfig } from '../../src/core/config.mjs';

const schedule = {
  fps: 60, frames: 600,
  beats: [{ id: 'b', start: 0, end: 200, hold: [100, 150], elements: [{ id: 'h', in: 30, out: 190, text: 'Hi' }] }],
  transitions: [{ from: 'b', to: 'c', frames: [300, 330] }],
  cuts: [400], image_regions: [], static_holds: [],
};

test('explainer: element enter/exit, transition, cut, edge, no type', () => {
  const why = makeExplainer(schedule, { tolerance: 15, frames: 600 });
  assert.equal(why(60, 'cut'), 'element enter/exit');            // reveal 30 -> hold start 100
  assert.equal(why(170, 'cut'), 'element enter/exit');           // exit 150 -> 190
  assert.equal(why(310, 'glitch'), 'transition');
  assert.equal(why(401, 'overlap'), 'cut');
  assert.equal(why(0, 'glitch'), 'frame edge (first or last frames)');
  assert.equal(why(599, 'glitch'), 'frame edge (first or last frames)');
  assert.equal(why(500, 'legible'), 'no type on screen');
  assert.equal(why(500, 'cut'), null);                           // nothing explains it: residual
  assert.equal(why(120, 'cut'), null);                           // inside the hold, away from the edges
});

test('explainer: tolerance of 15 frames around in and out', () => {
  const why = makeExplainer(schedule, { tolerance: 15, frames: 600 });
  assert.ok(why(190 + 15, 'cut'));                                // out + 15
  assert.equal(why(190 + 16, 'cut'), null);
});

test('explainer: the brand designed list alone explains no glitch flag (the schedule must declare the frames)', () => {
  const why = makeExplainer(schedule, { frames: 600, designed: new Set(['glitch']) });
  assert.equal(why(500, 'glitch'), null);
  assert.equal(why(500, 'cut'), null);
});

test('explainer without a schedule explains only frame edges', () => {
  const why = makeExplainer(null, { frames: 100 });
  assert.equal(why(50, 'legible'), null);
  assert.equal(why(0, 'cut'), 'frame edge (first or last frames)');
});

test('splitFlags: counts explained, builds residual runs with a middle ask frame', () => {
  const why = makeExplainer(schedule, { tolerance: 15, frames: 600 });
  const { explained, residual } = splitFlags({ cut: [60, 500, 501, 502, 503, 504], glitch: [310] }, why, 3);
  assert.equal(explained['element enter/exit'], 1);
  assert.equal(explained.transition, 1);
  assert.equal(residual.length, 1);
  assert.deepEqual(residual[0].frames, [500, 504]);
  assert.equal(residual[0].ask_frame, 502);
});

test('sampleFrames: all frames up to three, else first, middle, last', () => {
  assert.deepEqual(sampleFrames({ list: [5] }), [5]);
  assert.deepEqual(sampleFrames({ list: [5, 6, 7] }), [5, 6, 7]);
  assert.deepEqual(sampleFrames({ list: [1, 2, 3, 4, 5, 6, 7] }), [1, 4, 7]);
});

const ok = { v0: { ok: true, clean_frame_flagged: false }, v1: { ok: true, clean_frame_flagged: false } };
const A = (variantId, answer, p) => ({ variantId, answer, p });

test('verdict: confirmed when at least half the valid answers flag it', () => {
  const v = runVerdict([A('v0', 'yes', 0.95), A('v1', 'yes', 0.9), A('v0', 'no', 0.1)], ok, 'yes', 0.8);
  assert.equal(v.label, 'confirmed');
});

test('verdict: cleared-by-clef needs two valid "no" answers and an ok control', () => {
  assert.equal(runVerdict([A('v0', 'no', 0.05), A('v1', 'no', 0.1)], ok, 'yes', 0.8).label, 'cleared-by-clef');
  assert.equal(runVerdict([A('v0', 'no', 0.05)], ok, 'yes', 0.8).label, 'to-measure');       // one answer is never proof
});

test('verdict: a failed control voids the "no" answers', () => {
  const failed = { v0: { ok: false, clean_frame_flagged: false }, v1: { ok: false, clean_frame_flagged: false } };
  const v = runVerdict([A('v0', 'no', 0.05), A('v1', 'no', 0.05)], failed, 'yes', 0.8);
  assert.equal(v.label, 'to-measure');
  assert.match(v.detail, /control failed/);
  assert.equal(v.voided, 2);
});

test('verdict: a "yes" still counts when only the positive control failed', () => {
  const failed = { v0: { ok: false, clean_frame_flagged: false } };
  assert.equal(runVerdict([A('v0', 'yes', 0.95), A('v0', 'yes', 0.9)], failed, 'yes', 0.8).label, 'confirmed');
});

test('verdict: a "yes" is void when the question flags the clean frame', () => {
  const noisy = { v0: { ok: true, clean_frame_flagged: true } };
  assert.equal(runVerdict([A('v0', 'yes', 0.99), A('v0', 'yes', 0.99)], noisy, 'yes', 0.8).label, 'to-measure');
});

test('verdict: a weak "yes" blocks clearing; mixed answers go to measurement', () => {
  assert.equal(runVerdict([A('v0', 'no', 0.1), A('v1', 'no', 0.1), A('v0', 'yes', 0.6)], ok, 'yes', 0.8).label, 'to-measure');
  assert.equal(runVerdict([A('v0', 'yes', 0.95), A('v1', 'no', 0.1), A('v0', 'no', 0.1), A('v1', 'no', 0.1)], ok, 'yes', 0.8).label, 'to-measure');
});

test('verdict: legibility polarity (bad = no)', () => {
  assert.equal(runVerdict([A('v0', 'no', 0.05), A('v1', 'no', 0.1)], ok, 'no', 0.8).label, 'confirmed');
  assert.equal(runVerdict([A('v0', 'yes', 0.95), A('v1', 'yes', 0.9)], ok, 'no', 0.8).label, 'cleared-by-clef');
});

test('judgeControl', () => {
  assert.equal(judgeControl({ answer: 'yes', p: 0.9 }, null, 'yes', 0.8).ok, true);
  assert.equal(judgeControl({ answer: 'yes', p: 0.6 }, null, 'yes', 0.8).ok, false);
  assert.equal(judgeControl({ answer: 'no', p: 0.1 }, null, 'yes', 0.8).ok, false);
  assert.equal(judgeControl({ answer: null, p: null }, null, 'yes', 0.8).ok, false);
  assert.equal(judgeControl({ answer: 'yes', p: 0.9 }, { answer: 'yes', p: 0.95 }, 'yes', 0.8).clean_frame_flagged, true);
});

test('popValues: a one-frame pop stands out from steady motion', () => {
  const w = 60; const h = 60; const mk = (v) => Buffer.alloc(w * h, v);
  const frames = [mk(10), mk(10), mk(10), mk(200), mk(10), mk(10)];
  const P = popValues(frames, w, h, 30);
  assert.equal(P.length, 4);
  assert.ok(P[2] > 50);                                   // frame 3 is the pop
  assert.ok(P[0] < 1);
  const ramp = [mk(10), mk(20), mk(30), mk(40), mk(50)];
  assert.ok(Math.max(...popValues(ramp, w, h, 30)) < 1);  // steady change has no pop
});

test('explainer: a designed glitch is explained only inside its declared effect frames, and only when the brand allows it', () => {
  const sched = { beats: [], transitions: [], cuts: [], effects: [{ kind: 'glitch', frames: [150, 156] }] };
  const allow = makeExplainer(sched, { designed: new Set(['glitch']) });
  assert.match(allow(152, 'glitch'), /designed/);
  assert.equal(allow(80, 'glitch'), null);                                            // the brand alone hides nothing
  assert.equal(makeExplainer(sched, { designed: new Set() })(152, 'glitch'), null);   // declared but not allowed by the brand, as in the gate
  assert.equal(allow(152, 'cut'), null);                                              // only the glitch question
});

test('explainer: transitions get the same tolerance as element edges', () => {
  const why = makeExplainer({ beats: [], transitions: [{ frames: [295, 299] }], cuts: [] }, { tolerance: 15 });
  assert.equal(why(310, 'cut'), 'transition');
  assert.equal(why(320, 'cut'), null);
});

test('popRatio: a run longer than 100 flags is left to measure, never cleared by a one-frame pop', async () => {
  const run = { list: Array.from({ length: 160 }, (_, i) => 100 + i), ask_frame: 180 };
  const m = await popRatio('/nonexistent.mp4', { root: '.', fps: 30, total: 400, run });
  assert.equal(m.ratio, null);
  assert.match(m.reason, /long/);
});

test('triage refuses a video that is not the one the sweep read', async () => {
  const triage = await import('../../src/commands/triage.mjs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-triage-'));
  fs.writeFileSync(path.join(d, 'other.mp4'), 'not the swept video');
  fs.writeFileSync(path.join(d, 'sweep.json'), JSON.stringify({ video: path.join(d, 'film.mp4'), video_sha256_12: 'aaaaaaaaaaaa', rows: [], pmin: 0.8, step: 1 }));
  await assert.rejects(triage.run([d, '--video', path.join(d, 'other.mp4')], { root: d, config: loadConfig(d) }), /not the video the sweep read/);
  fs.rmSync(d, { recursive: true, force: true });
});
