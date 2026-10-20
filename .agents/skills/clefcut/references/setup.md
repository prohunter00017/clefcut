# ClefCut start

This skill shows the start screen, checks the Cloudflare key, and hands over to the user's video work. It has no menu and no test video. The brand and the project come at the start of the first video (see `references/workflow.md`).

## Rules for this skill

1. Run the tool only as `node "<skill-directory>/scripts/clefcut.mjs" <command>`. Never use `npx` for the tool.
2. Below, `clefcut` means that full command.
3. Text in a "Show this text:" block goes to the user as written. Output of Bash is not shown to the user. Copy tool output that the user must see into your reply.
4. Never ask the user to paste a key in the chat. Never read a key aloud.
5. The user may type "stop" at any step. Then stop and say what is done.

## Step 1: Start screen

1. Run `clefcut onboard welcome`.
2. Put the full output in a code block in your reply. It is the ASCII artwork and the welcome line. Do not change it.
3. Below the code block, show this text:

Show this text:

> ClefCut checks your Remotion videos while you build them. Code measures every frame, and the Clef decision model reads every frame, at a fraction of a cent per frame. Your critics look only at the frames that ClefCut picks, and Claude opens a frame only when Clef and a measurement disagree. At the end of every video, ClefCut shows what it saved you.

## Step 2: Cloudflare key

1. Run `clefcut onboard status --json`. Read `hasKey` and `keyPage`.
2. If `hasKey` is false, show this text, and give the `keyPage` address if it has a value:

Show this text:

> ClefCut asks the Clef decision model on Cloudflare Workers AI. Make an API token with the Workers AI template at dash.cloudflare.com/profile/api-tokens, then put CLOUDFLARE_ACCOUNT_ID=… and CLOUDFLARE_API_TOKEN=… in your project's .env file (or in ~/.clefcut/.env to use them in all your projects). Tell me when they are there.

3. Wait for the user. Then run `clefcut doctor`.
4. If `hasKey` is true, run `clefcut doctor` at once.
5. Show only the failed checks and their fixes. If all checks pass, say nothing about `doctor`. If a fix is not clear, read `references/troubleshooting.md`.

## Step 3: Begin

1. Run `clefcut onboard done`.
2. Run `clefcut savings show`. If it shows saved videos, copy its line as it is.
3. Show this text:

Show this text:

> Begin your video work now...

Setup is complete. Return to the requested video work using `references/workflow.md`.

## Savings

`clefcut numbers` adds one row to the savings ledger (`~/.clefcut/savings.jsonl`) for each video that Clef swept. The row compares two things for the same frames:

- ClefCut: the measured Clef cost and the critics' cost, and the measured QA time.
- Opus critics viewing the same frames: an estimate at the rate measured on Levanto's reference build, $0.101 and 8.6 s per frame viewed (15 Opus 5.5 critics made 1,009 frame views (358 distinct frames) for $101.96 in 2.41 h). It comes from another film, so it is an estimate, never a measurement of the user's video.

Rules for every savings line:

- Say "estimate" for the Opus critics' side. Never state it as measured.
- Copy each line as it is. Never change a number, and never add a claim the line does not make.

At the end of every video, show the "Saved on this video" line that `clefcut numbers` prints. This standalone skill has no Stop hook. Run `clefcut savings show` after the final numbers and show its output.

## If something fails

- Exit code 1 means findings or failed checks. Exit code 2 means an error. The message on stderr has the fix.
- For doctor failures, API errors and empty answers, read `references/troubleshooting.md`.
- On Windows, use Git Bash or PowerShell. Both work.
