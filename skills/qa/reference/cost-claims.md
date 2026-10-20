# Cost claims

Use this file whenever you write about QA cost, QA time or savings. The results card follows the same rules.

## Rule 7 in full

For cost claims, use API list prices and measured usage.

1. Read the cache rate from the Claude Code session files. Do not guess it.
2. Do not put numbers from two different videos together. One exception, always labelled: the Opus critics' side of the savings line is the reference rate from Levanto's own build, applied to the user's frames (see "What is an estimate").
3. Report image views and different images as two numbers. A critic can view one image many times.
4. Do not claim a saving against a cost that nobody measured.
5. Costs use API list prices.

## What is measured

| Number | Source |
|---|---|
| Frames that Clef read | The sweep and gate runs. |
| QA time | The tool records the seconds of each command. |
| Clef cost | The text tokens (`billed_input_tokens`) plus the `image_tokens` in the run files, at the input rate of the Clef model in the run file (clef $0.24, clef-flash $0.038, clef-omni $0.15 per million tokens; Clef charges no output tokens). A frame at 960×540 is 513 image tokens. |
| Critics' tokens and cost | The tool sums the usage of sub-agents that start with `CLEFCUT-CRITIC-<run-id>`. It removes repeated messages by message id and prices them at API list prices, with the measured cache split. |
| Frames that Claude opened | The number of entries in `opened.json`. |

## What is an estimate

The old review of the user's video is not measured. The card estimates it at the reference rate: Opus 5.5 critics viewing the same frames that Clef read, at $0.101 and 8.6 s per frame viewed. The rate was measured on Levanto's reference build (a Levanto case-study film, 2026-10-01): 15 Opus 5.5 image critics made 1,009 frame views (358 distinct frames) for $101.96 at Claude API list prices, and ran for 2.41 h of clock time (agents that ran in parallel count once). It is a rate from another film, scaled linearly to the frames Clef read, so the card says "estimate" and names the source.

ClefCut's time is the time of its commands plus the critics' time. The critics' time is the sum of each critic's running time, not the clock time while they ran in parallel. That is the high side of ClefCut's time, so the time saved is on the low side.

A user who wants a rate from their own video can measure one: `baseline prepare` and `baseline measure` time one critic on 10 frames of this video. Pass the folder with `clefcut numbers --baseline <dir>`. Then that rate replaces the reference rate.

An estimate always has:

1. The word "estimate".
2. Its method, for example "at the rate measured on Levanto's reference build" or "from 10 measured frames".
3. The unit it scales by, for example "per frame that Clef read".

## How the card is built

1. `clefcut numbers` writes `clefcut/qa/numbers.json` and `clefcut/qa/card.md`.
2. Show `card.md` as it is. Do not change a number.
3. The card has three parts:
   1. ClefCut (measured): the frames that Clef read, the QA time, the Clef cost, the critics' cost and the frames that Claude opened.
   2. The old review of the same frames (estimate at the reference rate, or from a measured baseline): the time and the cost at API list prices. It states them for each frame that Clef read.
   3. The defects that ClefCut found, and the corrections.
4. The card compares the same frames on both sides. It does not compare ClefCut with a review that nobody measured.

## What you must not write

- A saving in dollars against a review that nobody ran.
- A total made from the cost of one video and the frame count of another.
- "Same quality" as a claim. The house rules and the measurements show what was checked. They do not prove that two reviews have the same quality.
- A cost with no source file.
- A number typed by hand. Each on-screen number about the QA comes from `numbers.json`.

## Good and bad examples

Good form: copy the "Saved on this video" line that `clefcut numbers` prints. It reads: "Saved on this video: about $[S] and [T] (estimate). ClefCut: $[X] in [Y] (measured). Opus critics viewing the same [N] frames: about $[O] in [P] (estimate at the rate measured on Levanto's reference build, Claude API list prices)." Each value comes from `numbers.json`. Never type a value that the file does not give.

Bad: "ClefCut saves 90% of review cost." There is no source and no method.
