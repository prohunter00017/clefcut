import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBank, isProblem, badAnswer } from '../../src/sweep/bank.mjs';
import { flagRows, groupRuns, allRuns, typedFrames, onscreenFrames, frameStatus } from '../../src/sweep/runs.mjs';
import { runControlled, pool, poolSettled, zeroUsage } from '../../src/sweep/controlled.mjs';
import { parseRange } from '../../src/sweep/common.mjs';

const schedule = {
  fps: 30, frames: 300,
  beats: [{ id: 'a', start: 0, end: 100, hold: [40, 80], elements: [
    { id: 'h', in: 10, out: 100, text: 'Hello' }, { id: 'pic', in: 5, out: 100 }] }],
  transitions: [], cuts: [],
};

test('default bank has generic wording only', () => {
  const bank = loadBank({ root: process.cwd() });
  assert.deepEqual(Object.keys(bank.problems), ['cut', 'over', 'overlap', 'glitch']);
  const all = JSON.stringify(bank).toLowerCase();
  for (const w of ['statue', 'stone', 'stairs', 'screen', 'film', 'levan' + 'to', 'chris' + 'topher']) assert.ok(!all.includes(w), `bank must not mention "${w}"`);
  assert.ok(bank.legible.length > 10);
});

test('isProblem: p is the probability of yes', () => {
  assert.equal(isProblem('yes', 0.9, 'yes', 0.8), true);
  assert.equal(isProblem('yes', 0.7, 'yes', 0.8), false);
  assert.equal(isProblem('no', 0.1, 'no', 0.8), true);     // legible = no with 90 % confidence
  assert.equal(isProblem('no', 0.4, 'no', 0.8), false);
  assert.equal(isProblem(null, null, 'yes', 0.8), false);
  assert.equal(badAnswer('legible'), 'no');
  assert.equal(badAnswer('cut'), 'yes');
});

test('flagRows ignores errors and low confidence', () => {
  const rows = [
    { f: 1, q: 'cut', answer: 'yes', p: 0.95 }, { f: 2, q: 'cut', answer: 'yes', p: 0.5 },
    { f: 3, q: 'legible', answer: 'no', p: 0.05 }, { f: 4, q: 'cut', answer: 'yes', p: 1, error: 'x' },
    { f: 5, q: 'glitch', answer: null, p: null },
  ];
  assert.deepEqual(flagRows(rows, 0.8), { cut: [1], legible: [3] });
});

test('groupRuns joins frames with a gap of at most 3', () => {
  const runs = groupRuns('cut', [1, 2, 4, 20, 21], 3);
  assert.deepEqual(runs.map((r) => r.frames), [[1, 4], [20, 21]]);
  assert.deepEqual(runs.map((r) => r.n), [3, 2]);
  assert.deepEqual(groupRuns('cut', [], 3), []);
  const all = allRuns({ cut: [50], glitch: [10] }, 3);
  assert.deepEqual(all.map((r) => r.q), ['glitch', 'cut']);    // sorted by first frame
});

test('typedFrames: text elements inside the beat hold only', () => {
  const t = typedFrames(schedule);
  assert.equal(t.has(39), false);
  assert.equal(t.has(40), true);
  assert.equal(t.has(80), true);
  assert.equal(t.has(81), false);
  assert.equal(typedFrames(null).size, 0);
});

test('onscreenFrames: from in to out for text elements; no text means none', () => {
  const o = onscreenFrames(schedule);
  assert.equal(o.has(10), true); assert.equal(o.has(100), true); assert.equal(o.has(9), false);
  assert.equal(o.has(5), false);                        // the picture element has no text
});

function fakeClient(answerFor) {
  return {
    workers: 2,
    async decide(groups) {
      return {
        rows: groups.map((g) => ({ id: g.id, label: g.label, answers: Object.fromEntries(g.questions.map((q) => [q.id, answerFor(g, q)])) })),
        usage: { billed_input_tokens: 10 * groups.length, output_tokens: 1, image_tokens: 0, calls: 1 }, usd: 0.001, seconds: 0.1,
      };
    },
  };
}

