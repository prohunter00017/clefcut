// clefcut sweep <video> [--out DIR] [--workers N] [--step N] [--range A-B] [--pmin P] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as ff from '../core/ffmpeg.mjs';
import { ClefClient } from '../core/clef.mjs';
import { newRunDir, ensureDir } from '../core/paths.mjs';
import { writeJson, say, warn, setQuiet } from '../core/log.mjs';
import { loadBank } from '../sweep/bank.mjs';
import { flagRows, allRuns, typedFrames, frameStatus } from '../sweep/runs.mjs';
import { poolSettled, zeroUsage } from '../sweep/controlled.mjs';
import { loadContext, num, parseRange } from '../sweep/common.mjs';
import { fileSha12 } from '../sweep/images.mjs';

export const help = 'Clef reads every frame of a video (problem questions; legibility inside text windows).';

const BIG_WIDTH = 960;

export async function run(argv, { root, config }) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    root: { type: 'string' }, out: { type: 'string' }, workers: { type: 'string' }, step: { type: 'string' }, range: { type: 'string' },
    pmin: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help || !positionals.length) {
    console.log('usage: clefcut sweep <video> [--out DIR] [--workers N] [--step N] [--range A-B] [--pmin P] [--json]\n\n' +
      'Clef reads every frame at 960 px with the problem questions. Inside text windows it also asks the legibility question\n' +
      'at the test width. Writes sweep.json and summary.md in the output folder.');
    return values.help ? 0 : 2;
  }
  if (values.pmin !== undefined && !(Number(values.pmin) > 0 && Number(values.pmin) <= 1)) throw new Error(`--pmin is a probability between 0 and 1 (got "${values.pmin}")`);
  if (values.json) setQuiet(true);
  const { res, runs, md, out, failed } = await runSweep({ video: positionals[0], out: values.out, workers: values.workers, step: values.step, range: values.range, pmin: values.pmin, root, config });
  if (values.json) console.log(JSON.stringify({ ...res, rows: undefined, out }));
  else { say(md); say(`written: ${path.relative(root, out) || out}`); }
  if (failed.length) { warn(`clefcut: ${failed.length} frames were NOT read (Clef errors after retries). Run them again with --range, then use frames_read.`); return 2; }
  return runs.length ? 1 : 0;
}

