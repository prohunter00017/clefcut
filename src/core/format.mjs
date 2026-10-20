// Number formats shared by the results card (numbers.mjs) and the savings line (savings.mjs).
export const fmtUsd = (x) => (x === null || x === undefined ? 'not measured' : `$${x >= 1 ? x.toFixed(2) : x.toFixed(4)}`);

export function fmtSeconds(s) {
  if (s === null || s === undefined) return 'not measured';
  const r = Math.round(s);                                // round once, so 119.7 is "2 min 0 s", never "120 s" or "1 min 60 s"
  if (r < 120) return `${r} s`;
  return `${Math.floor(r / 60)} min ${r % 60} s`;
}
