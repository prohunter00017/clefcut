// sagecut doctor: checks the set-up and prints the fix for each failure.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { locate, run as ff } from '../core/ffmpeg.mjs';
import { loadClefEnv, maskKey, KEY_PAGE } from '../core/env.mjs';
import { ClefClient } from '../core/clef.mjs';
import { createOcr } from '../core/ocr.mjs';
import { loadBrand } from '../core/brand.mjs';
import { validateSchedule } from '../core/schedule.mjs';
import { VERSION } from '../core/version.mjs';

export const help = 'check Node, ffmpeg, the Cloudflare key and the Clef model, OCR, brand and schedule';

export async function checks(ctx) {
  const out = [];
  const add = (name, status, detail, fix) => out.push({ name, status, detail, ...(fix ? { fix } : {}) });
  const root = ctx.root;

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) add('node', 'pass', `Node ${process.versions.node}`);
  else add('node', 'fail', `Node ${process.versions.node}`, 'Install Node 18 or later: https://nodejs.org');

  try {
    const t = locate(root);
    const v = await ff('ffmpeg', ['-hide_banner', '-version'], { root });
    const p = await ff('ffprobe', ['-hide_banner', '-version'], { root });
    if (v.code === 0 && p.code === 0) {
      const ver = (v.stdout.toString().match(/ffmpeg version (\S+)/) || [])[1] || '?';
      if (t.source.startsWith('remotion:')) add('ffmpeg', 'pass', `ffmpeg ${ver} and ffprobe (source: ${t.source})`);
      else add('ffmpeg', 'warn', `ffmpeg ${ver} and ffprobe (source: ${t.source})`, "using a system ffmpeg; in your Remotion project run npm install so SageCut uses Remotion's bundled ffmpeg");
    } else add('ffmpeg', 'fail', 'ffmpeg or ffprobe did not run', 'Run "npm install" in your Remotion project (it installs @remotion/compositor-*), or set SAGECUT_FFMPEG and SAGECUT_FFPROBE.');
  } catch (e) {
    add('ffmpeg', 'fail', e.message.split('\n')[0], 'Run "npm install" in your Remotion project (it installs @remotion/compositor-*), or set SAGECUT_FFMPEG and SAGECUT_FFPROBE.');
  }

  await clefChecks(root, add);

  try { const o = await createOcr(); await o.close(); add('ocr', 'pass', 'tesseract.js ready (local language data)'); }
  catch (e) { add('ocr', 'fail', e.message.split('\n')[0], 'Reinstall the plugin: assets/eng.traineddata or bin/ocr/ is missing.'); }

  if (fs.existsSync(ctx.config.brandPath)) {
    try { const b = loadBrand(ctx.config.brandPath); add('brand', 'pass', `brand "${b.name}" (${ctx.config.brand})`); }
    catch (e) { add('brand', 'fail', e.message, 'Fix the listed fields, then run "sagecut brand set sagecut/brand.yaml".'); }
  } else add('brand', 'warn', `no brand file at ${ctx.config.brand}`, 'Run /sagecut:start, or "sagecut brand from-url <URL>".');

  if (fs.existsSync(ctx.config.schedulePath)) {
    try {
      const errs = validateSchedule(JSON.parse(fs.readFileSync(ctx.config.schedulePath, 'utf8')));
      if (errs.length) add('schedule', 'fail', `${errs.length} error(s): ${errs[0]}`, 'Run "sagecut check-schedule" for the full list.');
      else add('schedule', 'pass', ctx.config.schedule);
    } catch (e) { add('schedule', 'fail', e.message, 'Fix the JSON in the schedule file.'); }
  } else add('schedule', 'warn', `no schedule at ${ctx.config.schedule}`, 'Run "sagecut init".');
  return out;
}

// The Cloudflare key, then one tiny question to the Clef model.
async function clefChecks(root, add) {
  const env = loadClefEnv(root), model = `@cf/cloudflare/${env.model}`;
  const fix = `Make an API token with the Workers AI permission at ${KEY_PAGE}, then put CLOUDFLARE_ACCOUNT_ID=... and CLOUDFLARE_API_TOKEN=... in your project .env or ~/.sagecut/.env.`;
  if (env.hasKey) add('clef key', 'pass', `CLOUDFLARE_ACCOUNT_ID (${maskKey(env.account)}) and CLOUDFLARE_API_TOKEN (${maskKey(env.token)}) present, model ${env.model}`);
  else { add('clef key', 'fail', 'CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not found', fix); return; }
  const rd = await new ClefClient({ root }).ready();
  if (rd.ok) add('clef model', 'pass', `Workers AI ${model} answered a test question`);
  else add('clef model', 'fail', `Workers AI ${model}: ${String(rd.error || `HTTP ${rd.status}`).split(env.token).join('(key)').split('\n')[0].slice(0, 160)}`,
    rd.status === 401 || rd.status === 403 ? fix : 'Check your network, CLOUDFLARE_ACCOUNT_ID and CLEF_MODEL (clef, clef-flash or clef-omni). If this persists, see the troubleshooting reference of the skill (references/troubleshooting.md).');
}

export async function run(argv, ctx) {
  const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' }, root: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('usage: sagecut doctor [--json]'); return 0; }
  const results = await checks(ctx);
  const failed = results.some((r) => r.status === 'fail');
  if (values.json) { console.log(JSON.stringify({ version: VERSION, ok: !failed, checks: results }, null, 1)); return failed ? 1 : 0; }
  console.log(`sagecut ${VERSION} doctor (project: ${ctx.root})`);
  const mark = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' };
  for (const r of results) {
    console.log(`${mark[r.status]}  ${r.name.padEnd(12)} ${r.detail}`);
    if (r.fix && r.status !== 'pass') console.log(`      fix: ${r.fix}`);
  }
  return failed ? 1 : 0;
}
