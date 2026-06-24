# ADR 0002: Pull-to-refresh, chart enter animations, and spinner haptics

- **Status:** Accepted
- **Date:** 2026-06-24
- **Context:** Three small, independent interaction-polish features, brainstormed together because they were raised together, not because they share code: (1) a manual pull-to-refresh gesture, since the PWA's `"display": "standalone"` manifest mode suppresses the browser's native pull-to-refresh entirely, leaving installed users with no way to force a sync; (2) "fill up"/"draw on" enter animations for the app's bar charts, sleep ring, and growth line, which currently render with their final values already baked into the initial paint, so the one pre-existing `transition: height .4s` on `.bar` has never actually animated anything; (3) per-row haptic feedback on the value-picker spinner, matching the tactile feel of an iOS `UIPickerView`.

Each section below is a separable decision: decision, context, consequences, alternatives considered.

---

## 1. Pull-to-refresh: custom pointer-event gesture, not native or library

**Decision:** Implement pull-to-refresh as a custom `pointerdown`/`pointermove`/`pointerup` gesture in `js/app.js`, following the same house pattern already used for long-press-to-edit (Task #3 punch list) and drag-to-reorder (Task #13). Scoped to all 5 tabs at the router level (the gesture listens on `.screen`, not per-view), so every view gets it for free and there's no per-view wiring to maintain.

**Context:** Two alternatives were ruled out before this one was seriously considered:
- *Native browser pull-to-refresh* — does nothing in this PWA's primary use case. Standalone-display-mode PWAs (`manifest.webmanifest`'s `"display": "standalone"`) suppress the browser chrome's native pull-to-refresh on both iOS Safari and Android Chrome. Native PTR also reloads the entire document rather than calling the app's existing `syncOnce()`, which would lose SPA state.
- *A pull-to-refresh library* — contradicts the project's "no framework" rule; nothing about this gesture needs a dependency the codebase doesn't already build by hand elsewhere.

**Consequences:**
- (+) One implementation, all 5 tabs, no per-view code.
- (+) Reuses `syncOnce()` as-is — no new sync logic, no new failure modes beyond what `syncOnce()` already handles (it already catches and silently no-ops on fetch failure).
- (−) Needs its own gesture-vs-scroll disambiguation (only arm when `.screen.scrollTop === 0`), same class of problem already solved for long-press-vs-click and drag-to-reorder-vs-scroll.

