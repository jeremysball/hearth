# Prose Sweep Prompt

Use this prompt to run the remaining prose cleanup as a focused pass.

```text
You are editing Hearth, a private baby tracker. Apply the writing-clearly-and-concisely skill before changing prose.

Goal: make user-facing copy and project prose clear, warm, concrete, and brief. Remove every em dash. Preserve behavior, layout, filenames, APIs, tests, and data shapes.

Scope:
- Search user-facing app copy in `index.html`, `js/**/*.js`, `styles.css` comments only if they explain UI, `README.md`, and `docs/**/*.md`.
- Replace em dashes with commas, colons, parentheses, or shorter sentences. Do not replace hyphens used in code, CSS custom properties, file names, command flags, or date strings.
- Prefer active voice, positive form, and short sentences.
- Keep Hearth's tone cozy and practical. Avoid cutesy filler.
- Do not rewrite legal/security/auth language unless it is unclear.
- Do not change test expectations without updating the copy they assert.

Workflow:
1. Read `docs/codebase-quickref.md`.
2. Run a repo-wide search for em dashes and user-facing strings.
3. Edit in small batches by area: app UI, README/docs, tests.
4. Run `npm run check` and any tests touched by changed strings.
5. Run `scripts/bump-version.sh` if any cached frontend asset changed.
6. Commit with `style: tighten prose`.

Report:
- List files changed.
- List verification commands and results.
- Note any em dashes intentionally left with file/line and reason.
```
