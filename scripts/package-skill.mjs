// Package the existing release runtime as a self-contained skills.sh skill.
// Only runtime/, references/, and the two copied licence files are generated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skill = path.join(root, '.agents', 'skills', 'clefcut');
const runtime = path.join(skill, 'runtime');
const references = path.join(skill, 'references');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function replaceRequired(text, from, to) {
  if (!text.includes(from)) throw new Error(`Portable skill source changed; update the adapter for: ${from}`);
  return text.replaceAll(from, to);
}

function portableBody(file) {
  return read(file)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\s*/, '')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}/bin/clefcut.mjs', '<skill-directory>/scripts/clefcut.mjs')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}/skills/qa/reference/', 'references/')
    .replaceAll('`reference/', '`references/');
}

const version = JSON.parse(read('package.json')).version;
const entry = read('.agents/skills/clefcut/SKILL.md').replace(/(  version: ")[^"]+("\r?$)/m, (_, prefix, suffix) => `${prefix}${version}${suffix}`);
let setup = portableBody('skills/start/SKILL.md');
setup = replaceRequired(setup, "The brand and the project come at the start of the first video (the `qa` skill).", 'The brand and the project come at the start of the first video (see `references/workflow.md`).');
setup = replaceRequired(setup, "Stop here. The `qa` skill takes over when the user starts, renders, reviews or delivers a Remotion video.", 'Setup is complete. Return to the requested video work using `references/workflow.md`.');
setup = replaceRequired(setup, 'At the end of a turn, the Stop hook shows "ClefCut this session" when a video was swept since the last line. If that line does not appear, run `clefcut savings show` and show its output.', 'This standalone skill has no Stop hook. Run `clefcut savings show` after the final numbers and show its output.');

let workflow = portableBody('skills/qa/SKILL.md');
workflow = replaceRequired(workflow, 'follow the `start` skill (`/clefcut:start`) first', 'read and follow `references/setup.md` first');
workflow = replaceRequired(workflow, 'The `start` skill does not do them.', 'The setup flow does not do them.');
workflow = replaceRequired(workflow, 'For the first two options, ask the user if they have the right to use the brand files.', 'Reuse the brand information and approvals already supplied for this project.');
workflow = replaceRequired(workflow, 'Use three sub-agents: a craft critic, a clarity critic and a freshness critic. Start all critics in parallel. Use the sonnet model unless the user asks for another.', 'Use three independent critics for full QA: craft, clarity, and freshness. Start them as sub-agents when your agent can and the task permits it, following the user’s model preference. Without sub-agents, do the three passes yourself, one after the other, on the selected frames only, and report that the critics were not independent. If your model cannot see images, skip the critic passes, use `clefcut ask` where a frame would be opened, and report that the frame review was done by Clef and the measurements only. Never invent reviews or token usage.');

const referenceDocs = new Map(fs.readdirSync(path.join(root, 'skills', 'qa', 'reference'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => [name, portableBody(`skills/qa/reference/${name}`)]));
let troubleshooting = referenceDocs.get('troubleshooting.md');
troubleshooting = replaceRequired(troubleshooting, 'Start with `clefcut doctor`.', 'For full review, start with `clefcut doctor`. For local measurements only, skip the Clef checks and use `gate --no-clef`.');
troubleshooting = replaceRequired(troubleshooting, 'Run `/clefcut:start`, or `clefcut brand use <NAME>`.', 'Follow the brand section in `references/workflow.md`, or run `clefcut brand use <NAME>`.');
troubleshooting = replaceRequired(troubleshooting, 'language data that the plugin includes', 'language data included in `runtime/assets/`');
troubleshooting = replaceRequired(troubleshooting, 'If the data file is missing, the plugin install is incomplete. Update the plugin: `/plugin marketplace update clefcut`, then `/plugin install clefcut@clefcut`.', 'If the data file is missing, the skill install is incomplete. Reinstall with `npx skills add prohunter00017/clefcut --skill clefcut -a <agent>` (for example `-a claude-code`, `-a opencode`, `-a codex`, `-a cursor`, `-a minimax-code`) in the original installation scope (add `-g` for a global install).');
troubleshooting = replaceRequired(troubleshooting, 'Security software can remove or block generated files. Check the quarantine list. Allow the plugin folder.', 'Security software can remove or block files. Inspect its report and the affected file before deciding how to restore the installation.');
troubleshooting = replaceRequired(troubleshooting, 'The path in `${CLAUDE_PLUGIN_ROOT}` uses forward slashes. Keep the quotes around the tool path.', 'Replace `<skill-directory>` with the actual installed skill directory. Keep the quotes around the tool path.');
referenceDocs.set('troubleshooting.md', troubleshooting);
referenceDocs.set('question-bank.md', replaceRequired(referenceDocs.get('question-bank.md'), 'The plugin includes two question files in `assets/bank/`.', 'The skill includes two question files in `runtime/assets/bank/`.'));

// Read required inputs before replacing any generated output.
for (const source of ['bin/clefcut.mjs', 'bin/ocr/worker.cjs', 'assets/eng.traineddata', 'templates/useSchedule.ts', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  fs.accessSync(path.join(root, source), fs.constants.R_OK);
}
fs.rmSync(runtime, { recursive: true, force: true });
fs.rmSync(references, { recursive: true, force: true });
fs.mkdirSync(runtime, { recursive: true });
for (const dir of ['bin', 'assets', 'templates']) {
  fs.cpSync(path.join(root, dir), path.join(runtime, dir), { recursive: true });
}
fs.mkdirSync(references, { recursive: true });
for (const [name, body] of referenceDocs) fs.writeFileSync(path.join(references, name), body);
fs.writeFileSync(path.join(references, 'setup.md'), setup);
fs.writeFileSync(path.join(references, 'workflow.md'), workflow);
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  fs.copyFileSync(path.join(root, file), path.join(skill, file));
}
fs.writeFileSync(path.join(skill, 'SKILL.md'), entry);
console.log(`Packaged ClefCut ${version} at .agents/skills/clefcut (runtime, OCR assets, templates, references, licences).`);
