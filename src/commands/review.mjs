// clefcut review <video>: the whole QA in one command (gate, sweep, triage, numbers), with one summary and one exit code.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ClefClient } from '../core/clef.mjs';
import { newRunDir, ensureDir, qaDir } from '../core/paths.mjs';
import { writeJson, say, setQuiet } from '../core/log.mjs';
import { deliveryLine } from '../core/savings.mjs';
import { fmtUsd, fmtSeconds } from '../core/format.mjs';
import { runGate } from '../gate/pipeline.mjs';
import { runSweep } from './sweep.mjs';
import { runTriage } from './triage.mjs';
import { runNumbers } from './numbers.mjs';

export const help = 'the whole QA in one command: gate, sweep, triage and numbers, with one summary';

const USAGE = `usage: clefcut review <video> [--step N] [--range A-B] [--workers N] [--no-sweep] [--no-clef] [--no-ocr] [--max-billed N] [--out DIR] [--json]

Runs gate (measures every frame, asks Clef about about 20 prepared pictures), sweep (Clef reads every Nth frame),
triage (explains or asks again about what the sweep flagged) and numbers (cost and savings). Writes review.md and
review.json in the run folder; the gate and sweep folders inside it hold the details and the pictures.
  --step N        sweep every Nth frame: 2 or 3 for quick drafts, 1 (the default) before delivery
  --no-sweep      gate only: about 20 Clef requests, fast
  --no-clef       measurements only: no Clef request, no cost (implies --no-sweep)
  --json          print review.json (for agents)
Exit: 0 pass, 1 findings or open items, 2 error.`;

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function run(argv, { root, config }) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: {
      step: { type: 'string' }, range: { type: 'string' }, workers: { type: 'string' }, out: { type: 'string' }, 'max-billed': { type: 'string' },
      'no-sweep': { type: 'boolean' }, 'no-clef': { type: 'boolean' }, 'no-ocr': { type: 'boolean' }, json: { type: 'boolean' }, root: { type: 'string' },
      help: { type: 'boolean', short: 'h' } } });
  } catch (e) { console.error(`clefcut review: ${e.message}\n${USAGE}`); return 2; }
  const { values: v, positionals } = args;
  if (v.help || positionals.length !== 1) { console.log(USAGE); return v.help ? 0 : 2; }
  const noClef = !!v['no-clef'], noSweep = noClef || !!v['no-sweep'];
  if (!noClef) new ClefClient({ root }).check();                     // no key: stop before any work, with the fix
  const maxBilled = v['max-billed'] ? Number(v['max-billed'].replace(/[,_]/g, '')) : 200_000;
  if (!Number.isFinite(maxBilled) || maxBilled <= 0) { console.error('clefcut review: --max-billed needs a number'); return 2; }
  if (v.json) setQuiet(true);
  const video = path.resolve(positionals[0]);
  if (!fs.existsSync(video)) throw new Error(`video not found: ${video}`);
  const dir = ensureDir(v.out ? path.resolve(v.out) : newRunDir(root, 'review'));
  const t0 = Date.now();

  say('review: 1/4 gate');
  const gateDir = ensureDir(path.join(dir, 'gate'));
  const g = await runGate({ video, root, config, outDir: gateDir, noClef, noOcr: !!v['no-ocr'], maxBilled });
  let sw = null, tr = null;
  if (!noSweep) {
    say('review: 2/4 sweep');
    sw = await runSweep({ video, out: path.join(dir, 'sweep'), workers: v.workers, step: v.step, range: v.range, root, config });
    if (sw.runs.length) { say('review: 3/4 triage'); tr = await runTriage({ dir: sw.out, video, root, config }); }
  }
  say('review: 4/4 numbers');
  let nb;
  try { nb = await runNumbers({ runs: [gateDir, sw && sw.out].filter(Boolean), root, config }); } catch (e) { nb = { error: e.message }; }

  const clefErrors = g.clef_errors.length, asked = g.clef_asked;
  const open = tr ? tr.counts.confirmed + tr.counts['to-measure'] : 0;
  const error = (asked > 0 && clefErrors === asked) || (sw && sw.failed.length > 0);
  const exit = error ? 2 : g.findings.length || g.escalations.length || open || clefErrors ? 1 : 0;
  const rel = (p) => path.relative(dir, p).split(path.sep).join('/');
  const summary = {
    video, out: dir, exit, seconds: Math.round((Date.now() - t0) / 100) / 10,
    gate: { findings: g.findings.length, escalations: g.escalations.length, clef_asked: asked, clef_errors: clefErrors,
      summary: rel(path.join(gateDir, 'summary.md')), critic_frames: rel(path.join(gateDir, 'critic-frames')) },
    sweep: sw ? { frames_read: sw.res.frames_read, step: sw.res.step, failed_frames: sw.failed, flagged_runs: sw.runs.length, summary: rel(path.join(sw.out, 'summary.md')) } : null,
    triage: tr ? { counts: tr.counts, open, explained: Object.values(tr.explained).reduce((a, b) => a + b, 0), summary: rel(path.join(sw.out, 'triage.md')) } : null,
    cost: { clef_usd: round6((g.clef.usd || 0) + (sw ? sw.res.usd : 0) + (tr ? tr.usd : 0)), model: g.clef.model || (sw && sw.res.model) || null },
    numbers: nb.n ? { card: path.join(qaDir(root), 'card.md'), saved: nb.row ? deliveryLine(nb.row) : null } : { error: nb.error || null },
    // the findings themselves, so an agent can act without opening more files; images are relative to gate/
    findings: g.findings.map((f) => ({ check: f.check, severity: f.severity, frames: f.frames, t_s: f.t_s, beat: f.beat, evidence: f.evidence, image: f.crop ? `gate/${f.crop}` : null })),
    escalations: g.escalations.map((f) => ({ check: f.check, severity: f.severity, frames: f.frames, t_s: f.t_s, beat: f.beat, evidence: f.evidence, image: f.crop ? `gate/${f.crop}` : null })),
    open_runs: tr ? tr.residual.filter((r) => r.label === 'confirmed' || r.label === 'to-measure').map((r) => ({ question: r.q, frames: r.frames, label: r.label, detail: r.detail })) : [],
  };
  writeJson(path.join(dir, 'review.json'), summary);
  const md = reviewMd(summary);
  fs.writeFileSync(path.join(dir, 'review.md'), md);
  if (v.json) console.log(JSON.stringify(summary)); else { say(md); say(`written: ${path.relative(root, dir) || dir}`); }
  return exit;
}

