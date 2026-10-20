# SageCut

House-standard QA for Remotion videos, in your brand, with every frame checked by the Clef decision model on Cloudflare Workers AI.

SageCut is available as a Claude Code plugin and a standalone skill. You build your video with Remotion and Claude. SageCut then:

1. measures every frame in code (text size, blank frames, frozen frames, off-brand colours, delivery spec),
2. has the Clef decision model read every frame and answer yes/no questions,
3. sends only the frames it selects to the critics,
4. opens a frame itself only when Clef and a measurement disagree.

It ships with a set of house rules (a quality floor) and reads your brand file for everything above that floor. If you have no brand, it helps you riff on a style.

SageCut does not change your render time. It makes the review step faster and cheaper.

## Install

### Standalone skill via skills.sh

[View SageCut on skills.sh](https://skills.sh/levantolabs/sagecut-release/sagecut).

Run this from your Remotion project:

```bash
npx skills add levantolabs/sagecut-release --skill sagecut -a claude-code
```

Add `-g` to install for all your Claude Code projects. Then ask Claude Code: "Use SageCut to review my Remotion video at out/video.mp4."

The skill includes the CLI, OCR runtime and language data, question banks, templates, and QA references. Setup and savings reporting run through the skill; this install does not register plugin hooks. The full workflow and critic cost accounting require Claude Code. The Cloudflare key below is needed for full frame review; `gate --no-clef` runs local measurements only.

The standalone skill lives in [`.agents/skills/sagecut`](.agents/skills/sagecut). The `start` and `qa` components under `skills/` belong to the Claude plugin and are hidden from normal skills CLI discovery.

### Claude Code plugin

In Claude Code, run two commands:

```
/plugin marketplace add levantolabs/sagecut-release
/plugin install sagecut@levantolabs
```

Or one command (Claude Code 2.1.275 or later):

```
/plugin install sagecut --marketplace levantolabs/sagecut-release
```

## First run with the plugin

Type this in Claude Code:

```
/sagecut:start
```

You get the SageCut start screen, a short explainer and a check of your Cloudflare key. Then: "Begin your video work now...". There is no menu and no test video.

At the start of your first video, SageCut asks for your brand (your website, a brand kit folder, five questions, or a riff on something you like). After that, the `qa` skill starts by itself when you render, review or deliver Remotion work.

## Savings after every video

At the end of every video, SageCut shows what it saved:

```
Saved on this video: about $S and T (estimate). SageCut: $X in Y (measured).
Opus critics viewing the same N frames: about $O in P (estimate at the rate measured on Levanto's reference build, Claude API list prices).
```

SageCut's side is measured: the Clef cost (text and image tokens at the model's rate), the critics' cost and the QA time. The Opus side is an estimate: $0.101 and 8.6 s per frame viewed, the rate of the 15 Opus 5.5 critics on Levanto's reference build (1,009 frame views (358 distinct frames), $101.96, 2.41 h). `sagecut savings show` gives the totals.

## Requirements

- Claude Code.
- Node 18 or later.
- A Remotion 4 project. If you have none, SageCut can make one with `npx create-video@latest` at the start of your first video.
- A Cloudflare account ID and an API token with the Workers AI permission (see below). Never paste them in the chat.

SageCut needs no Python, no separate ffmpeg and no OCR program. It uses the ffmpeg that Remotion 4 includes, and OCR runs in Node. It works on macOS, Linux and Windows (x64).

## The Clef decision model

SageCut asks its questions to a Clef model on Cloudflare Workers AI. Put these lines in your project's `.env` file, or in `~/.sagecut/.env` to use them in all your projects:

```
CLOUDFLARE_ACCOUNT_ID=...    # the 32-character ID in your dashboard address
CLOUDFLARE_API_TOKEN=...     # dash.cloudflare.com/profile/api-tokens → Create Token → "Workers AI" template
CLEF_MODEL=clef              # optional: clef (default), clef-flash or clef-omni
```

Run `sagecut doctor` to check the key and the model.

| Model | Input price per million tokens | Use |
|---|---|---|
| `clef` (27B) | $0.24 | The default. Found every planted defect in our test frames, with high confidence. |
| `clef-flash` (9B) | $0.038 | Cheaper and faster, but it missed a cut-off headline and a render glitch in the same test. |
| `clef-omni` (30B MoE) | $0.15 | Works, but its video and audio input adds nothing to frame checks. |

Clef does not charge for output tokens. A 960×540 frame is 513 input tokens, so `clef` costs about $0.0002 per frame. The savings line prices each run at the model it used.

How SageCut uses Clef:

- One picture and its questions per request. `sweep` runs `workers` requests at a time (4 by default). Workers AI limits the request rate per account.
- Clef returns the probability of "yes". SageCut counts P(yes) between 0.4 and 0.6 as unsure (a null answer); the gate escalates those.
- A scale question returns a probability-weighted level, which the gate compares with the pass line.
- The token estimate before a `gate` run is counted locally from the picture sizes, so `--max-billed` works before any request.
- Check the questions on your own video with `sagecut triage`, which tests each question on a planted defect.

## Who this is for

- People who already make Remotion videos, and want a house-rules check on each render.
- People new to Remotion can start with `/sagecut:start`. SageCut can create a project at the start of the first video. You still need to know what a Remotion composition is. The schedule file describes the timing of that composition.

## Not supported in 0.3

- **Camera footage.** SageCut 0.3 is tested on motion graphics only. It is not tested on camera footage. The frozen-frame and colour checks may behave differently on camera footage.

## What is in the box

| Part | What it does |
|---|---|
| `/sagecut:start` | Start screen, short explainer and the Cloudflare key check. |
| `qa` skill | The project and brand step before the first video, the QA workflow, the house rules and the savings line after every video. Starts on Remotion render and review work. |
| `bin/sagecut.mjs` | The tool: `doctor`, `brand`, `init`, `check-schedule`, `gate`, `sweep`, `triage`, `ask`, `baseline` (optional: a rate from your own video), `numbers`, `deliver-check`, `splice`. |

## Privacy

- Every frame of a checked video goes to Cloudflare Workers AI for reading by Clef. Nothing else goes there. `--no-clef` runs the measurement checks with no upload.
- Your `.env` file and your Cloudflare token never leave your machine, except as the token that authenticates your own requests to Workers AI.
- Raw API traffic is stored in `sagecut/qa/*/raw/`. SageCut adds this folder to your `.gitignore`.
- Your saved brands stay in `~/.sagecut/brands/` on your machine.

## License

MIT. Copyright (c) 2026 Levanto Labs. See [LICENSE](LICENSE).

## Packaging the standalone skill

`npm run build` builds the CLI and regenerates the portable package. To refresh the portable package from the already built release files, run `npm run package:skill`.

The packager copies the release runtime and reference material, and adapts the setup and QA instructions for standalone use. Maintain those sources in `bin/`, `assets/`, `templates/`, and `skills/`; generated files under `.agents/skills/sagecut/runtime/` and `references/` should be refreshed with the packager. The portable entrypoint and launcher are maintained directly.
