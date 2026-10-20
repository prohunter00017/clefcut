// The question bank and the Clef round of the gate. Clef is reached only through core/clef.mjs (ClefClient).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { pluginRoot } from '../core/paths.mjs';
import { SCALE_MARGIN } from './consts.mjs';

export const defaultBankPath = () => path.join(pluginRoot(), 'assets', 'bank', 'gate-default.yaml');

export function loadBank(file) {
  if (!fs.existsSync(file)) throw new Error(`Question bank not found: ${file}`);
  const bank = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!bank || !Array.isArray(bank.questions)) throw new Error(`Question bank ${file} has no "questions" list`);
  return { path: file, questions: Object.fromEntries(bank.questions.map((q) => [q.id, q])) };
}

// The question as Clef receives it: placeholders in {braces} filled from params.
export function renderQuestion(q, params = {}) {
  // check the template, not the result: element text such as "const {data}" is a value, not a placeholder
  const missing = [...q.instructions.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((k) => typeof params[k] !== 'string');
  if (missing.length) throw new Error(`question ${q.id}: unfilled placeholder {${missing[0]}} in "${q.instructions.slice(0, 100)}"`);
  let instr = q.instructions;
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string') instr = instr.split(`{${k}}`).join(v);
  const out = { id: q.id, kind: q.kind, instructions: instr.trim() };
  if (q.kind === 'scale') out.levels = q.levels.map((l) => ({ level: l.level, description: l.description }));
  return out;
}

// Every prepared picture, after the local token estimate is checked against the budget.
// answers: Map(group index -> Map(question id -> { ok, answer, p, expectation, error })).
export async function askClef(client, groups, { maxBilled, onEstimate = () => {} } = {}) {
  const e = client.estimate(groups);
  onEstimate({ ...e, groups: groups.length });
  if (e.hi > maxBilled) throw new Error(`Clef estimate ${e.hi.toLocaleString('en-US')} input tokens is above --max-billed ${maxBilled.toLocaleString('en-US')}. Raise the limit or send fewer frames.`);
  const r = await client.decide(groups.map((g, i) => ({ ...g, id: i })), { what: 'gate' });
  const answers = new Map(r.rows.map((row) => [row.id, new Map(Object.entries(row.answers))]));
  return { answers, usage: r.usage, usd: r.usd, estimate: [e.lo, e.hi], calls: r.usage.calls, seconds: r.seconds };
}

// Decision on one answer: { status: fail | escalate | pass, answer, p, note }.
export function judge(q, ans) {
  if (!ans || !ans.ok) return { status: 'error', answer: null, p: null, note: `no answer: ${(ans && ans.error) || 'no response'}` };
  if (q.kind === 'yesno') {
    if (ans.answer == null) return { status: 'escalate', answer: null, p: ans.p, note: 'null answer' };
    return { status: ans.answer === q.fail ? 'fail' : 'pass', answer: ans.answer, p: ans.p, note: '' };
  }
  if (q.kind === 'scale') {
    const e = ans.expectation, line = q.pass_at_least;
    if (e == null) return { status: 'escalate', answer: null, p: null, note: 'null expectation' };
    const near = line != null && Math.abs(e - line) < SCALE_MARGIN, low = line != null && e < line;
    const r = Math.round(e * 100) / 100;
    if (q.escalate_only) return { status: low || near ? 'escalate' : 'pass', answer: r, p: r, note: low ? 'escalate-only, below the pass line' : near ? 'near the pass line' : '' };
    if (near) return { status: 'escalate', answer: r, p: r, note: 'near the pass line' };
    return { status: low ? 'fail' : 'pass', answer: r, p: r, note: '' };
  }
  return { status: 'escalate', answer: null, p: null, note: `unsupported kind ${q.kind}` };
}
