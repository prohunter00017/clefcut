# Changelog

## Unreleased

- The decision model is now Clef on Cloudflare Workers AI. The Sage API, `SAGE_API_KEY` and the Sage plans are gone. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; `CLEF_MODEL` picks `clef` (default), `clef-flash` or `clef-omni`.
- Renamed for Clef: `gate --no-sage` is `--no-clef`; in the run files, `sage_*` fields are `clef_*`, the `sage` block is `clef` (with the `model` it used), and the triage label `cleared-by-sage` is `cleared-by-clef`. `doctor` reports `clef key` and `clef model`.
- One request per picture, `workers` at a time. A failed picture becomes an error for its own questions only; a rejected key stops the run.
- Fixed: the reading-order levels in the gate bank were cut short at their first comma.
- Added a standalone `sagecut` skill for the skills CLI, with the release runtime, OCR assets, templates, and QA references included.
- Added `npm run package:skill`; `npm run build` now refreshes that package too.
- Marked the plugin's `start` and `qa` components internal to normal skills CLI discovery.

## 0.3.0

First public release.

- `/sagecut:start`: the start screen, a short explainer and the Sage key check. Then you begin your video work.
- The `qa` skill: the project and brand step before the first video (website, brand kit folder, five questions, or a riff on something you like), the QA workflow with the house rules, three critics on the frames that SageCut selects, and a savings line at the end of every video.
- The `sagecut` tool for Node 18 or later on macOS, Linux and Windows x64: `doctor`, `init`, `brand`, `check-schedule`, `gate`, `sweep`, `triage`, `ask`, `baseline`, `numbers`, `deliver-check`, `splice`. It uses the ffmpeg that Remotion 4 includes, and OCR runs in Node.
- Tested on motion graphics only.
