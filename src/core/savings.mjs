// Savings ledger: one row per delivered film version, in ~/.clefcut/savings.jsonl (all projects).
import fs from 'node:fs';
import path from 'node:path';
import { userDataDir } from './paths.mjs';
import { readJson, writeJson } from './log.mjs';
import { fmtUsd, fmtSeconds } from './format.mjs';

export const ledgerFile = () => path.join(userDataDir(), 'savings.jsonl');
export const sessionFile = () => path.join(userDataDir(), 'session.json');

export function savingsRow(n, { video, sha = n.video_sha256_12, ts = new Date().toISOString() } = {}) {
  const e = n.old_review_estimate; const s = n.clefcut;
  if (!e || !sha) return null;
  const clefcutUsd = (s.clef_usd || 0) + (s.critics_usd || 0);
  const criticsSeconds = s.critics_seconds ?? 0;      // the critics' time is part of ClefCut's time
  return {
    ts, sha, video: path.basename(video || 'unknown'), frames: s.frames_read,
    critics_measured: s.critics_usd !== null && s.critics_usd !== undefined,
    critics_time_measured: s.critics_seconds !== null && s.critics_seconds !== undefined,
    clefcut_usd: Number(clefcutUsd.toFixed(4)), clefcut_seconds: Number((s.qa_seconds + criticsSeconds).toFixed(1)),
    old_usd: e.usd, old_seconds: e.seconds, old_basis: e.reference === 'house' ? 'house' : 'baseline',
    saved_usd: Number((e.usd - clefcutUsd).toFixed(4)), saved_seconds: Number((e.seconds - s.qa_seconds - criticsSeconds).toFixed(1)),
  };
}

// A torn or bad line is skipped; it never costs the other rows.
export function readRows(file = ledgerFile()) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const rows = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r && typeof r === 'object') rows.push(r); } catch { /* torn line */ }
  }
  return rows;
}

// One row per video hash: a second run for the same film replaces the first row.
export function upsertRow(row, file = ledgerFile()) {
  const rows = readRows(file).filter((r) => r.sha !== row.sha);
  rows.push(row);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;                // write, then rename: a crash never leaves half a ledger
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.renameSync(tmp, file);
  return rows;
}

// Pure: totals of the rows at or after `since` (an ISO time, or null for all rows).
export function totals(rows, since = null) {
  const sel = rows.filter((r) => !since || r.ts >= since);
  const sum = (k) => sel.reduce((a, r) => a + (r[k] || 0), 0);
  // the saving is recomputed from the two sides of each row
  const clefcutUsd = sum('clefcut_usd'), clefcutS = sum('clefcut_seconds'), oldUsd = sum('old_usd'), oldS = sum('old_seconds');
  return {
    films: sel.length,
    clefcut_usd: Number(clefcutUsd.toFixed(4)), clefcut_seconds: clefcutS,
    old_usd: Number(oldUsd.toFixed(4)), old_seconds: oldS,
    saved_usd: Number((oldUsd - clefcutUsd).toFixed(4)), saved_seconds: Number((oldS - clefcutS).toFixed(1)),
  };
}

// The line shown after each delivered video.
export const BASIS_TEXT = {
  house: "estimate at the rate measured on Levanto's reference build, Claude API list prices",
  baseline: 'estimate from a measured sample of this video, Claude API list prices',
};
export function savedText(usd, seconds) {
  const m = usd > 0 ? `about ${fmtUsd(usd)}` : null; const t = seconds > 0 ? fmtSeconds(seconds) : null;
  if (m && t) return `about ${fmtUsd(usd)} and ${t} (estimate)`;
  if (m) return `about ${fmtUsd(usd)} (estimate); no time saved`;
  if (t) return `${t} (estimate); no money saved`;
  return null;
}
export function deliveryLine(row) {
  const saved = savedText(row.saved_usd, row.saved_seconds);
  return (saved ? `Saved on this video: ${saved}. ` : 'No saving on this video (estimate). ') +
    `ClefCut: ${fmtUsd(row.clefcut_usd)} in ${fmtSeconds(row.clefcut_seconds)} (measured). ` +
    `Opus critics viewing the same ${row.frames} frames: about ${fmtUsd(row.old_usd)} in ${fmtSeconds(row.old_seconds)} (${BASIS_TEXT[row.old_basis] || BASIS_TEXT.baseline}).` +
    (row.critics_measured ? '' : ' The critics were not measured, so ClefCut\'s cost leaves them out.')
    + (row.critics_time_measured === false ? ' The critics\' time was not measured.' : '');
}

// The line shown for a session. `t` comes from totals().
export function sessionLine(t, label = 'ClefCut this session') {
  const films = `${t.films} video${t.films === 1 ? '' : 's'}`;
  const saved = savedText(t.saved_usd, t.saved_seconds);
  return `${label}: ${films}. ${saved ? `Saved ${saved}` : 'No saving (estimate)'}. ` +
    `ClefCut: ${fmtUsd(t.clefcut_usd)} in ${fmtSeconds(t.clefcut_seconds)} (measured). Opus critics on the same frames: ${fmtUsd(t.old_usd)} in ${fmtSeconds(t.old_seconds)} (estimate, list prices).`;
}

export function readSession(file = sessionFile()) { return readJson(file, null); }
export function startSession(now = new Date().toISOString(), file = sessionFile()) {
  writeJson(file, { startedAt: now, shown: [] });
}

// Rows of this session that the Stop hook has not shown yet. Marks them shown.
export function takeFresh(file = sessionFile(), rowsFile = ledgerFile()) {
  const sess = readSession(file);
  if (!sess) return { sess: null, fresh: [], rows: [] };
  const rows = readRows(rowsFile).filter((r) => r.ts >= sess.startedAt);
  const key = (r) => `${r.sha}@${r.ts}`;
  const fresh = rows.filter((r) => !sess.shown.includes(key(r)));
  if (fresh.length) writeJson(file, { ...sess, shown: [...sess.shown, ...fresh.map(key)] });
  return { sess, fresh, rows };
}
