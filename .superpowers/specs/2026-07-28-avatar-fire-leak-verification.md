# Avatar fire paint investigation and verification

## Status

Implemented in commit `8eab525` on `fix/ios-fire-memory-leak`.

This document records the observed problem, the CSS change, what the available traces do and do not establish, and the verification still required. It must not present browser paint-layer behavior as proven without a same-tool before-and-after capture.

## Problem

The registered custom property `--fire-a` is inherited and animated continuously:

```css
@property --fire-a {
  syntax: '<number>';
  inherits: true;
  initial-value: 0.06;
}

body {
  animation:
    fire-a 5.3s ease-in-out infinite,
    fire-b 3.1s ease-in-out infinite,
    fire-c 8.7s ease-in-out infinite;
}
```

Before the fix, `.avatar` consumed `--fire-a` in one layer of its `box-shadow`:

```css
.avatar {
  box-shadow:
    0 2px 0 oklch(0.97 0.01 80 / 0.4) inset,
    0 4px 14px var(--mat-cast),
    inset 0 1px 0 oklch(1 0 0 / calc(0.25 + var(--fire-a, 0.08) * 1.4));
}
```

Each interpolated change to `--fire-a` changed the avatar's computed shadow. Because `box-shadow` is paint-affecting, this made the avatar eligible for paint invalidation on animation ticks.

The `.avatar` rule is shared by:

- the Home baby avatar in `js/home.js`
- the Profile baby avatar in `js/profile.js`
- caregiver avatars with the additional `.cg-avatar` class in `js/profile.js`
- fallback avatars in the baby-photo sheet

Views are not kept mounted offscreen. Navigation replaces `#view.innerHTML`, so Home and Profile avatars do not coexist in a hidden view tree.

## Pre-fix evidence

`user-Trace-20260728T215309.json` is a Chrome/Perfetto trace with a `traceEvents[]` schema. It contains:

- 101,970 total `PaintImage` events
- 41,920 `PaintImage` events attributed to `SPAN class='avatar cg-avatar'`
- 8,297 attributed to `SPAN class='tok tone-feed'`
- 8,211 attributed to `MAIN class='phone app'`
- 5,474 attributed to `NAV class='tabbar'`
- 4,161 attributed to `DIV class='card hero hero-sky'`

The caregiver-avatar events occur during a bounded interval of about 10.4 seconds inside the larger trace, at roughly 2,900 to 4,500 events per second during active seconds.

These counts establish that the browser repeatedly performed image-paint work attributed to caregiver avatars. They do not, by themselves, prove:

- that every event represents a displayed frame
- that ancestor paint counts were caused by the avatar
- that retained paint buffers caused memory growth
- that the pseudo-element change creates a compositing layer

Do not divide the 41,920 events by compositor bookkeeping events and call the result "paints per rendered frame." The trace contains hundreds of compositor events per second, so those events are not equivalent to display refreshes.

## Fix

The animated shadow layer was moved from `.avatar` to `.avatar::before`:

```css
.avatar {
  position: relative;
  box-shadow:
    0 2px 0 oklch(0.97 0.01 80 / 0.4) inset,
    0 4px 14px var(--mat-cast);
}

.avatar::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 1px 0
    oklch(1 0 0 / calc(0.25 + var(--fire-a, 0.08) * 1.4));
}
```

The static avatar box now has a stable `box-shadow`. Only the pseudo-element's shadow depends on `--fire-a`.

Supporting declarations preserve behavior:

- `position: relative` makes the avatar the containing block.
- `content: ''` creates the pseudo-element box.
- `position: absolute; inset: 0` covers the avatar.
- `border-radius: inherit` follows circular and rounded-square variants.
- `pointer-events: none` prevents the overlay from affecting hit testing.

## Mechanism: hypothesis, not established fact

Moving the animated shadow to `::before` changes the browser's paint object and invalidation bookkeeping. It may let the engine repaint or cache the animated overlay separately from the avatar's background image and static shadows.

However, a pseudo-element does not automatically create:

- a compositing layer
- a paint-containment boundary
- a guarantee that ancestor paint regions remain valid

