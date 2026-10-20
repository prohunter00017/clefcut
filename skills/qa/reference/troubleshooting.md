# Troubleshooting

Start with `clefcut doctor`. It checks each item below and prints the fix for each failure.

## Doctor failures

| Failure | Cause | Fix |
|---|---|---|
| Node version | Node is older than 18. | Install Node 18 or later from nodejs.org. Restart Claude Code. |
| ffmpeg or ffprobe not found | The project has no Remotion 4 install, or `node_modules` is missing. | Run `npm install` in the project. Check that `@remotion/compositor` for your platform is in `node_modules`. |
| No Cloudflare key | `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_API_TOKEN` is not in `.env`. | Make an API token with the Workers AI template at dash.cloudflare.com/profile/api-tokens. Put `CLOUDFLARE_ACCOUNT_ID=...` and `CLOUDFLARE_API_TOKEN=...` in the `.env` file in the project root, or in `~/.clefcut/.env` for all projects. A value in the project wins. Do not paste the token in the chat. |
| Clef model failed | The test question to Workers AI failed. | Check the network and any proxy, and that `CLEF_MODEL` is clef, clef-flash or clef-omni. Try again in a minute. See "Clef API errors". |
| OCR not ready | The OCR language data is missing or blocked. | See "OCR missing". |
| No brand file | `clefcut/brand.yaml` does not exist. | Run `/clefcut:start`, or `clefcut brand use <NAME>`. |
| No schedule | `clefcut/schedule.json` does not exist. | Run `clefcut init`. |
| Not a Remotion project | No `remotion` in `package.json`. | Run the tool from the project folder, or use `--root <dir>`. To make a project, run `npx create-video@latest`. |

## Clef API errors

| Code | Meaning | Fix |
|---|---|---|
| 401 or 403 | The token is wrong, expired or missing, it lacks the Workers AI permission, or the account ID is wrong. | Check `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `.env`. Check that the lines have no spaces or line breaks. Make a new token with the Workers AI template if needed. |
| 413 | The picture is too large (Clef takes up to 4 MiB per image). | Use a smaller width. |
| 429 | Too many requests. | Wait, then run the command again. Lower `workers` in `clefcut/clefcut.yaml` (for example to 2). Workers AI limits the requests per minute for each account. |
| 504 | The server timed out. | Run the command again. If it keeps failing, lower `workers` and try again later. |

The tool retries some of these errors by itself. If a command stops with an error, the one-line message on stderr has the fix.

## Null or empty answers

Clef gives a probability for every question. ClefCut counts P(yes) between 0.4 and 0.6 as no answer (null).

1. Do not treat null as "no defect".
2. Run the question again for those frames. Use `clefcut ask`.
3. If it is still null, check the image: it can be empty, too small or corrupt.
4. If the control gives null, the run is unreliable. A measurement decides.
5. Do not trust one answer from one run. A measurement decides each open item.

## OCR missing

OCR uses tesseract.js with language data that the plugin includes. It needs no network.

1. Run `clefcut doctor`. Read the OCR line.
2. If the data file is missing, the plugin install is incomplete. Update the plugin: `/plugin marketplace update clefcut`, then `/plugin install clefcut@clefcut`.
3. Security software can remove or block generated files. Check the quarantine list. Allow the plugin folder.
4. Without OCR, the text-height and text-match checks do not run. Report this to the user. Do not call the QA complete.

## Other problems

| Problem | Fix |
|---|---|
| Warning about a missing audio stream | Set `audio: none` in `clefcut/clefcut.yaml` if the video is silent on purpose. Set `audio: required` if sound is a must. |
| The composition cannot import `clefcut/schedule.json` | Set `"resolveJsonModule": true` in `compilerOptions` of `tsconfig.json`. |
| `src/brand.ts` cannot find `@remotion/fonts` | Run `npx remotion add @remotion/fonts`. |
| The gate costs too much, or Clef is not reachable | Use `clefcut gate <video> --no-clef` for measurements only, `--no-ocr` to skip OCR, or `--max-billed N` to cap the Clef input tokens. The QA is then not complete. Say so in the report. |
| A designed flash or cut shows as a finding | Declare it in `cuts` or `effects` in `schedule.json`. The brand alone does not suppress it. |

## Render problems

| Problem | Fix |
|---|---|
| Black frames in imported footage | You trimmed past the end of the clip, or you used a wrong prop. Use `trimBefore` only. |
| Fonts look wrong | Use local font files in `public/fonts/`. A headless render cannot load web fonts. |
| An element is missing from frame 0 | Put the reveal in its own local `<Sequence>`. |
| Colour looks washed out | The render is full range. Render with `--color-space bt709`, or run `deliver-check --fix`. |
| The render is slow or stuck | Another render may use the same machine. Add `--timeout 120000 --concurrency 4` to your own render. Do not stop processes that you did not start. |

## Windows notes

1. ClefCut works on Windows x64. It does not work on Windows on ARM, because Remotion supports only x64 on Windows.
2. Claude Code runs shell commands in Git Bash or in PowerShell. Both work with the commands in these skills.
3. The path in `${CLAUDE_PLUGIN_ROOT}` uses forward slashes. Keep the quotes around the tool path.
4. If the path of the project has spaces, quote it in `--root`.
5. Do not use `npx` to run the tool. Use `node "${CLAUDE_PLUGIN_ROOT}/bin/clefcut.mjs"`.
6. No Python, ffmpeg or OCR program is needed.

## macOS and Linux notes

1. Linux needs the system libraries that Remotion needs for its headless browser. Install them if the render fails on start. See the Remotion documentation for the list.
2. On macOS, allow the terminal to access the project folder if a command cannot read files.

## Still stuck

1. Run `clefcut doctor --json` and read the failing items.
2. Read the one-line error on stderr. It has the fix.
3. Tell the user what failed, what you tried, and what they can do.
