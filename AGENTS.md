# AGENTS.md: working on ClefCut

Instructions for coding agents (and people) changing this repository. Users of ClefCut want [docs/USAGE.md](docs/USAGE.md) instead.

## What this is

ClefCut is a Node CLI (ESM, Node 18+, no runtime dependencies once built) that does QA on Remotion videos. It measures every frame with ffmpeg and OCR (tesseract.js), and asks yes/no and scale questions to the Clef decision model on Cloudflare Workers AI. It is a fork of SageCut by Levanto Labs.

## Layout

| Path | What |
|---|---|
| `src/cli.mjs` | Command router. Each command is `src/commands/<name>.mjs` exporting `help` and `run(argv, { root, config })`. |
| `src/core/clef.mjs` | The Clef client (`ClefClient`), request/answer mapping, token estimate, prices. The only file that talks to Cloudflare. |
| `src/core/env.mjs` | `.env` loading (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLEF_MODEL`). |
| `src/gate/` | The gate: frame series measurements, frame checks, OCR text checks, the Clef round (`bank.mjs`), critic frame selection. |
| `src/sweep/` | Sweep, triage and controls (synthetic defects made from the user's frames). |
| `src/commands/review.mjs` | `clefcut review`: gate + sweep + triage + numbers. Uses `runGate`, `runSweep`, `runTriage`, `runNumbers`. |
| `assets/bank/` | The gate (YAML) and sweep (JSON) question banks. |
| `skills/` | The Claude Code plugin skills (`start`, `qa`) and the reference docs. |
| `.agents/skills/clefcut/` | The standalone skill for every agent. `SKILL.md` and `scripts/clefcut.mjs` are edited by hand; `runtime/`, `references/` and the licence copies are generated. |
| `bin/clefcut.mjs` | The built bundle. Generated: never edit it by hand. |
| `test/unit/` | `node --test` suites. |

## Commands

```bash
npm install          # dev dependencies (esbuild, tesseract.js, yaml)
npm test             # all unit tests; must stay green
npm run build        # checks the docs, bundles src/ into bin/clefcut.mjs, repackages .agents/skills/clefcut
node src/cli.mjs <command>   # run from source
```

## Rules

1. **Tests first.** For a bug, write a test that fails for the reported reason, then fix it. Run the whole suite before you finish.
2. **No network in tests.** Mock `globalThis.fetch` for Cloudflare (see `test/unit/clef.test.mjs` `withFetch`), and isolate settings with `CLEFCUT_HOME` pointing to a temp folder. Never call the real Workers AI API from a test, and never read the developer's `~/.clefcut/.env`.
3. **Match the code around you.** Dense, small modules; short comments that say why; no new runtime dependencies.
4. **Exit codes:** 0 pass, 1 findings, 2 error. An error answer from Clef is never a pass.
5. **Docs agree with code.** `scripts/check-docs.mjs` runs in the build: one version everywhere (`package.json`, `src/core/version.mjs`, `.claude-plugin/*.json`, the skills' `metadata.version`), three critics, the install address from `plugin.json`, the reference rate from `src/core/costs.mjs`, and "tested on motion graphics only".
6. **The standalone package** is made by `scripts/package-skill.mjs`, which rewrites some sentences of `skills/` for agents without the plugin (`replaceRequired`). If you change one of those sentences, update the packager too, or the build fails.
7. **Secrets:** never print, log or commit `CLOUDFLARE_API_TOKEN`. `doctor` masks it to the last 4 characters.
8. After changing `src/`, run `npm run build` so that `bin/clefcut.mjs` and `.agents/skills/clefcut/runtime/` match the source before you commit.