No `contain: paint`, `isolation`, `will-change`, or explicit layer-promoting transform was added. Therefore the claim that the pseudo "breaks the cascade" is a hypothesis about the observed engine behavior, not a property guaranteed by CSS.

A trace may also attribute pseudo-element painting differently from ordinary element painting. The disappearance of `.avatar` records can mean less work, changed attribution, or both. Verification must inspect total paint behavior and related selectors, not only search for the string `avatar`.

## Post-fix evidence currently available

Two post-fix captures exist, both Safari Web Inspector timeline exports with the `recording.records[]` schema:

`_tmp_really-after-fix.json`, captured on Home only, approximately 21.06 seconds, 13,094 records:

- 7,705 `paint` records (~366 paints/sec)
- 984 `invalidate-layout`, 964 `layout`
- 552 `invalidate-styles`, 548 `recalculate-styles`
- 459 `composite`
- 3 garbage-collection records
- 0 records whose `domNodeCSSPath` contains `avatar`

`_tmp_really-after-fix-with-profile.json`, captured with the Profile/caregiver view open, approximately 33.2 seconds, 14,512 records:

- 3,727 `paint` records (~112 paints/sec)
- 1,774 `invalidate-layout`, 1,730 `layout`
- 1,439 `invalidate-styles`, 1,437 `recalculate-styles`
- 1,344 `composite`
- 0 garbage-collection records
- 12 records whose `domNodeCSSPath` includes an avatar-bearing ancestor: 6 on `div.card.prof-baby` and 6 on `div#cg-list.card.row-card`. All 12 are `css-animation` events. None are `paint` events.

Safari's DOM attribution reports the full parent chain. Where Chrome attributes work to the leaf `SPAN class='avatar cg-avatar'`, Safari attributes to the ancestor container that contains the avatar. The two tools therefore cannot be compared leaf-for-leaf.

Important consequence: in `_tmp_really-after-fix-with-profile.json`, the avatar-bearing ancestor containers accumulated 12 records over 33 seconds, all CSS-animation activity. There were no `paint` records attributed to either container. That is direct evidence on the same view that produced the pre-fix `41,920 PaintImage` baseline.

The captures are useful evidence that:

- Safari, in two different views, does not attribute paint work to the avatar itself or to its immediate ancestors.
- The ancestor containers of avatars on Profile carry only `css-animation` bookkeeping, not paint work.

They do not directly establish:

- that paint work has dropped in absolute terms (different tools, different attribution rules);
- that the avatar's pseudo-element is on its own compositing layer;
- that ancestor paint regions no longer re-rasterize.

Consequently, the defensible statement is:

> The pre-fix Chrome trace attributed heavy repeated image-paint work to caregiver avatars. In two later Safari post-fix captures (Home only, and Profile with caregiver rows visible), Safari attributed no paint records to avatar-bearing DOM paths. The result is consistent with the avatar no longer being a primary paint cost on those views, but a same-tool before-and-after comparison is still the rigorous test.

The post-fix traces also do not directly measure process memory. The 3 garbage-collection records on Home and 0 on Profile suggest no obvious GC churn during these short captures, but they do not prove that long-term memory growth is eliminated.

## Verification requirements

### A. Same-tool performance comparison

For a valid quantitative comparison, capture both sides with the same browser, inspector, view, interaction sequence, and approximate duration.

Because the pre-fix source state is available in Git, use two isolated builds:

1. Pre-fix: parent of `8eab525`.
2. Post-fix: `8eab525` or its descendant.
3. Use the same iPhone and the same inspector for both captures.
4. Start on the same view with the same data.
5. Record at least 15 seconds of idle time after rendering settles.
6. Repeat three times per build to distinguish a stable effect from capture noise.
7. Do not run the two builds from one mutable checkout. Use separate worktrees or immutable deployment versions.

For Profile verification, ensure caregiver rows are visible. For Home verification, ensure the baby avatar is visible. Report the views separately.

Normalize counts as events per second over the settled comparison window. Report at least:

- all paint events
- image-paint events, if the tool exposes them
- style invalidations and recalculations
- layout invalidations and layouts
- composite activity
- records attributed to `.avatar`, `.avatar::before`, `.cg-avatar`, and immediate ancestors where available

If the inspector does not expose pseudo-element paths, state that limitation instead of treating missing avatar paths as zero work.

### B. Acceptance and failure criteria

The fix passes the performance check when all of the following hold across the median of three matched runs:

1. Avatar-attributed image-paint rate drops by at least 90 percent, or the inspector no longer attributes avatar work and total paint rate drops materially.
2. Total paint rate does not increase.
3. No new selector becomes a similarly dominant paint source because attribution moved.
4. Layout and style-recalculation rates do not materially regress.
5. The browser remains responsive during the same interactions.

The fix fails when any of the following occurs:

- total paint work remains effectively unchanged and only attribution changes;
- pseudo-element or ancestor records replace the former avatar count at a similar rate;
- visual behavior regresses;
- memory still grows during the long-duration check.

Do not use an uncalibrated absolute threshold such as `<100 events in 10s`. Inspector event counts are implementation-specific. Prefer matched rate reductions and total-work checks.

### C. Long-duration memory check

Paint traces do not prove memory stability. Run a separate long-duration check on the affected iPhone:

1. Use the same production-like build and data.
2. Keep the relevant view active for at least 30 minutes.
3. Record process memory or inspector heap measurements at regular intervals if available.
4. Exercise the same interactions that previously led to reloads.
5. Confirm that the app does not reload and that memory does not show sustained unbounded growth.

A short trace can support the paint diagnosis. Only a long-duration observation can support the user-facing claim that the app no longer consumes increasing memory or reloads.

### D. Visual and interaction checks

Check on a real iPhone:

1. Home baby avatar with a photo.
2. Home baby avatar with an initial.
3. Profile baby avatar at large size.
4. Caregiver avatar with a photo.
5. Caregiver avatar with an initial.
6. The rounded-square fallback in the photo sheet.
7. Tap and active-state behavior on avatar buttons.
8. Light and dark themes.

Confirm that the pseudo-element does not obscure initials and that its inherited radius matches every avatar shape.

## Analyzer requirements

Do not run one trace parser blindly over both files.

- Chrome/Perfetto input: read `traceEvents[]` and classify events such as `PaintImage`, `Paint`, and `UpdateLayer`.
- Safari Web Inspector input: read `recording.records[]` and classify `eventType`, `domNodeCSSPath`, and timestamps.

A comparison tool must detect the schema, fail explicitly on an unsupported format, and normalize rates by the selected time window. Returning zero events for an unrecognized schema is a parser failure, not evidence of zero browser work.

Keep raw profiler exports outside the repository or in an explicitly ignored local trace directory. They are investigation records, not source files, and untracked files in the repository interfere with PR tooling.

## Project verification

The implementation already includes:

- the CSS change
- a parent-facing changelog entry
- the required cache-buster update via `scripts/bump-version.sh`

Before merging, run:

```bash
node --test js/store.test.js
```

Run the relevant avatar and navigation Playwright suites sequentially if such suites exist. Rely on CI for the full Playwright matrix as required by the project rules.

## Claims permitted in the PR

Permitted:

- The pre-fix Chrome trace attributed 41,920 `PaintImage` events to caregiver avatars during its active interval.
- The avatar's animated fire-dependent shadow was moved to a pseudo-element, leaving the avatar's own shadow static.
- Two post-fix Safari captures contained no `paint` records attributed to avatar-bearing DOM paths. The Profile capture included caregiver rows and reported only 12 `css-animation` records across `div.card.prof-baby` and `div#cg-list.card.row-card`.
- The Safari result is consistent with reduced avatar paint invalidation.

Not yet permitted without matched captures or a long-duration test:

- The fix reduced avatar paints from 41,920 to zero.
- The pseudo-element is on its own compositing layer.
- The pseudo-element guarantees paint containment.
- Ancestor paints were caused by the avatar and have now disappeared.
- The memory leak is conclusively eliminated.
- The app can no longer reload because of this issue.
