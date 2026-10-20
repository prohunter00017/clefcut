// Cloudflare key and Clef model. Order (first wins): process environment, <project>/.env, ./.env, then the user-level
import fs from 'node:fs';
import path from 'node:path';
import { userDataDir } from './paths.mjs';

export const DEFAULT_MODEL = 'clef';
export const KEY_PAGE = 'https://dash.cloudflare.com/profile/api-tokens';

function parseDotenv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).replace(/^export\s+/, '').trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/(^|\s+)#.*$/, '');            // "KEY=value   # comment": the comment is not part of the value
    out[k] = v;
  }
  return out;
}

export function loadClefEnv(projectRoot = process.cwd()) {
  // lowest priority first: later files override earlier ones
  const files = [path.join(userDataDir(), '.env'), path.join(process.cwd(), '.env'), path.join(projectRoot, '.env')];
  const merged = {};
  for (const f of files) for (const [k, v] of Object.entries(parseDotenv(f))) if (v !== '') merged[k] = v;   // an empty template line never wipes a real value
  const pick = (k) => (process.env[k] || merged[k] || '').trim();
  const account = pick('CLOUDFLARE_ACCOUNT_ID'), token = pick('CLOUDFLARE_API_TOKEN');
  return { account, token, model: pick('CLEF_MODEL') || DEFAULT_MODEL, hasKey: !!(account && token) };
}

// A masked form for messages: never more than the last 4 characters.
export const maskKey = (key) => (key ? `…${key.slice(-4)}` : '(none)');
