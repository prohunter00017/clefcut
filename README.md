# ClefCut

House-standard QA for Remotion videos, in your brand, with every frame checked by the Clef decision model on Cloudflare Workers AI. It works with Claude Code, OpenCode, Codex, Cursor, Gemini CLI, GitHub Copilot, Goose, Amp, MiniMax Code and other agents that can run a command.

> ClefCut is a fork of [SageCut](https://github.com/levantolabs/sagecut-release) by Levanto Labs. It keeps SageCut's QA design. It replaces the Sage API with Cloudflare Workers AI Clef, adds a one-command review, works in many agents, and fixes many bugs. See [CHANGELOG.md](CHANGELOG.md).

You (or your AI agent) build a video with Remotion. ClefCut then:

1. measures every frame in code (text size, cut-off text, blank frames, frozen frames, glitches, off-brand colours, delivery spec),
2. has the Clef decision model read every frame and answer yes/no questions,
3. sends only the frames it selects to the critics,
4. opens a frame itself only when Clef and a measurement disagree.

It ships with a set of house rules (a quality floor) and reads your brand file for everything above that floor. ClefCut does not change your render time. It makes the review step faster and cheaper: about $0.0002 per frame.

**New here? Read the step-by-step [usage guide](docs/USAGE.md).**

## Quick start

**1. Get a Cloudflare key.**
- **Account ID:** the 32-character ID in your dashboard address, `dash.cloudflare.com/<account-id>/…`.
- **API token:** [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → the **Workers AI** template.

**2. Save the key** in `~/.clefcut/.env`, to use it in all your projects. You can also use a `.env` file in your project, but never commit it.

```
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
CLEF_MODEL=clef
```

**3. Install it in your agent** (see the table below). For example:

```bash
npx skills add prohunter00017/clefcut --skill clefcut -a opencode
```

**4. Check the setup.** Ask your agent to run `clefcut doctor`. Both the `clef key` and `clef model` lines must say PASS.

**5. Review a video.** Ask your agent: *"Use ClefCut to review out/video.mp4."* Or run it yourself:

```bash
clefcut review out/video.mp4
```

## Install in your agent

| Agent | Install |
|---|---|
| **Claude Code** (plugin, with hooks and `/clefcut:start`) | `/plugin marketplace add prohunter00017/clefcut`, then `/plugin install clefcut@clefcut` |
| **Claude Code** (skill only) | `npx skills add prohunter00017/clefcut --skill clefcut -a claude-code` |
| **OpenCode** | `npx skills add prohunter00017/clefcut --skill clefcut -a opencode` (it also shows up as `/clefcut`) |
| **Codex** | `npx skills add prohunter00017/clefcut --skill clefcut -a codex` |
| **Cursor** | `npx skills add prohunter00017/clefcut --skill clefcut -a cursor` |
| **Gemini CLI / Antigravity** | `npx skills add prohunter00017/clefcut --skill clefcut -a gemini-cli` |
| **GitHub Copilot** | `npx skills add prohunter00017/clefcut --skill clefcut -a github-copilot` |
| **MiniMax Code** | `npx skills add prohunter00017/clefcut --skill clefcut -a minimax-code` |
| **Goose, Amp, Cline, Kilo, Windsurf, …** | `npx skills add prohunter00017/clefcut --skill clefcut -a <agent>` |
| **No agent / any shell** | `git clone https://github.com/prohunter00017/clefcut`, then `node clefcut/bin/clefcut.mjs <command>` |

Add `-g` to install for all your projects. The skill is a folder, [`.agents/skills/clefcut`](.agents/skills/clefcut), which most agents read without any extra step. The usage guide lists the folder each agent reads.

## What a review gives you

`clefcut review <video>` runs four steps:
1. **gate** measures every frame and asks Clef about about 20 prepared pictures;
2. **sweep** has Clef read every frame;
3. **triage** explains the sweep's flags with the schedule, or asks Clef again with a control;
4. **numbers** works out the cost and the savings.

It writes these files in `clefcut/qa/review-<time>/`:

| File | What it is |
|---|---|
| `review.md` | The summary: findings with frame, time, evidence and picture, then what to fix next. |
| `review.json` | The same as data, for agents (`clefcut review … --json` prints it). |
| `gate/` | The gate details, the pictures and `critic-frames/`. |
| `sweep/` | The sweep and triage details. |

Exit code 0 means pass, 1 findings, 2 an error. Use `--step 3` or `--no-sweep` for a quick check of a draft, and the full review on the file you deliver.

## Models and cost

| `CLEF_MODEL` | Price per million input tokens | In our test (7 frames with planted defects) |
|---|---|---|
| `clef` (27B), the default | $0.24 | 9 of 10 right; found every planted defect with high confidence. |
| `clef-flash` (9B) | $0.038 | 8 of 10; missed a cut-off headline and a render glitch. |
| `clef-omni` (30B MoE) | $0.15 | 7 of 10; its video and audio input adds nothing to frame checks. |

Clef charges no output tokens. A 960×540 frame is 513 input tokens, so `clef` costs about $0.0002 per frame: about $0.50 to read every frame of a 60-second video. Clef reads one picture per request. Cloudflare limits the requests per minute on each account, so a full sweep of a long video takes minutes.

## Models without image input

Clef does the seeing. So an agent whose model cannot read images (for example MiniMax-M2.x) can still run the full QA:
- it acts on the findings in `review.json`;
- it asks Clef about any frame with `clefcut ask`;
- it skips the picture review by the critics, and says so in its report.

## Savings after every video

At the end of every video, ClefCut shows what it saved:

```
Saved on this video: about $S and T (estimate). ClefCut: $X in Y (measured).
Opus critics viewing the same N frames: about $O in P (estimate at the rate measured on Levanto's reference build, Claude API list prices).
```

ClefCut's side is measured: the Clef cost (text and image tokens at the model's rate), the critics' cost and the QA time. The Opus side is an estimate: $0.101 and 8.6 s per frame viewed, the rate of the 15 Opus 5.5 critics on Levanto's reference build (1,009 frame views (358 distinct frames), $101.96, 2.41 h). `clefcut savings show` gives the totals.

## Requirements

- An agent that can run shell commands, or just a terminal.
- Node 18 or later.
- A Remotion 4 project. If you have none, ClefCut can make one with `npx create-video@latest` at the start of your first video.
- A Cloudflare account ID and an API token with the Workers AI permission. Never paste them in the chat.

ClefCut needs no Python, no separate ffmpeg and no OCR program. It uses the ffmpeg that Remotion 4 includes, and OCR runs in Node. It works on macOS, Linux and Windows (x64).

## First run with the Claude Code plugin

Type `/clefcut:start` in Claude Code. You get the ClefCut start screen, a short explainer and a check of your Cloudflare key. Then: "Begin your video work now...". There is no menu and no test video. At the start of your first video, ClefCut asks for your brand (your website, a brand kit folder, five questions, or a riff on something you like). After that, the `qa` skill starts by itself when you render, review or deliver Remotion work.

## Not supported in 0.4

- **Camera footage.** ClefCut 0.4 is tested on motion graphics only. It is not tested on camera footage. The frozen-frame and colour checks may behave differently on camera footage.

## What is in the box

| Part | What it does |
|---|---|
| `bin/clefcut.mjs` | The tool: `review`, `doctor`, `brand`, `init`, `check-schedule`, `gate`, `sweep`, `triage`, `ask`, `baseline`, `numbers`, `deliver-check`, `splice`, `savings`. |
| `.agents/skills/clefcut` | The standalone skill for any agent, with the runtime, OCR data, question banks and references. |
| `skills/start`, `skills/qa` | The Claude Code plugin's start screen and QA workflow. |
| `docs/USAGE.md` | The step-by-step usage guide. |

## Privacy

- Every frame of a checked video goes to Cloudflare Workers AI for reading by Clef. Nothing else goes there. `--no-clef` runs the measurement checks with no upload.
- Your `.env` file and your Cloudflare token never leave your machine, except as the token that authenticates your own requests to Workers AI.
- Your saved brands stay in `~/.clefcut/brands/` on your machine.

## Developing

`npm install`, `npm test` (no network: the tests mock Cloudflare) and `npm run build`. The build bundles `src/` into `bin/clefcut.mjs` and repackages the standalone skill. Agents working on this repo: read [AGENTS.md](AGENTS.md).

## License

MIT. Copyright (c) 2026 Levanto Labs (SageCut) and prohunter00017 (ClefCut changes). See [LICENSE](LICENSE).
