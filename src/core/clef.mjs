// Clef (Cloudflare Workers AI decision model) client. One picture and its yes/no or scale questions per request:
// POST /client/v4/accounts/<account>/ai/run/@cf/cloudflare/<model>.
import path from 'node:path';
import { loadClefEnv, DEFAULT_MODEL } from './env.mjs';
import { appendJsonl } from './log.mjs';
import { metricsDir } from './paths.mjs';
import { VERSION } from './version.mjs';

export const CLEF_INPUT_USD = { clef: 0.24, 'clef-flash': 0.038, 'clef-omni': 0.15 };   // per M input tokens; no output charge
export { DEFAULT_MODEL };
export const NULL_BAND = 0.1;          // P(yes) within this of 0.5 is an unsure (null) answer
const STATE = 'The image is the content to evaluate.';
const MIN_AREA = 256 * 256, MAX_AREA = 1024 * 1024, MAX_PATCHES = 1024, MARKERS = 3;

export const clefUrl = (account, model) => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${model}`;

export function clefUsd(usage, model = DEFAULT_MODEL) {
  const rate = CLEF_INPUT_USD[model] ?? CLEF_INPUT_USD[DEFAULT_MODEL];
  return (((usage.billed_input_tokens || 0) + (usage.image_tokens || 0)) * rate) / 1e6;
}

// { w, h } of a PNG or JPEG data URI, or null.
export function imageSize(uri) {
  const m = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(uri || '');
  if (!m) return null;
  const b = Buffer.from(m[1] === 'png' ? m[2].slice(0, 44) : m[2], 'base64');
  if (m[1] === 'png') return b.length >= 24 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const mk = b[i + 1];
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

// Input tokens of one picture: resized to 256x256..1 MP area with sides on a 32 px grid, one token per 32x32 patch.
export function imageTokens({ w, h }) {
  const a = w * h, s = a < MIN_AREA ? Math.sqrt(MIN_AREA / a) : a > MAX_AREA ? Math.sqrt(MAX_AREA / a) : 1;
  const side = (v) => Math.max(1, Math.round((v * s) / 32));
  return Math.min(MAX_PATCHES, side(w) * side(h)) + MARKERS;
}

const mediaOf = (g) => (typeof g.content === 'string' ? null : g.content.media || null);
export const groupImageTokens = (g) => { const m = mediaOf(g); if (!m) return 0; const s = imageSize(m); return s ? imageTokens(s) : MAX_PATCHES + MARKERS; };
const levelsOf = (q) => [...q.levels].sort((a, b) => a.level - b.level);

export function toClefRequest(model, g) {
  const media = mediaOf(g), text = typeof g.content === 'string' ? g.content : g.content.text || '';
  const questions = {};
  g.questions.forEach((q, i) => {
    if (q.kind === 'yesno') questions[`q${i}`] = { type: 'noul', instructions: q.instructions };
    else if (q.kind === 'scale') questions[`q${i}`] = { type: 'score', instructions: q.instructions, criteria: levelsOf(q).map((l) => l.description) };
    else throw new Error(`question ${q.id}: Clef cannot answer kind "${q.kind}" (only yesno and scale)`);
  });
  return { model, state: text || STATE, questions, ...(media ? { images: [media] } : {}) };
}

const noAnswer = (error) => ({ ok: false, answer: null, p: null, expectation: null, error });

// Clef answers (keyed q0, q1, ...) as { [question id]: { ok, answer, p, expectation } }. A scale answer has only an expectation.
export function readAnswers(g, answers = {}) {
  return Object.fromEntries(g.questions.map((q, i) => {
    const a = answers[`q${i}`];
    if (q.kind === 'scale') {
      if (!a || typeof a.score !== 'number') return [q.id, noAnswer('no answer')];
      const lv = levelsOf(q), k = Math.min(Math.floor(a.score), lv.length - 1), f = a.score - k;
      const expectation = k + 1 < lv.length ? lv[k].level + f * (lv[k + 1].level - lv[k].level) : lv[k].level;
      return [q.id, { ok: true, answer: null, p: null, expectation }];
    }
    if (!a || typeof a.noul !== 'number') return [q.id, noAnswer('no answer')];
    const p = a.noul;
    return [q.id, { ok: true, answer: Math.abs(p - 0.5) < NULL_BAND ? null : p >= 0.5 ? 'yes' : 'no', p, expectation: null }];
  }));
}

// Token range for the pre-flight budget check: exact image tokens, text at 3 to 4 characters per token, plus Clef's own
// prompt around each question (60-80 tokens, measured on live runs) and request.
export function estimateGroup(model, g) {
  const req = toClefRequest(model, g), chars = req.state.length + JSON.stringify(req.questions).length, img = groupImageTokens(g), n = g.questions.length;
  return { lo: img + Math.ceil(chars / 4) + 60 * n, hi: img + Math.ceil(chars / 3) + 80 * n + 30 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fatal = (message, status) => Object.assign(new Error(message), { fatal: true, status });

export class ClefClient {
  constructor({ root = process.cwd(), workers = 4, tag = 'clefcut', timeoutMs = 90_000 } = {}) {
    const env = loadClefEnv(root);
    this.root = root; this.workers = Math.max(1, Math.trunc(workers) || 4); this.tag = tag; this.timeoutMs = timeoutMs;
    this.account = env.account; this.token = env.token; this.model = env.model; this.url = clefUrl(env.account, env.model);
  }

  // Commands call this first: it fails with the fix when the key or the model is wrong.
  check() {
    if (!this.account || !this.token) throw fatal('No Cloudflare key. Put CLOUDFLARE_ACCOUNT_ID=... and CLOUDFLARE_API_TOKEN=... in your project .env file or ~/.clefcut/.env (run "clefcut doctor").');
    if (CLEF_INPUT_USD[this.model] == null) throw fatal(`CLEF_MODEL "${this.model}" is not a Clef model. Use one of: ${Object.keys(CLEF_INPUT_USD).join(', ')}.`);
  }

  async post(body, tries = 5) {
    this.check();
    const headers = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': `clefcut/${VERSION}` };
    const payload = JSON.stringify(body);
    for (let n = 0; n < tries; n++) {
      let r;
      try { r = await fetch(this.url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(this.timeoutMs) }); }
      catch (e) {
        if (n < tries - 1) { await sleep(2000 * 2 ** n); continue; }
        const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
        throw new Error(`Clef ${this.model}: ${timedOut ? `timed out after ${Math.round(this.timeoutMs / 1000)} s` : e.message}`);
      }
      if (r.status === 200) { const j = await r.json(); return (j && j.result) || j || {}; }
      if ([429, 500, 502, 503, 504].includes(r.status) && n < tries - 1) {
        const ra = Number(r.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** n);
        continue;
      }
      if (r.status === 401 || r.status === 403) throw fatal(`Cloudflare rejected the key (HTTP ${r.status}). Check CLOUDFLARE_API_TOKEN (it needs Workers AI permission) and CLOUDFLARE_ACCOUNT_ID in .env.`, r.status);
      throw Object.assign(new Error(`Clef ${this.model} HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`), { status: r.status });
    }
    throw new Error(`Clef ${this.model}: no answer after ${tries} tries`);
  }

  // There is no health route: ask one tiny question, which also checks the key.
  async ready() {
    try { await this.post({ model: this.model, state: 'ClefCut doctor check', questions: { q: { type: 'noul', instructions: 'Is this text a test?' } } }, 1); return { ok: true, status: 200 }; }
    catch (e) { return { ok: false, status: e.status || 0, error: e.message }; }
  }

  estimate(groups) {
    let lo = 0, hi = 0;
    for (const g of groups) { const e = estimateGroup(this.model, g); lo += e.lo; hi += e.hi; }
    return { lo, hi };
  }

  // One group (a picture and its questions) in one request.
  async ask(g) {
    const r = await this.post(toClefRequest(this.model, g));
    const u = r.usage || {}, input = u.input_tokens || 0, img = Math.min(groupImageTokens(g), input);
    return { answers: readAnswers(g, r.answers), usage: { billed_input_tokens: input - img, image_tokens: img, output_tokens: u.output_tokens || 0 } };
  }

  // Every group, `workers` requests at a time, rows in input order. A wrong key or model stops the run; any other
  // failure (after the retries) makes that group's answers errors, never judgements.
  async decide(groups, { what = 'decide' } = {}) {
    const t0 = Date.now();
    const usage = { billed_input_tokens: 0, output_tokens: 0, image_tokens: 0, calls: 0 };
    const rows = new Array(groups.length);
    let next = 0, stop = null;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (stop || i >= groups.length) return;
        const g = groups[i];
        let answers;
        try {
          const r = await this.ask(g);
          answers = r.answers;
          for (const k of ['billed_input_tokens', 'output_tokens', 'image_tokens']) usage[k] += r.usage[k];
        } catch (e) {
          if (e.fatal) { stop = e; return; }
          answers = Object.fromEntries(g.questions.map((q) => [q.id, noAnswer(e.message)]));
        }
        usage.calls++;
        rows[i] = { id: g.id, label: g.label || String(g.id), answers };
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.workers, groups.length) }, worker));
    if (stop) throw stop;
    const usd = clefUsd(usage, this.model);
    const seconds = (Date.now() - t0) / 1000;
    appendJsonl(path.join(metricsDir(this.root), 'clef.jsonl'), { tag: this.tag, what, groups: groups.length, ...usage, usd: Number(usd.toFixed(6)), model: this.model, seconds });
    return { rows, usage, usd, seconds };
  }
}
