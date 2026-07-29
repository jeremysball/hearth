# Avatar fire-a box-shadow leak: fix and manual verification

## Problem

The Chrome DevTools trace captured at
`/workspace/hearth/user-Trace-20260728T215309.json` shows the avatar as
the dominant paint cost:

- **`SPAN class='avatar cg-avatar'`**: 41,920 `PaintImage` events in a
  10.4s window (39,300 with a `data:image/jpeg` URL, 2,620 without),
  across 8,440 frames — ~4.97 paints per frame on average. This is the
  caregiver-avatar selector, rendered by `js/profile.js:198-199` inside
  the profile/caregiver list (`.cg-avatar` overrides the size to
  38×38 via `styles.css:705`).
- **Next-closest elements**: `.tok.tone-feed` at 8,297 paints,
  `.tok.tone-hygiene` at 4,161, `card.hero.hero-sky` at 4,161,
  `phone.app` at 8,211.
- **Cascade amplifier**: the caregiver avatar lives inside the
  profile screen, so each avatar paint invalidates the ancestor paint
  region — this is why the surrounding container paint counts are
  inflated.

The same `.avatar` rule (`styles.css:216-228`) is also used for the
**home-screen baby avatar** (rendered by `js/home.js:103-104`) and the
**profile-screen baby avatar** (rendered by `js/profile.js:97`). The
home baby avatar is just `.avatar`, not `.avatar.cg-avatar`, but it
inherits the same leaky rule. The trace's 41,920 paints are on the
caregiver variant; the home variant exhibits the same per-frame
re-paint pattern, just under a different selector.

Root cause: `--fire-a` is registered at `:root` via
`@property --fire-a { syntax: '<number>'; inherits: true; … }` and
animated continuously by `body`'s `fire-a 5.3s ease-in-out infinite`
animation. The `.avatar` rule at `styles.css:216-228` reads
`var(--fire-a)` in its `box-shadow`:

```css
box-shadow:
  0 2px 0 oklch(0.97 0.01 80 / 0.4) inset,
  0 4px 14px var(--mat-cast),
  inset 0 1px 0 oklch(1 0 0 / calc(0.25 + var(--fire-a, 0.08) * 1.4));
```

Every animation frame, `--fire-a` ticks, `.avatar` re-computes its
`box-shadow`, and the element is paint-invalidated. Without layer
promotion, the avatar's paint buffer dirties every ancestor whose
paint region contains it — the cascade is the multiplier that turns a
~8k-paint-per-10s baseline into 41,920 on this selector.

The branch `fix/ios-fire-memory-leak` already shipped a related fix
(`22382ec`, "stop a continuous box-shadow transition storm") that
addressed `.tok`'s redundant `box-shadow` transition — but the
avatar's analogous leak (animated `box-shadow` value rather than
redundant transition) was diagnosed by the new trace and is **not yet
fixed on this branch**.

This spec covers the avatar fix and the manual verification that
proves it on the user's iPhone (the device that produced the original
trace). No automated harness — the leak was discovered by hand, on a
real device, and the fix should be verified the same way.

## Approach

**Fix:** move the `--fire-a`-consuming box-shadow from `.avatar` onto
a `::before` pseudo-element. The pseudo has its own paint step; the
parent's paint buffer is no longer dirtied by the `--fire-a` tick; the
cascade to ancestors is broken.

**Hypothesis to verify:** paint-step isolation breaks the cascade.
This is the standard CSS-engine model but is **not established fact
without empirical before/after traces** — treat it as a prediction
the iPhone trace will validate, not a known truth.

**Acceptance criteria** (validated against the user's iPhone trace,
not a CI test):

- **Primary** (caregiver avatar): post-fix `PaintImage` count on
  `SPAN class='avatar cg-avatar'` is `<100` in 10s (vs 41,920
  baseline). This is the trace's actual target. `<100` is the
  conservative floor; expected realistic post-fix number is
  single-digits if the pseudo paints on its own layer, or ~8,440
  (one per frame) if it doesn't get promoted but is at least
  isolated.
- **Primary** (home baby avatar): post-fix `PaintImage` count on
  `SPAN class='avatar'` (without `.cg-avatar`) is `<100` in 10s. The
  same rule, same fix — this confirms the fix generalizes.
