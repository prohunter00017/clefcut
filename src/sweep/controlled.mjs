// Clef asks each question on a positive control (a planted defect) next to the frames.
import { isProblem } from './bank.mjs';

export const CONTROL_PMIN = 0.7;
const CTL_POS = '__control_pos';
const CTL_NEG = '__control_neg';

export const zeroUsage = () => ({ billed_input_tokens: 0, output_tokens: 0, image_tokens: 0, calls: 0 });

// Run fn over list with at most n at a time.
export async function pool(list, n, fn) {
  const out = new Array(list.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => {
    for (;;) { const i = next++; if (i >= list.length) return; out[i] = await fn(list[i], i); }
  }));
  return out;
}

// pool, but a failing item becomes { ok: false, error } instead of rejecting the whole run.
export function poolSettled(list, n, fn) {
  return pool(list, n, async (x, i) => {
    try { return { ok: true, value: await fn(x, i) }; } catch (e) { return { ok: false, error: e.message }; }
  });
}

// Judge one control answer set. bad = the answer that means "defect present".
export function judgeControl(pos, neg, bad, pmin) {
  const posOk = !!pos && isProblem(pos.answer, pos.p, bad, CONTROL_PMIN);
  const negFlag = !!neg && isProblem(neg.answer, neg.p, bad, pmin);
  const ok = posOk;
  const reason = !pos ? 'no control answer' : posOk ? (negFlag ? 'control found, but the question also flags the clean frame' : 'control found')
    : (pos.answer == null ? 'Clef was unsure on the control' : `Clef did not find the defect in the control (${pos.answer}, p=${pos.p})`);
  return { ok, clean_frame_flagged: negFlag, reason };
}

export async function runControlled(client, { items, variants, control, bad = 'yes', pmin = 0.8, what = 'ask' }) {
  const questions = variants.map((v) => ({ id: v.id, kind: 'yesno', instructions: v.instructions }));
  const groups = [];
  if (control) {
    groups.push({ id: CTL_POS, label: `control:${control.kind}`, content: { kind: 'image', media: control.pos }, questions });
    if (control.neg) groups.push({ id: CTL_NEG, label: 'clean frame', content: { kind: 'image', media: control.neg }, questions });
  }
  for (const it of items) groups.push({ id: it.id, label: it.label, content: { kind: 'image', media: it.media }, questions });
  const r = await client.decide(groups, { what });
  const rows = [], controls = {};
  for (const v of variants) controls[v.id] = control ? { ok: true, kind: control.kind, pos: null, neg: null, clean_frame_flagged: false, reason: 'control found' }
    : { ok: false, kind: null, pos: null, neg: null, clean_frame_flagged: false, reason: 'no control could be made for this question' };
  for (const row of r.rows) {
    if (row.id === CTL_POS || row.id === CTL_NEG) {
      for (const v of variants) {
        const c = controls[v.id]; const a = row.answers[v.id];
        if (row.id === CTL_POS) {
          const j = judgeControl(a, null, bad, pmin);
          if (c.pos === null || !j.ok) { c.pos = a; c.ok = c.ok && j.ok; if (!j.ok) c.reason = j.reason; }
        } else {
          c.neg = a;
          if (isProblem(a.answer, a.p, bad, pmin)) { c.clean_frame_flagged = true; if (c.ok) c.reason = 'control found, but the question also flags the clean frame'; }
        }
      }
    } else rows.push(row);
  }
  return { rows, controls, usage: r.usage, usd: r.usd, seconds: r.seconds };
}

export function runVerdict(answers, controls, bad, pmin) {
  let n = 0; let pc = 0; let voided = 0; let weak = 0;
  for (const a of answers) {
    if (a.answer == null) continue;
    const c = controls[a.variantId];
    if (isProblem(a.answer, a.p, bad, pmin)) {
      if (c && c.clean_frame_flagged) { voided++; continue; }
      n++; pc++;
    } else if (a.answer === bad) weak++;       // the problem answer with low confidence
    else if (c && c.ok) n++;
    else voided++;
  }
  const base = { n, problems: pc, voided, weak };
  if (n === 0) return { label: 'to-measure', detail: voided ? 'the control failed, so the "no" answers prove nothing' : 'Clef gave no usable answer', ...base };
  if (pc >= 1 && pc * 2 >= n) return { label: 'confirmed', detail: `${pc} of ${n} answers flag it`, ...base };
  if (pc === 0 && n >= 2 && weak === 0) return { label: 'cleared-by-clef', detail: `${n} answers say no, control ok`, ...base };
  return { label: 'to-measure', detail: pc === 0 ? (weak ? 'a weak "yes" remains' : 'only one valid "no" answer') : `${pc} of ${n} answers flag it (mixed)`, ...base };
}