function reviewMd(s) {
  const L = [`# ClefCut review: ${path.basename(s.video)}`, ''];
  L.push(`Result: ${s.exit === 0 ? 'PASS' : s.exit === 1 ? 'FINDINGS (exit 1)' : 'ERROR (exit 2)'}. ${fmtSeconds(s.seconds)}, Clef ${fmtUsd(s.cost.clef_usd)}${s.cost.model ? ` (model ${s.cost.model})` : ''}.`, '');
  L.push(`## Gate: ${plural(s.gate.findings, 'finding')}, ${plural(s.gate.escalations, 'escalation')}`, '');
  if (s.gate.clef_errors) L.push(`Clef gave no answer to ${s.gate.clef_errors} of ${s.gate.clef_asked} questions: those are errors, not passes.`);
  for (const f of s.findings.slice(0, 12)) L.push(`- [${f.severity}] ${f.check} f${f.frames.join('-')} (${f.t_s} s${f.beat ? `, ${f.beat}` : ''}): ${f.evidence}${f.image ? ` Image: ${f.image}` : ''}`);
  for (const f of s.escalations.slice(0, 6)) L.push(`- escalate ${f.check} f${f.frames.join('-')} (${f.t_s} s): ${f.evidence}${f.image ? ` Image: ${f.image}` : ''}`);
  if (s.findings.length > 12 || s.escalations.length > 6) L.push(`- ... the rest in ${s.gate.summary}`);
  L.push('', `Details: ${s.gate.summary}. Critic frames: ${s.gate.critic_frames}/.`, '');
  if (s.sweep) {
    L.push(`## Sweep: ${plural(s.sweep.frames_read, 'frame')} read (every ${s.sweep.step === 1 ? '' : `${s.sweep.step}th `}frame), ${plural(s.sweep.flagged_runs, 'flagged run')}`, '');
    if (s.sweep.failed_frames.length) L.push(`${s.sweep.failed_frames.length} frames were NOT read (first: ${s.sweep.failed_frames.slice(0, 8).join(', ')}). Run the review again, or "clefcut sweep" on those frames with --range.`, '');
  } else L.push('## Sweep: not run', '');
  if (s.triage) {
    const c = s.triage.counts;
    L.push(`## Triage: ${plural(s.triage.explained, 'flag')} explained by the schedule; ${c.confirmed} confirmed, ${c['to-measure']} to measure, ${c['cleared-by-clef'] + c['cleared-by-measurement']} cleared`, '');
    for (const r of s.open_runs.slice(0, 8)) L.push(`- ${r.label} ${r.question} f${r.frames[0]}-${r.frames[1]}: ${r.detail}`);
    if (s.open_runs.length) L.push('');
  }
  if (s.numbers.saved) L.push(s.numbers.saved, '');
  L.push('## Next', '');
  if (s.exit === 0) L.push('- Nothing to fix. Run "clefcut deliver-check <video>" before you hand the file over.');
  else {
    L.push('- Fix the findings above in the Remotion code (or the schedule, if a flag is designed), render again, then run "clefcut review" again.');
    L.push('- To look at a frame: open its image if your model can see pictures; otherwise ask Clef about it with "clefcut ask --images <image> --question \\"...\\"".');
  }
  return L.join('\n') + '\n';
}