- **Secondary suspects** must also drop substantially:
  - `.card.hero.hero-sky` should drop to ≤500 paints/10s (vs 4,161).
    Most of its baseline cost is cascade from the avatar, not its own
    `--fire-a` reads.
  - `phone.app` should drop noticeably (was 8,211; mostly cascade
    from the avatar paint region spilling up the tree).

## File-level changes

### `styles.css`

At `.avatar` (lines 216-228), the rule gains `position: relative`
and loses the third `box-shadow` layer; a new `.avatar::before` rule
follows it that takes over the `--fire-a` consumer.

```css
.avatar {
  width: 48px; height: 48px; border-radius: 50%; flex: 0 0 auto;
  background-image:
    radial-gradient(circle at 30% 20%, oklch(0.97 0.01 80 / 0.5) 0%, transparent 45%),
    radial-gradient(circle at 35% 30%, var(--accent-soft), var(--accent));
  color: var(--on-accent); display: flex; align-items: center; justify-content: center;
  font-family: var(--font-sans); font-size: 20px; font-weight: 700;
  background-size: cover; background-position: center;
  position: relative;                                       /* ← added */
  box-shadow:
    0 2px 0 oklch(0.97 0.01 80 / 0.4) inset,
    0 4px 14px var(--mat-cast);                             /* ← removed: the --fire-a inset layer */
  transition: transform .5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.avatar::before {                                           /* ← added */
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / calc(0.25 + var(--fire-a, 0.08) * 1.4));
}
```

Each line, why:

- **`position: relative` on `.avatar`**: required so the `::before`'s
  `position: absolute; inset: 0` resolves against the avatar's content
  box, not some ancestor.
- **`content: ''` on `::before`**: a pseudo with no `content` doesn't
  exist in the box tree; without this, the rule does nothing.
- **`position: absolute; inset: 0`**: stretches the pseudo to cover
  the avatar's content box pixel-for-pixel, so the inset highlight is
  in the same place visually.
- **`border-radius: inherit`**: the parent is `50%` by default,
  `28px` for `.photo-view .avatar.lg` (line 230). `inherit` makes the
  pseudo's clip-path match automatically — without this, the
  highlight on the 220×220 photo-view fallback variant would render
  as a sharp rectangle inside the rounded square.
- **`pointer-events: none`**: the avatar lives inside `.avatar-btn`
  (line 230) which is the tap target. Without this, the pseudo would
  sit between the tap and the button in the hit-test order.
- **Removed `box-shadow` layer**: the `--fire-a` consumer leaves
  `.avatar`. Its paint buffer is no longer invalidated by the
  `--fire-a` tick.

`.avatar.lg` (line 229), `.avatar-btn:active .avatar { transform }`
(line 230), `.photo-view .avatar.lg` (line 231 — the *fallback
initial* path only; `.photo-view img` is the real-photo path), and
`.cg-avatar` (line 705) are all unchanged — the pseudo works
parameter-free across variants via `inset: 0` and
`border-radius: inherit`.

**Stack-order note:** a positioned `::before` with no `z-index` paints
*above* the parent's normal content by default — that's a stacking
context rule, not a bug. For initial-avatar variants (where the
avatar text is normal-flow content of `.avatar`), the pseudo paints
above the text. The avatar's `text-shadow` declarations still apply
to the text, but the pseudo's box-shadow sits on top of the text in
the visual stack. **Visual verification on real devices is required**
to confirm this matches the pre-fix appearance — if the pseudo
obscures the text or changes the perceived contrast, add `z-index:
-1` to push the pseudo below normal content, or `z-index: 0` +
explicit ordering. Don't ship without the visual check.

**Real-photo path** (`.avatar` with `background-image: url(...)`,
e.g. `js/home.js:103` and `js/profile.js:198`): the pseudo's
`position: absolute; inset: 0` makes it cover the photo exactly. The
photo is rendered as `.avatar`'s background, then the pseudo paints
on top with its `inset 0 1px 0` highlight. Pixel-equivalent to the
pre-fix inset highlight. The `.photo-view img` path
(`js/profile.js` photo view, a separate `<img>` not styled by
`.avatar`) is unaffected.

### `js/changelog.js`

This is a user-visible `fix` per `CLAUDE.md`, so a one-line parent-facing
entry is required in the most-recent dated block:

```
'Stopped the home and caregiver avatars from slowly using up more memory over time, which could eventually cause the app to reload on some phones.',
```

