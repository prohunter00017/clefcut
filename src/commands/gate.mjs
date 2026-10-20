// sagecut gate <video>: measure every frame, ask Clef about ~20 prepared frames, select frames for the critics.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { newRunDir, ensureDir } from '../core/paths.mjs';
import { setQuiet, say } from '../core/log.mjs';
import { runGate } from '../gate/pipeline.mjs';

export const help = 'measure a rendered video, ask Clef about prepared frames, select frames for the critics';

const USAGE = `usage: sagecut gate <video> [--out DIR] [--json] [--no-clef] [--no-ocr] [--schedule FILE] [--bank FILE] [--max-billed N]

  --out DIR        run folder (default sagecut/qa/gate-<stamp>)
  --json           print the result as JSON on stdout (no other output)
  --no-clef        measurement only: no Clef call, no cost
  --no-ocr         skip the OCR text checks
  --schedule FILE  schedule.json to use (default: the one in sagecut.yaml)
  --bank FILE      question bank to use (default: the bank in the plugin)
  --max-billed N   stop before the Clef round if the estimate is above N input tokens (default 200000)`;

export async function run(argv, ctx) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: {
      out: { type: 'string' }, json: { type: 'boolean' }, 'no-clef': { type: 'boolean' }, 'no-ocr': { type: 'boolean' },
      schedule: { type: 'string' }, bank: { type: 'string' }, 'max-billed': { type: 'string' }, root: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } });
  } catch (e) { console.error(`sagecut gate: ${e.message}\n${USAGE}`); return 2; }
  const { values: v, positionals } = args;
  if (v.help) { console.log(USAGE); return 0; }
  if (positionals.length !== 1) { console.error(`sagecut gate: give one video file.\n${USAGE}`); return 2; }
  const maxBilled = v['max-billed'] ? Number(v['max-billed'].replace(/[,_]/g, '')) : 200_000;
  if (!Number.isFinite(maxBilled) || maxBilled <= 0) { console.error('sagecut gate: --max-billed needs a number'); return 2; }
  if (v.json) setQuiet(true);
  try {
    const video = path.resolve(positionals[0]);
    const outDir = v.out ? ensureDir(path.resolve(v.out)) : newRunDir(ctx.root, 'gate');
    const result = await runGate({
      video, root: ctx.root, config: ctx.config, outDir, noClef: !!v['no-clef'], noOcr: !!v['no-ocr'], maxBilled,
      schedulePath: v.schedule ? path.resolve(v.schedule) : null, bankPath: v.bank ? path.resolve(v.bank) : null,
    });
    const clefErr = result.clef_errors.length, asked = result.clef_asked;
    const code = asked > 0 && clefErr === asked ? 2 : result.findings.length || result.escalations.length || clefErr ? 1 : 0;
    if (asked > 0 && clefErr === asked) console.error(`sagecut gate: Clef returned no answer for any of the ${asked} questions (${result.clef_errors[0].error}). Check the Cloudflare key, CLEF_MODEL and the network: run "sagecut doctor". The measurements in ${outDir} stand.`);
    if (v.json) {
      process.stdout.write(JSON.stringify({ exit: code, out: outDir, version: result.version, video_info: result.video_info, clef: result.clef, clef_asked: asked, clef_errors: result.clef_errors, notes: result.notes,
        counts: { findings: result.findings.length, escalations: result.escalations.length, designed: result.designed.length, passes: result.passes.length },
        findings: result.findings, escalations: result.escalations, designed: result.designed, skipped: result.skipped,
        critic_frames: result.critic_frames.map((c) => ({ ...c, file: path.join(outDir, 'critic-frames', c.file) })) }, null, 1) + '\n');
    } else {
      say(fs.readFileSync(path.join(outDir, 'summary.md'), 'utf8').trimEnd());
      say(`\nResults: ${path.join(outDir, 'findings.json')}`);
    }
    return code;
  } catch (e) {
    console.error(`sagecut gate: ${e.message.split('\n')[0]}`);
    if (process.env.SAGECUT_DEBUG) console.error(e.stack);
    return 2;
  } finally { setQuiet(false); }
}
