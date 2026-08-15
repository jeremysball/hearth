## Conventions
- Commits: Conventional Commits (`type(scope): description`, imperative
  mood). Mark breaking changes with `!` after type/scope and/or a
  `BREAKING CHANGE:` footer. Never add a `Co-Authored-By` trailer.
- Search: use `fd` for files, `rg` for text — never `find`/`grep`.
- Runtimes/tools: use `mise` for language runtimes and CLI tools, pinned to
  exact versions in `.mise.toml`. Python packages: use `uv`
  (`uv add`/`uv pip install`), never bare `pip install`, and pin every
  version explicitly rather than letting the resolver choose.
- Paths: never hardcode an absolute path (`/home/...`, `/Users/...`, a
  specific username/hostname) in code, scripts, or config meant to run
  anywhere but here. State/cache/config/data files follow the XDG Base
  Directory spec (`XDG_STATE_HOME`/`XDG_CACHE_HOME`/`XDG_CONFIG_HOME`/
  `XDG_DATA_HOME`, defaulting to `~/.local/state`, `~/.cache`,
  `~/.config`, `~/.local/share`), never a bare `~/.<appname>` dotfile dir,
  and always honor an explicit env-var override where one exists.
- Errors: fail fast. Never swallow an exception behind a broad try/except
  that logs and continues — let it surface. When a check can't reliably
  determine a fact, report it as failed/unknown rather than guessing a
  plausible-but-wrong value.
- Verification: proving something works means exercising it for real (an
  actual read, request, or spawn) — not just confirming it's listed,
  present, or covered by a mock. A green test suite that fakes the real
  boundary (network call, subprocess spawn, filesystem write) your change
  touches is not proof that boundary works; exercise it directly before
  claiming done.
- Reporting: your final message is read by someone who will not open the
  files you touched. Quote the 3-10 relevant lines inline with a `path:line`
  above them rather than citing a path and stopping. Paste the real output
  of any command you ran rather than describing what it printed. Say why the
  code has the shape it does, not only what you changed. Assume there is no
  follow-up question coming, so anything a reader would have to ask for
  belongs in the report.

## Task: review a written design spec (not code yet)

You are acting as an independent design/architecture advisor for a small
vanilla-JS PWA baby tracker app ("Hearth": no framework, ES modules in
`js/`, single `index.html`, Go+SQLite backend). Read
`docs/codebase-quickref.md` first for the app's real architecture and
patterns, then read the spec at
`.superpowers/specs/2026-08-15-dogfood-solids-nav-design.md` in full.

The spec covers three bundled changes: (1) a new "solids" feeding log type
with per-food amount/reaction/allergy tracking, a food picker, fal.ai-
generated food icons, and a foods-tried rollup view; (2) a bottom-tab-bar
restructure merging Growth+Trends into one "Insights" tab and promoting the
day-log to its own "Timeline" tab; (3) a copy-only diaper label rename.

Review it as a design/architecture advisor, not an implementer — you are
not writing code or editing files. Look specifically for:
- Feasibility problems given the actual codebase patterns you find in
  `js/store.js`, `js/sheets.js`, `js/app.js`, `js/growth.js`, `js/trends.js`
  (e.g. does the "reuse existing render functions" plan for the merged
  Insights tab actually work given how those views currently manage state,
  animation hooks, or DOM IDs; does the `foods` JSON-array-on-entry storage
  plan fit how `normalizeLog`/sync/derive currently work).
- Gaps or contradictions the spec's own self-review might have missed.
- Anything genuinely underspecified that would block an implementer (not
  the two items the spec explicitly and deliberately defers — the exact
  curated food list and the exact icon set — those are intentional).
- Whether bundling these three into one spec/plan is actually reasonable
  vs. should be split.

Do not propose a full rewrite or add scope. Report findings as a ranked
list: what's wrong or risky, why, and what you'd change. End with a
`Task quality:` line summarizing the spec's overall readiness, then a line
starting `Status:` with one of `Approved | Needs fixes`.