Place it in the existing block at the top of the file alongside the
2026-07-28 entry that mentions the prior memory fix. Skip `js/`
version-bump; the cache buster lives in `index.html` and `sw.js` and is
handled by `scripts/bump-version.sh` (next section).

### `index.html` and `sw.js` (cache buster)

Run `scripts/bump-version.sh` per `CLAUDE.md`. This rewrites
`<meta name="version">` in `index.html` and `const VERSION` in `sw.js`
to the current UTC timestamp. **Do not hand-edit** either string.

## Why a `::before` pseudo instead of the alternatives

- **`prefers-reduced-motion: reduce` gate**: only fixes the leak for
  users who have reduced-motion enabled at the OS level. The user
  hitting the iOS reload problem doesn't have it enabled.
  Defense-in-depth only, not a fix.
- **`data-no-fire` flag**: kill-switch that disables the fire system
  entirely. Useful for opt-out, not for default-case fix.
- **`::before` pseudo**: isolates the `--fire-a` consumer into its
  own paint step, breaks the cascade to ancestors, preserves the
  visual flicker identically. Single CSS-rule change, no JS.

The first two are *kept in mind* as future options (the dev-mode
isolation toggles on the branch already cover
`heroParallax`/`starTwinkle`); neither addresses the default case.

## What does NOT change

- **`.tok` rules** (lines 379-381, 386): the `.tok` transition fix
  from `22382ec` already shipped. The `.tok` element still reads
  `--fire-a` in `box-shadow`, but without the redundant transition
  the leak there is bounded. Not in scope for this spec.
- **`.card`, `.phone`, `.today-add` rules**: they read `--fire-a` in
  `box-shadow` or `radial-gradient`, contributing the secondary
  paint counts (8,297 on `.tok.tone-feed`, 4,161 on
  `.card.hero.hero-sky`, 8,211 on `phone.app`). The acceptance
  criteria above *require* these to drop substantially post-fix;
  the fix targets the avatar, but the cascade is what amplifies the
  avatar's cost into those containers, so they should see material
  improvement. Future investigation can drill into any that remain
  elevated.
- **Dark-mode variants** of the avatar rules — they don't exist;
  `.avatar` has no dark-mode override. Pseudo-element works
  identically in light/dark.
- **The `box-shadow` transition list on `.avatar`** — it's already
  minimal (`transform .5s …` only). Not redundant.
- **Fire keyframes and `@property` declarations** — those define the
  animation itself. The leak is in the *consumers*, not the
  producer.

## Testing

### `node --test js/*.test.js`

Run after the CSS change. The CSS-only change should not affect any
JS unit test; this is a regression gate, not a behavior test for the
fix itself.

### Manual iPhone trace (ground truth)

The leak was discovered by capturing `user-Trace-20260728T215309.json`
on the user's iPhone with Safari DevTools over Web Inspector. That's
the only environment that reproduced the symptom — no headless
Chromium harness, no synthetic profile. The fix's ground-truth
verification is the same procedure, with the fix applied.

**Procedure:**

1. Build the patched PWA in release mode (or run the dev server
   behind the same Tailscale + Web Inspector setup used for the
   original trace).
2. Open it on the same iPhone. Connect via Safari Web Inspector.
3. Open the timeline tab. Click record. Let the page idle for the
   same ~10s window the original trace covered, with the profile
   screen visible (where the caregiver avatar lives). Click stop,
   export the trace as JSON.
4. Save it alongside the original: name it
   `user-Trace-<YYYYMMDDTHHMMSS>.json` in `/workspace/hearth/` (the
   same place the originals live), so the existing analyzer can
   compare before/after without modification.
5. Run `/tmp/trace-summary.py` over both files and diff the
   `.avatar.cg-avatar` row (and the secondary-suspect rows).
6. Acceptance:
   - `.avatar.cg-avatar` `PaintImage` count < 100 in 10s (was
     41,920).
   - `.avatar` (no `.cg-avatar`) `PaintImage` count < 100 in 10s.
   - `.card.hero.hero-sky` `PaintImage` count ≤ 500 in 10s (was
     4,161).
7. If the avatar count is still elevated, drill in: open Safari
   DevTools' Layers panel, confirm `.avatar::before` is on its own
   compositing layer (the `.avatar` parent should be there too
   pre-fix, but post-fix only the pseudo should re-paint on each
   `--fire-a` tick).

