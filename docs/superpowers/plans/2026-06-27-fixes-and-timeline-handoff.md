# Sonnet Handoff Brief — Fixes & Timeline

> **Note:** Historical handoff brief — the plan it supervises (`2026-06-27-fixes-and-timeline.md`) is COMPLETE on `main`. Kept for reference, not actionable.

**Date:** 2026-06-27 · **Planner:** Opus · **Executor-supervisor:** Sonnet (you, next)
**Plan:** `docs/superpowers/plans/2026-06-27-fixes-and-timeline.md`

**Verdict:** ~95% delegation-ready. All 5 soft spots are now triaged; one was pinned to
exact (Task 1 Step 3), the rest are correctly yours (supervisor-inline) — none block the
opencode runs from starting.

## START HERE
1. **Load the `delegating-to-opencode` skill before anything else.** It governs run
   sizing, the detached-`tmux` launch (including the `--` end-of-options marker before
   the prompt), cheap monitoring, and the final QA pass. This brief is *what* to
   delegate; that skill is *how*.
2. Do the **supervisor-inline** items yourself — opencode cannot.
3. Delegate the **opencode-delegatable** tasks per the run-split.
4. The final QA pass is yours, in your own session — separate from anything opencode
   self-reports. opencode's "looks correct" is not evidence.

## The 5 soft spots — resolved

| # | Item | Tier | Resolution |
|---|---|---|---|
| 1 | **Task 1 Step 3** — `normalizeSettings` call site (was prose "call it where `_state` is hydrated") | **opencode-delegatable now** | **PINNED.** Plan prose was wrong — `load()` merges into local `s`, not `_state`, and has no `_state` assignment. Rewritten to an exact find/replace adding `normalizeSettings(s.settings);` before `return s;`. No diagnosis left. |
| 2 | **Task 3** — desktop date autofill (reproduce-first, fix unspecified) | **supervisor-inline** | Cannot be pre-pinned without the live repro; do **not** let opencode guess. Diagnose with `run`/`verify` (Step 1), then apply the minimal fix. Strengthened hypothesis below to speed Step 1. |
| 3 | **Task 2 Step 3** — slider glass re-tune | **supervisor-inline (visual)** | opencode pastes the CSS in Steps 1–2; you do the screenshot pass and tune glare opacity by eye. Not pinnable — needs eyes. |
| 4 | **Task 5 Step 7** — verify medicine card live (incl. multi-med picker) | **supervisor-inline (live QA)** | Your look, not opencode's self-report. |
| 5 | **Task 7 Step 7** — verify Timeline live | **supervisor-inline (live QA)** | Your look, not opencode's self-report. |

**Task 3 sharpened hypothesis (for your Step 1, not a pinned fix):** `nowLocalDT()`
(`js/ui.js:313`) returns a correct full `YYYY-MM-DDTHH:MM`, and the `value="${nowLocalDT()}"`
attribute injection at template-build time (`js/sheets.js:239,245`) looks correct — so the
repro should focus on path (c): the control is re-rendered/replaced after injection, or a
desktop-Chromium quirk where the date pane only populates when `value` is set as a
*property* after `sheet.open()`. If so, the likely-minimal fix mirrors `prefill()`
(`js/sheets.js:320`): set `$('#f-time').value = nowLocalDT()` imperatively right after the
sheet opens, rather than relying solely on the attribute. **Confirm the live root cause
before applying — this is reproduce-first.**

## Run-splitting (per `delegating-to-opencode`: one session/phase, ≤~8 tasks / ≤200k tok)

| Run | Tasks | Notes |
|---|---|---|
| Phase 1 | 1–2 | Mechanical. **Task 3 is yours (supervisor-inline)** — diagnose + pin it around this phase; opencode does not touch Task 3. |
| Phase 2 | 4–5 | Task 5 Step 7 is your live look. |
| Phase 3 | 6–7 | Task 7 Step 7 is your live look. |

**Version-bump scope:** every Fixes commit touches cached frontend assets (`js/`,
`index.html`) → bump `index.html` + `sw.js` to the same UTC timestamp before each commit.
**Exception:** Task 6 Step 5 explicitly defers its bump to Task 7 (timeline ships in one PR).

**In every opencode launch prompt:** the `run`/visual/live steps are yours, not
opencode's; opencode runs the Playwright + `node --test` + `npm run check` suites it *can*
and must state plainly it cannot visually confirm.

## Pre-resolve before launching
- ~~Task 1 Step 3 pinned to exact.~~ **DONE.**
- Task 3 — diagnose live and pin/apply before or during Phase 1. Reproduce-first; the
  planner cannot pin this blind.

## Codebase facts verified (Opus, 2026-06-27)
- `load()` (`js/store.js:30`) returns a local merged `s`; the pinned edit targets `s.settings`.
- `normalizeSettings` is added as an exported helper in Task 1 Step 3 (same file) — the call site resolves.
- `nowLocalDT` `js/ui.js:313`; `timeRow`/`FORMS` `js/sheets.js:239,243`; `prefill` `js/sheets.js:319`.
