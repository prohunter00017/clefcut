// SessionStart hook: prints the welcome line once. It never fails the session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

try {
  const dir = process.env.CLAUDE_PLUGIN_DATA || process.env.CLEFCUT_HOME || path.join(os.homedir(), '.clefcut');
  const marker = path.join(dir, 'welcomed');
  if (!fs.existsSync(marker)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString() + '\n');
    process.stdout.write(JSON.stringify({ systemMessage: 'ClefCut is installed. Type /clefcut:start to begin.' }) + '\n');
  }
} catch { /* never fail the session */ }
process.exit(0);