**Design specifics:**
- Resistance: pull distance capped with diminishing returns past ~40px raw movement (`dist = Math.min(80, raw * 0.5)` beyond that point), so it doesn't read as infinite scroll.
- Indicator: a new Lucide `refresh-cw` symbol (vendored into `index.html`'s sprite, same as `menu` was added for Task #13), rotating proportionally to pull distance while pulling, then spinning continuously (`animation: spin 0.8s linear infinite`) while `syncOnce()` is in flight.
- Mount style: the indicator occupies the space the pull creates above the content, pushing content down (Gmail/Twitter style) rather than overlaying on top of it.
- Trigger threshold: ~70px. Crossing it fires `navigator.vibrate(12)` once (matching the existing long-press-entry haptic), and arms the refresh so releasing past this point calls `syncOnce()`.
- Safety net: a ~4s timeout independent of `syncOnce()`'s own promise, so an offline/hung pull collapses the indicator back to rest rather than spinning forever.
- Reduced motion: the gesture-driven proportional rotation is exempt from `prefers-reduced-motion` (same treatment as drag-to-reorder — it's directly tied to an active touch input, not an ambient animation), but the continuous "refreshing" spin should respect it (replace with a static pulse or no motion, relying on the haptic + eventual content update as feedback instead).

**Alternatives considered:** see "ruled out" above for the two non-starters. Within the custom-gesture approach, an indicator-overlay (no content displacement) was considered and rejected in favor of push-content-down, on the grounds that displacing content reads as a more direct physical response to the gesture.

---

## 2. Enter/grow animations: Web Animations API via a shared `fx.js` helper

**Decision:** Add one small exported helper to `js/fx.js` (the module Task #14 already created for confetti/chime/vibrate):
```js
export function animateGrow(el, keyframes, delayMs = 0) {
  if (reducedMotion) return;
  el.animate(keyframes, { duration: 450, delay: delayMs, easing: 'ease-out', fill: 'backwards' });
}
```
Apply it to all three existing chart/graph element types, every time their view renders (no session-state tracking — replays on every tab switch):
- **`js/trends.js`** bar charts (sleep/feeds/diapers): each `.bar` animates `transform: scaleY(0) → scaleY(1)` (origin: bottom), staggered ~35ms per bar *within* each chart; all three charts start simultaneously (independent stagger, not one continuous wave down the page — keeps total animation time to ~250ms regardless of chart count).
- **`js/sleep.js`** 24h ring: each nap segment `<circle>` animates `stroke-dashoffset` from full circumference to its target offset, same per-element stagger.
- **`js/growth.js`** weight line: `polyline.getTotalLength()` read once per render to set `stroke-dasharray`, then the polyline animates `stroke-dashoffset` from that length to 0 (a single "draw-on," no stagger needed); dots/area fill fade+scale in with a short stagger of their own.

**Context:** Three implementation techniques were compared:
- **CSS `@keyframes` with custom-property endpoints** — works for bars and the ring via inline custom properties parameterizing a shared keyframe's end value, but the growth line still needs `getTotalLength()` in JS regardless, so it's not actually CSS-only either, and the custom-property-as-keyframe-endpoint technique is more obscure to maintain than the alternative below.
- **JS two-step render + existing CSS `transition`** — render at zero, force a reflow, then set final values so `.bar`'s already-present (currently inert) `transition: height .4s` actually animates. Works, but needs a hand-rolled reflow-forcing coordinator and per-element `transition-delay` management for stagger.
- **Web Animations API (`element.animate()`)** — chosen. Native browser API (fully compliant with "no framework"), handles stagger natively via the `delay` option, no forced-reflow hacks, no CSS changes required, and slots into `fx.js`'s existing role as the home for "sensory effect" helpers alongside confetti/chime/buzz.

**Consequences:**
- (+) One small helper covers all three chart types; no CSS authoring needed beyond `transform-origin: bottom` on `.bar`.
- (+) `prefers-reduced-motion` handling is free — `fx.js` already has the `reducedMotion` check from Task #14, reused as-is (skip the animation, render final state immediately, no visual gap).
- (−) Replays on every tab switch (deliberate choice, not a flaw): simplest to implement, no state to track, and the animation is short enough (~450ms + stagger) to stay pleasant rather than annoying even at this app's realistic usage frequency (checked many times a day).

**Alternatives considered:** per-session-only replay (skip if already animated once this app session) and data-change-only replay (skip if values haven't moved since last render) were both considered and rejected in favor of "every switch" — both add state-tracking complexity for a UX benefit judged not worth it at this app's scale.

---

## 3. Spinner per-row haptics, matching `UIPickerView`-style selection feedback

**Decision:** Add a one-line `navigator.vibrate(3)` call inside `js/sheets.js`'s existing `render()` function, in the branch that already detects a value-row crossing during drag/settle:
```js
function render(offset) {
  const raw = pxToVal(offset);
  const center = Math.round(raw / step) * step;
  if (center !== lastCenter) {
    lastCenter = center;
    items.innerHTML = trackHTML(center);
    if (navigator.vibrate) navigator.vibrate(3);   // new
  }
  ...
```
Haptics only — the spinner's existing `tick()` sound stays settle-only (fired once from `commit()`), not moved into this per-row branch.

**Context:** `render()` already runs on every animation frame during both active dragging and the momentum-settle animation, and already tracks `lastCenter` to detect exactly when the centered value crosses to a new row — this is the same moment iOS's `UISelectionFeedbackGenerator` fires on a `UIPickerView`. No new state or functions are needed; this is purely additive to an existing code path.

**Consequences:**
- (+) Free reuse of existing row-crossing detection — zero new state.
- (+) Naturally bounded during a fast fling: `render()` fires once per row (not per frame), so even flinging across many rows produces a bounded sequence of short vibrations, not a continuous buzz.
- `3ms` is deliberately shorter than the existing long-press (`12ms`) and pull-to-refresh-trigger (`12ms`) haptics, since this can fire many times per interaction and needs to read as a subtle tick, not a buzz.

**Alternatives considered:** also moving the `tick()` sound into this same per-row branch (making sound and haptics both per-row, closer to a mechanical clicker wheel) — rejected in favor of haptics-only, both because it more closely matches iOS's own convention (per-row haptic, no per-row sound) and because a sound firing dozens of times during a fast fling risks feeling noisy rather than delightful.

---

## Open follow-ups not yet decided

- Whether the pull-to-refresh indicator's "refreshing" continuous spin should differ visually under `prefers-reduced-motion` (static pulse vs. no motion at all) — flagged in §1 as needing a treatment, not yet pinned to one specific replacement.
- Whether growth's dot/area fade-in stagger timing should match the line's draw-on duration exactly or run as a distinct shorter beat — left as an implementation-time judgment call within the ~450ms budget, not a separate decision.