test('runControlled: the control is asked once, next to the frames; ok when Clef finds the defect', async () => {
  const seen = [];
  const client = fakeClient((g) => { seen.push(g.id); return { answer: g.id === '__control_pos' ? 'yes' : 'no', p: g.id === '__control_pos' ? 0.95 : 0.05 }; });
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, label: `i${i}`, media: 'data:x' }));
  const r = await runControlled(client, { items, variants: [{ id: 'q', instructions: 'Is it cut?' }], control: { kind: 'cut', pos: 'data:p', neg: 'data:n' }, bad: 'yes', pmin: 0.8 });
  assert.equal(r.rows.length, 40);
  assert.equal(seen.filter((x) => x === '__control_pos').length, 1);
  assert.equal(seen.filter((x) => x === '__control_neg').length, 1);
  assert.equal(r.controls.q.ok, true);
  assert.equal(r.usage.calls, 1);
});

test('runControlled: a missed control marks the question not ok', async () => {
  const client = fakeClient(() => ({ answer: 'no', p: 0.1 }));
  const r = await runControlled(client, { items: [{ id: 'a', label: 'a', media: 'm' }], variants: [{ id: 'q', instructions: 'x' }], control: { kind: 'cut', pos: 'p' }, bad: 'yes', pmin: 0.8 });
  assert.equal(r.controls.q.ok, false);
  assert.match(r.controls.q.reason, /did not find/);
});

test('runControlled: no control means not verified', async () => {
  const client = fakeClient(() => ({ answer: 'no', p: 0.1 }));
  const r = await runControlled(client, { items: [{ id: 'a', label: 'a', media: 'm' }], variants: [{ id: 'q', instructions: 'x' }], control: null, bad: 'yes' });
  assert.equal(r.controls.q.ok, false);
});

test('pool keeps order and limits concurrency', async () => {
  let live = 0; let max = 0;
  const r = await pool([1, 2, 3, 4, 5, 6], 2, async (x) => { live++; max = Math.max(max, live); await new Promise((s) => setTimeout(s, 5)); live--; return x * 2; });
  assert.deepEqual(r, [2, 4, 6, 8, 10, 12]);
  assert.ok(max <= 2);
  assert.deepEqual(zeroUsage(), { billed_input_tokens: 0, output_tokens: 0, image_tokens: 0, calls: 0 });
});

test('parseRange: an inverted or empty range, or an unknown frame count, is an error', () => {
  assert.deepEqual(parseRange('10-20', 100), [10, 20]);
  assert.deepEqual(parseRange('90-200', 100), [90, 99]);
  assert.deepEqual(parseRange(null, 100), [0, 99]);
  assert.throws(() => parseRange('8-3', 100), /empty/);
  assert.throws(() => parseRange('120-130', 100), /past the end/);
  assert.throws(() => parseRange(null, NaN), /frame count/);
});

test('frameStatus: a frame is read only when every answer for it came back', () => {
  const rows = [
    { f: 1, q: 'cut', error: null }, { f: 1, q: 'legible', error: null },
    { f: 2, q: 'cut', error: 'HTTP 500' }, { f: 2, q: 'legible', error: null },
    { f: 3, q: 'cut', error: 'x' },
  ];
  const s = frameStatus(rows, [1, 2, 3, 4]);
  assert.deepEqual([...s.read], [1]);
  assert.deepEqual(s.failed, [2, 3, 4]);                // frame 4 has no answer at all
});

test('poolSettled: a failing item becomes an error entry; the others keep their order', async () => {
  const r = await poolSettled([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('boom'); return x * 10; });
  assert.deepEqual(r, [{ ok: true, value: 10 }, { ok: false, error: 'boom' }, { ok: true, value: 30 }]);
});

test('sweep: --pmin must be a probability between 0 and 1', async () => {
  const sweep = await import('../../src/commands/sweep.mjs');
  await assert.rejects(sweep.run(['/nonexistent.mp4', '--pmin', '80'], { root: '.', config: { workers: 1 } }), /--pmin/);
});