The user's iPhone is the merge gate. CI's full Playwright E2E leg
(`.github/workflows/ci.yml`'s `e2e` matrix entry) still runs on every
PR but is not the gate for this particular fix.

### Manual visual check on real iOS device

Open the patched PWA on a real iPhone (the user's iPhone is the
target). Specifically check:

1. The home-screen baby avatar's inset highlight flickers with the
   same intensity and timing as before — pixel-perfect visual
   parity is the design constraint.
2. The profile-screen caregiver avatars' inset highlights look the
   same.
3. Text initials on fallback-avatar variants (no photo) are not
   obscured by the pseudo's box-shadow — confirm readability at
   all three sizes (38×38 caregiver, 48×48 default, 84×84 `.lg`).
4. The 220×220 `.photo-view .avatar.lg` fallback variant (no
   photo) renders the inset highlight with `border-radius: 28px`
   (rounded square), not 50% (circle).
5. Real photo variants (`.avatar` with `background-image: url(...)`)
   show the inset highlight on top of the photo — visually identical
   to pre-fix.

This fix is invisible to the user *except that the page no longer
grows memory*; visual regression is the most likely failure mode.

## Honest gaps in this spec

The spec is a prediction; the trace data after the fix lands will
either confirm or contradict each prediction. Things I am not certain
about, and which the iPhone trace must verify rather than trust:

1. **The cascade-theory prediction** that the parent's paint buffer
   is no longer dirtied by `--fire-a` ticks once the consumer moves
   to a pseudo. This is the standard CSS paint-isolation model but
   engines sometimes promote or de-promote in ways that don't match
   intuition. Treat as a hypothesis; verify with before/after traces.
2. **The expected magnitude of the secondary-suspect drop.** I
   claim `.card.hero.hero-sky` should drop to ≤500, but the
   precise split between "own `--fire-a` reads" and "cascade from
   the avatar" is not derivable from the trace alone without
   isolating each consumer. Set the threshold at 500 conservatively
   and tighten if actual numbers support it.
3. **The `<100` threshold for the avatar.** This is a working
   target, not a measured post-fix number. The realistic floor if
   the pseudo paints on its own layer is single-digits; if not,
   ~8,440 (one per frame) — still vastly better than 41,920.
   Refine the threshold based on actual post-fix captures.
4. **The z-index / stacking interaction** between the pseudo and
   the avatar's text content. The spec lists visual verification as
   required; if any variant shows the pseudo obscuring the text,
   add `z-index: -1` (push the pseudo below normal content) or
   restructure.

## Out of scope

- Fixing the same pattern on `.tok`, `.card`, `.phone`, `.today-add`
  (see "What does NOT change" above). Address only if post-fix
  traces show they remain dominant costs after the avatar fix
  ships.
- Investigating whether the fire-system's 3-keyframe design
  (`fire-a`/`fire-b`/`fire-c` at 5.3s/3.1s/8.7s) is the right
  visual rhythm. The leak fix is orthogonal to the aesthetic
  decision.
- Production telemetry (sampling paint counts on real users in the
  field).
- The `prefers-reduced-motion` defense-in-depth addition. Pair this
  fix with a follow-up commit if the post-fix trace is clean.

## Rollout

1. **Apply the `styles.css` change.**
2. **`scripts/bump-version.sh`** (cache buster in `index.html` and
   `sw.js`).
3. **Add the changelog line** in `js/changelog.js`.
4. **`node --test js/*.test.js`** (unit suite, regression gate).
5. **Open PR.** Branch name `fix/ios-fire-memory-leak` is already
   the PR title; description should clarify: prior commits
   `571cb87` and `c3fb8c2` are dev-mode isolation toggles, `22382ec`
   is the unrelated `.tok` transition fix, the new commit is the
   actual `.avatar::before` leak fix.
6. **After merge** (`gh pr merge <N> --merge --delete-branch`):
   `git pull --ff-only origin main` from whichever checkout has
   `main`, then `git push origin main`. Never leave `main` ahead of
   `origin/main` — this is a hard `CLAUDE.md` rule.
7. **Manual iPhone trace** (merge gate): capture a fresh trace on
   the user's iPhone in the same conditions as the original
   `user-Trace-20260728T215309.json`, confirm the avatar
   `PaintImage` count is now below 100. This is the ground-truth
   validation of the fix — re-run `node --test js/*.test.js` is
   not.
