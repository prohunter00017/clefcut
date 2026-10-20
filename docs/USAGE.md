# ClefCut usage guide

This guide takes you from nothing to your first video review in about 10 minutes. Each step has a command you can copy.

## What you need

- A Remotion 4 project (or let ClefCut make one).
- Node 18 or later (`node --version`).
- A Cloudflare account with Workers AI (it bills the Clef requests to your account).
- An AI coding agent (Claude Code, OpenCode, Codex, Cursor, Gemini CLI, GitHub Copilot, Goose, Amp, MiniMax Code…) or just a terminal.

## Step 1: Get your Cloudflare key

You need two values.

1. **Account ID.** Log in to [dash.cloudflare.com](https://dash.cloudflare.com). The address in your browser looks like `dash.cloudflare.com/1a2b3c…/…`. The 32-character part is your account ID.
2. **API token.** Open [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens), click **Create Token**, choose the **Workers AI** template, then **Continue to summary** → **Create Token**. Copy the token. Cloudflare shows it only once.

## Step 2: Save the key

Make a file named `.env` in the folder `~/.clefcut/`, the ClefCut settings folder in your home directory:

```bash
mkdir -p ~/.clefcut
nano ~/.clefcut/.env
```

Put these lines in it:

```
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
CLEF_MODEL=clef
```

- A `.env` file in your project works too, and wins over `~/.clefcut/.env`. Add `.env` to `.gitignore`, which `clefcut init` does for you.
- Why not `~/.zshrc` or `~/.bashrc`? A token there goes to every program you start from the shell. The `.env` file is read only by ClefCut. Shell variables still work if you prefer them, and they win over the files.
- Never paste the token into the chat with your agent.

## Step 3: Install ClefCut in your agent

Pick your agent. Add `-g` to install it for all your projects instead of one.

| Agent | Command |
|---|---|
| Claude Code (plugin) | In Claude Code: `/plugin marketplace add prohunter00017/clefcut`, then `/plugin install clefcut@clefcut` |
| Claude Code (skill) | `npx skills add prohunter00017/clefcut --skill clefcut -a claude-code` |
| OpenCode | `npx skills add prohunter00017/clefcut --skill clefcut -a opencode` |
| Codex | `npx skills add prohunter00017/clefcut --skill clefcut -a codex` |
| Cursor | `npx skills add prohunter00017/clefcut --skill clefcut -a cursor` |
| Gemini CLI / Antigravity | `npx skills add prohunter00017/clefcut --skill clefcut -a gemini-cli` |
| GitHub Copilot | `npx skills add prohunter00017/clefcut --skill clefcut -a github-copilot` |
| MiniMax Code | `npx skills add prohunter00017/clefcut --skill clefcut -a minimax-code` |
| Goose, Amp, Cline, Kilo, Windsurf, … | `npx skills add prohunter00017/clefcut --skill clefcut -a <agent>` |

**Install by hand.** Copy the folder `.agents/skills/clefcut` from this repo into a folder your agent reads:

| Agent | Project folder | Global folder |
|---|---|---|
| Most agents (OpenCode, Codex, Cursor, Gemini CLI, Copilot, Goose, Amp, MiniMax Code) | `.agents/skills/clefcut` | `~/.agents/skills/clefcut` |
| Claude Code | `.claude/skills/clefcut` | `~/.claude/skills/clefcut` |
| OpenCode (also) | `.opencode/skills/clefcut` | `~/.config/opencode/skills/clefcut` |
| MiniMax Code (also) | `.minimax/skills/clefcut` | `~/.minimax/skills/clefcut` |

**No agent.** Clone the repo and run the tool directly:

```bash
git clone https://github.com/prohunter00017/clefcut ~/clefcut
alias clefcut='node ~/clefcut/bin/clefcut.mjs'     # put this line in ~/.zshrc to keep it
```

In the rest of this guide, `clefcut` means the tool. Inside an agent, the skill tells the agent the exact command: `node <skill folder>/scripts/clefcut.mjs`.

## Step 4: Check the setup

Run this from your Remotion project, or ask your agent: *"Run clefcut doctor."*

```bash
clefcut doctor
```

You want to see:

```
PASS  clef key     CLOUDFLARE_ACCOUNT_ID (…1234) and CLOUDFLARE_API_TOKEN (…abcd) present, model clef
PASS  clef model   Workers AI @cf/cloudflare/clef answered a test question
```

If a line says FAIL, read the `fix:` line under it. The usual causes:
- **401 or 403:** the token has no Workers AI permission, or the account ID is wrong.
- **`clef key` FAIL:** the `.env` file is in the wrong folder.
- **`brand` / `schedule` WARN:** normal until your first video.

## Step 5: Your first review

**1. Make a schedule.** It is a short JSON file with your video's timing, so ClefCut knows what should be on screen and when. Run:

```bash
clefcut init
```

Then fill in `clefcut/schedule.json` (or ask your agent to do it from the composition) and check it:

```bash
clefcut check-schedule
```

**2. Render your video**, for example:

```bash
npx remotion render <composition-id> out/video.mp4 --codec h264 --crf 17 --color-space bt709
```

**3. Review it:**

```bash
clefcut review out/video.mp4
```

**4. Read the result.** It prints a summary and writes a folder `clefcut/qa/review-<time>/`:

| File | What it tells you |
|---|---|
| `review.md` | Each finding with its frame, time, measurement and a picture, then what to do next. |
| `review.json` | The same, as data. Agents read this (`clefcut review out/video.mp4 --json`). |
| `gate/summary.md` | All gate findings; `gate/critic-frames/` holds the frames picked for a closer look. |
| `sweep/summary.md` | What Clef flagged while reading every frame; `sweep/triage.md` says which flags are real. |

| Exit code | Meaning |
|---|---|
| 0 | Pass: nothing to fix. |
| 1 | Findings or open items: fix them, render again, review again. |
| 2 | An error (no key, network, a broken file): the message says how to fix it. |

## The daily loop

| When | Command | Clef cost for 60 s at 30 fps |
|---|---|---|
| Quick check of a draft | `clefcut review out/video.mp4 --no-sweep` | about $0.01 |
| Most drafts | `clefcut review out/video.mp4 --step 3` | about $0.16 |
| Before you deliver | `clefcut review out/video.mp4` (every frame) | about $0.50 |
| The delivery spec | `clefcut deliver-check out/video.mp4 --fix` | free |

Then repeat: fix the code, render, review.

## Tell your agent once

Put this in your Remotion project's `AGENTS.md`. Claude Code reads `CLAUDE.md` instead, so put it there, or write `@AGENTS.md` in `CLAUDE.md`. Every agent then follows the same loop:

```markdown
## Video QA (ClefCut)
- After every render, run ClefCut: `clefcut review out/<name>.mp4 --step 3` for drafts, and `clefcut review out/<name>.mp4` (every frame) before delivery.
- Read review.md (or review.json). Fix every finding in the Remotion code, or in clefcut/schedule.json when a flagged effect is designed. Then render and review again.
- Before handing over a file, run `clefcut deliver-check out/<name>.mp4 --fix`.
- Never print, paste or commit the Cloudflare token.
```

## Choose a model

Set `CLEF_MODEL` in your `.env`.

| Model | When to use it |
|---|---|
| `clef` (default) | Always, unless cost is the only concern. In our test it found every planted defect with high confidence. |
| `clef-flash` | About 6 times cheaper, but it missed a cut-off headline and a render glitch in our test. |
| `clef-omni` | It accepts video and audio, which frame checks don't use. No advantage here. |

## Using MiniMax models

- **MiniMax Code:** install the skill with `-a minimax-code`. MiniMax Code also reads `.agents/skills/` and `.claude/skills/`.
- **MiniMax in Claude Code or OpenCode:** follow MiniMax's guide ([Claude Code](https://platform.minimax.io/docs/m-plan/claude-code.md), [OpenCode](https://platform.minimax.io/docs/m-plan/opencode.md)). In Claude Code you set `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic` and your MiniMax key. Then install ClefCut as usual.
- **MiniMax-M3 / M3.1-Flash** read images, so they can open the critic frames.
- **MiniMax-M2.x** read text only. M2.5 and M2.7 retire on 2026-11-18. ClefCut still works with them, because Clef does the seeing:
  - the agent acts on `review.json`;
  - it asks Clef about any frame with `clefcut ask --images <picture> --question "..."`;
  - it skips the critics' picture review and says so in its report.

## Costs and speed

- Clef bills input tokens only: a 960×540 frame is 513 tokens, so `clef` costs about $0.0002 per frame.
- ClefCut sends one picture per request, 4 at a time (`workers: 4` in `clefcut/clefcut.yaml`). Cloudflare limits the requests per minute on each account. If you see HTTP 429, lower `workers` to 2.
- `clefcut numbers` (part of `review`) writes the measured cost and an estimate of what an Opus critic review would have cost.

## Ask Clef your own question

```bash
clefcut ask --images "clefcut/qa/<run>/gate/img/*.png" --question "Is any text cut off by the edge of the frame?" --control cut
```

ClefCut makes a control from your own frame: the same frame with a planted defect. If Clef misses the defect in the control, the run is marked unreliable, so a "no" is never trusted blindly.

## Troubleshooting

| Problem | Fix |
|---|---|
| `No Cloudflare key` | Put `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `~/.clefcut/.env` (Step 2). |
| `Cloudflare rejected the key (HTTP 401)` | Make a new token with the Workers AI template. Check the account ID. |
| HTTP 429 | Too many requests: set `workers: 2` in `clefcut/clefcut.yaml`, then run again. |
| `ffmpeg … not found` | Run `npm install` in your Remotion project (ClefCut uses Remotion's ffmpeg). |
| The video is shorter than the schedule | A `frame_count` finding: render the whole composition, or fix `frames` in the schedule. |
| A designed flash or glitch shows as a finding | Declare it in `effects` in `clefcut/schedule.json`, and list it in `motion.designed` in the brand. |

More: [troubleshooting reference](../skills/qa/reference/troubleshooting.md).

## Command cheat sheet

| Command | What it does |
|---|---|
| `clefcut review <video>` | The whole QA in one command (`--step N`, `--no-sweep`, `--no-clef`, `--json`). |
| `clefcut doctor` | Checks Node, ffmpeg, the Cloudflare key, the model, OCR, brand and schedule. |
| `clefcut init` | Makes `clefcut/schedule.json`, `clefcut/clefcut.yaml` and the Remotion helper. |
| `clefcut check-schedule` | Checks the schedule (and the brand's copy rules). |
| `clefcut brand from-url <URL>` / `from-folder <DIR>` / `set <file>` / `use <name>` | Makes and loads your brand. |
| `clefcut gate <video>` | Measures every frame and asks Clef about prepared pictures. |
| `clefcut sweep <video>` | Clef reads every frame (`--step N`, `--range A-B`). |
| `clefcut triage <sweep-folder>` | Explains or asks again about what the sweep flagged. |
| `clefcut ask --images <glob> --question "..."` | One yes/no question to Clef, with a control. |
| `clefcut deliver-check <video> --fix` | Checks and fixes the delivery spec. |
| `clefcut numbers` | The cost and the savings card. |
| `clefcut splice plan|apply` | Changes a few seconds of a delivered video without rendering it all. |