// The sweep itself: reads the frames, writes sweep.json and summary.md in `out`, returns the result. run() and review use it.
export async function runSweep({ video: videoArg, out: outArg, workers: workersArg, step: stepArg, range, pmin: pminArg, root, config }) {
  if (pminArg !== undefined && !(Number(pminArg) > 0 && Number(pminArg) <= 1)) throw new Error(`--pmin is a probability between 0 and 1 (got "${pminArg}")`);
  const video = path.resolve(videoArg);
  if (!fs.existsSync(video)) throw new Error(`video not found: ${video}`);
  const info = await ff.probe(video, { root });
  const ctx = loadContext(config);
  const bank = loadBank(config);
  const pmin = num(pminArg, bank.pmin ?? 0.8);
  const step = Math.max(1, Math.round(num(stepArg, 1)));
  const workers = Math.max(1, Math.round(num(workersArg, config.workers || 4)));
  const [f0, f1] = parseRange(range, info.frames);
  const typed = typedFrames(ctx.schedule);
  const client = new ClefClient({ root, workers, tag: 'sweep' });
  client.check();                                                     // fails early, with a fix, when there is no key
  const out = ensureDir(outArg ? path.resolve(outArg) : newRunDir(root, 'sweep'));

  const list = [];
  for (let f = f0; f <= f1; f += step) list.push(f);
  const batchFrames = workers * 10;
  const batches = [];
  for (let i = 0; i < list.length; i += batchFrames) batches.push(list.slice(i, i + batchFrames));

  const jpg = (f, width) => ff.still(video, f, { root, fps: info.fps, width, format: 'jpg' });
  const lost = [];                                                    // frames ffmpeg could not extract: { f, error }
  const prepare = async (frames) => {
    const groups = [];
    const made = await poolSettled(frames, workers * 2, async (f) => {
      const big = await jpg(f, BIG_WIDTH);
      const feed = typed.has(f) ? await jpg(f, ctx.testWidth) : null;
      return { f, big, feed };
    });
    made.forEach((m, i) => { if (!m.ok) lost.push({ f: frames[i], error: `frame not extracted: ${m.error}` }); });
    for (const { f, big, feed } of made.filter((m) => m.ok).map((m) => m.value)) {
      groups.push({ id: `${f}|big`, label: String(f), f, content: { kind: 'image', media: ff.toDataUri(big, 'jpg') },
        questions: Object.entries(bank.problems).map(([id, q]) => ({ id, kind: 'yesno', instructions: q })) });
      if (feed) groups.push({ id: `${f}|feed`, label: String(f), f, content: { kind: 'image', media: ff.toDataUri(feed, 'jpg') },
        questions: [{ id: 'legible', kind: 'yesno', instructions: bank.legible }] });
    }
    return groups;
  };

  const t0 = Date.now();
  const rows = []; let usage = zeroUsage(); let usd = 0; let requests = 0;
  let pending = batches.length ? prepare(batches[0]) : null;
  for (let b = 0; b < batches.length; b++) {
    const groups = await pending;
    pending = b + 1 < batches.length ? prepare(batches[b + 1]) : null;     // decode the next batch while Clef reads this one
    pending?.catch(() => {});                                           // a decide error must not leave this one unhandled
    const r = await client.decide(groups, { what: 'sweep' });
    requests += groups.length;
    const fOf = new Map(groups.map((g) => [g.id, g.f]));
    for (const row of r.rows) {
      for (const [q, a] of Object.entries(row.answers)) rows.push({ f: fOf.get(row.id), q, answer: a.answer, p: a.p, error: a.error || null });
    }
    usage = { billed_input_tokens: usage.billed_input_tokens + r.usage.billed_input_tokens, output_tokens: usage.output_tokens + r.usage.output_tokens,
      image_tokens: usage.image_tokens + r.usage.image_tokens, calls: usage.calls + r.usage.calls };
    usd += r.usd;
    say(`sweep: ${Math.min(list.length, (b + 1) * batchFrames)}/${list.length} frames`);
  }
  const seconds = (Date.now() - t0) / 1000;
  for (const { f, error } of lost) rows.push({ f, q: '*', answer: null, p: null, error });

  // a frame counts as read only when every question about it was answered
  const { read: withAnswer, failed } = frameStatus(rows, list);
  const errors = rows.filter((r) => r.error).length;
  const nulls = rows.filter((r) => r.answer == null && !r.error).length;
  const flags = flagRows(rows, pmin);
  const runs = allRuns(flags, 3 * step);
  const res = {
    video, video_sha256_12: await fileSha12(video), fps: info.fps, video_frames: info.frames, range: [f0, f1], step,
    frames_read: withAnswer.size, requests, answers: rows.length, nulls, errors, failed_frames: failed,
    usage, usd: Number(usd.toFixed(6)), model: client.model, seconds: Number(seconds.toFixed(1)), workers,
    pmin, test_width: ctx.testWidth, schedule_used: !!ctx.schedule, typed_frames: typed.size,
    bank: bank.problems, legible: bank.legible,
    flagged: Object.fromEntries(Object.entries(flags).map(([q, v]) => [q, v.length])),
    runs: runs.map((r) => ({ q: r.q, frames: r.frames, n: r.n })), rows,
  };
  writeJson(path.join(out, 'sweep.json'), res);
  const md = summary(res, runs, bank);
  fs.writeFileSync(path.join(out, 'summary.md'), md);
  return { res, runs, md, out, failed };
}

function summary(r, runs, bank) {
  const L = [];
  L.push(`# Clef sweep, frames ${r.range[0]}-${r.range[1]} (step ${r.step})`, '');
  L.push(`${r.frames_read} frames read by Clef, ${r.requests} image requests, ${r.answers} answers (${r.nulls} unsure), ` +
    `${r.usage.billed_input_tokens.toLocaleString('en-US')} text + ${(r.usage.image_tokens || 0).toLocaleString('en-US')} image input tokens, $${r.usd.toFixed(6)} (model ${r.model}), ${Math.round(r.seconds)} s. ` +
    `A flag needs the problem answer with p >= ${r.pmin}. Legibility is asked at ${r.test_width} px${r.schedule_used ? ` on ${r.typed_frames} frames with text` : ' (no schedule: not asked)'}.`, '');
  if (r.errors) L.push(`**${r.errors} answers failed after retries; ${r.failed_frames.length} frames NOT read** (first: ${r.failed_frames.slice(0, 10).join(', ') || 'none'}). Run those again with --range before you use frames_read.`, '');
  for (const q of [...Object.keys(bank.problems), 'legible']) L.push(`- ${q}: ${r.flagged[q] || 0} frames flagged`);
  L.push('', '## Runs (question, first-last frame, frames flagged)');
  if (!runs.length) L.push('- none');
  for (const x of runs) L.push(`- ${x.q} f${x.frames[0]}-${x.frames[1]} n=${x.n}`);
  L.push('', 'Next: clefcut triage <this folder>');
  return L.join('\n') + '\n';
}
