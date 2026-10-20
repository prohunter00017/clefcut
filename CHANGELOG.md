# Changelog

## 0.4.0: ClefCut (fork of SageCut 0.3.0)

ClefCut is a fork of [SageCut](https://github.com/levantolabs/sagecut-release) by Levanto Labs.

**Renamed.** The command is `clefcut`, the Claude Code plugin is `clefcut` (`/clefcut:start`), the project folder is `clefcut/` (`clefcut/clefcut.yaml`, `clefcut/schedule.json`), the settings folder is `~/.clefcut/`, and the environment variables are `CLEFCUT_*` (`CLEFCUT_HOME`, `CLEFCUT_FFMPEG`, `CLEFCUT_FFPROBE`, `CLEFCUT_DEBUG`, `CLEFCUT_ROOT`).

**Clef decision model.**
- The decision model is now Clef on Cloudflare Workers AI. The Sage API, `SAGE_API_KEY` and the Sage plans are gone.
- Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. `CLEF_MODEL` picks `clef` (the default), `clef-flash` or `clef-omni`.
- Clef reads one picture per request, `workers` requests at a time. A request that fails becomes an error for that picture's questions only; a rejected key stops the run. Each request times out after 90 s.
- The token estimate before a `gate` run is counted locally and calibrated on live billing.
- Renamed in the run files: `gate --no-sage` is `--no-clef`, the `sage_*` fields are `clef_*`, the `sage` block is `clef` (with the `model` it used), and the triage label `cleared-by-sage` is `cleared-by-clef`. `doctor` reports `clef key` and `clef model`.

**New.**
- `clefcut review <video>` runs the whole QA in one command (gate, sweep, triage, numbers). It writes `review.md` and `review.json`, and `--json` prints the findings for agents.
- The standalone skill works in any agent that reads Agent Skills: OpenCode, Codex, Cursor, Gemini CLI, GitHub Copilot, Goose, Amp, MiniMax Code and others. It has a neutral runtime path (`CLEFCUT_ROOT`) and fallbacks for agents without sub-agents and for models without image input.
- `AGENTS.md` (with `CLAUDE.md`) for agents that work on this repo, and a step-by-step [usage guide](docs/USAGE.md).
- `sweep_bank` in `clefcut.yaml` for a project sweep question file. `question_bank` stays the gate file.

**Fixed.** Every fix below has a regression test.
- Sweep:
  - A frame whose questions failed no longer counts as read.
  - A frame that cannot be extracted no longer crashes the run.
  - An empty `--range` or a bad `--pmin` is an error.
- Triage:
  - Declared `effects` explain glitch flags; the brand list alone no longer hides every glitch.
  - Transitions get the documented 15-frame tolerance.
  - Long glitch runs are left to measure instead of being cleared.
  - The video must be the one the sweep read.
  - A control of `none` works.
- Numbers:
  - Frames read is the union of the sweeps.
  - A run passed twice counts once.
  - The ledger row names the swept video.
- Savings ledger: a torn line no longer erases the ledger, and writes are atomic.
- Gate:
  - A render shorter than its schedule is a finding and no longer crashes the gate or passes.
  - The paper colour is no longer taken from frame 0, so a fade from black no longer hides blank frames.
  - Evenly spaced pops far apart are no longer dropped as a cadence.
  - Critic frames for single-frame findings are correct; they were all frame 0.
  - The OCR worker is always closed, so the CLI no longer hangs.
  - Beat holds and every documented `static_holds` form are honoured.
  - Allowed edge contact covers the last pixels.
  - Rotated videos and videos under 5 frames work.
  - Findings no longer share ids or pictures.
  - A missing ffmpeg is a clear error.
  - `--json` includes `clef_errors` and `notes`.
  - Text with `{braces}` in it works.
  - A numeric `order` no longer crashes the gate.
  - OCR skips `image_regions` as documented.
  - The reading-order levels are no longer cut short at their first comma.
- Setup:
  - `.env` inline comments are not part of the value.
  - An empty template line never wipes a key.
  - `brand:` with no value no longer crashes every command.
  - The Stop hook never exits 2, which blocks the agent.
  - `--root=DIR` works.
  - `init`'s skeleton ends on the last frame.
- Brand:
  - `from-url` skips broken image URLs and keeps hyphenated names.
  - `from-folder` keeps two logos with the same file name.
  - `brand use` works in another project (the saved brand carries its own logo and fonts).
  - A font that fails leaves no broken font file.
  - List fields are validated.
- Delivery:
  - `deliver-check --fix` no longer hides an OCR failure.
  - Loudness parsing survives `{` in a file name and silent audio.
  - `splice plan` warns about B-frames, and the splice proof is documented in full.
  - `fmtSeconds` never prints "60 s".

**From SageCut after 0.3.0.** The standalone skill for the skills CLI, `npm run package:skill`, and the plugin's `start` and `qa` components marked internal.

## 0.3.0 (SageCut)

First public release of SageCut by Levanto Labs.

- `/sagecut:start`: the start screen, a short explainer and the Sage key check. Then you begin your video work.
- The `qa` skill: the project and brand step before the first video (website, brand kit folder, five questions, or a riff on something you like), the QA workflow with the house rules, three critics on the frames that SageCut selects, and a savings line at the end of every video.
- The `sagecut` tool for Node 18 or later on macOS, Linux and Windows x64: `doctor`, `init`, `brand`, `check-schedule`, `gate`, `sweep`, `triage`, `ask`, `baseline`, `numbers`, `deliver-check`, `splice`. It uses the ffmpeg that Remotion 4 includes, and OCR runs in Node.
- Tested on motion graphics only.
