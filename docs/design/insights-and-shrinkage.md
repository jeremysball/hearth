# Insights — dispersion-aware personal predictions

**Applies to:** `js/store.js` (new `derive` functions, shared shrinkage primitive, `wakeWindowPrediction` retrofit), `js/trends.js` (new Insights section), `js/store.test.js`.

## Problem

Hearth already predicts wake-window timing by blending an age-based population guess with the baby's own recent naps (`derive.wakeWindowPrediction`). It works, but the blend weight depends only on how many naps you've logged, not on how consistent those naps are — a baby with a rock-steady schedule and a baby with a chaotic one get the same trust at the same sample size. The weight itself, and its constants (7, 23, 30, 0.9, the 0.5×–2× clamp), were hand-tuned rather than derived from the data.

Separately, the requested "Insights" feature — new pattern callouts inside Trends, drawing on nap duration, quality, method, and bedtime-routine fields — needs the same population→personal blending logic, but for claims that are asserted outright ("her naps run short after 6pm bedtimes") rather than shown as a range. A hand-tuned, dispersion-blind weight is riskier here: a scattered baby with no real pattern could still produce a confident-sounding headline.

## Direction: one shared shrinkage primitive, two consumers

Extract the blending logic already proven in `wakeWindowPrediction` into a general, dispersion-aware primitive, then use it in both places: retrofit `wakeWindowPrediction` (bug fix — same output shape, better-computed weight) and build the new Insights derivations on top of it (new feature). This is less new code than inventing a separate mechanism for Insights, and it fixes a real gap in the shipped feature along the way.

### The primitive: precision-weighted blend

Replace the sample-count ramp with a weight derived from how much each source should be trusted:

```
personal_precision = n / personal_variance
prior_precision    = 1 / prior_variance
w_p = personal_precision / (personal_precision + prior_precision)
```

- `personal_variance` — squared `stdDev` of the baby's own recency-weighted observations (both `stdDev` and `recencyWeight` already exist in `store.js`).
- `prior_variance` — estimated from the population range already returned by `wakeWindowRange`/`WAKE_WINDOW_TABLE`: `((high - low) / 4) ** 2` as a rough SD-from-range estimate.
- No hand-picked ramp or magic sample-count thresholds. A consistent baby's `w_p` climbs fast even at low n; a scattered baby's `w_p` stays low even at high n. If her pattern shifts (regression, growth spurt), variance widens and `w_p` naturally drops back toward the population prior without any code change.
- Keep a floor/ceiling (`w_p` capped at 0.9, same as today) so the population table is never fully discarded — it's a sanity check at all times, not just a cold-start crutch.

For continuous values (nap duration, wake-window length) this is a Normal-Normal conjugate shrinkage. For ordinal `quality` (Restless/Okay/Good/Great, 4 levels) the same idea applies via a Beta-Binomial: shrink the observed proportion of "good or better" naps toward a population baseline, weighted by precision rather than raw count.

Both live as small shared helpers in `store.js` near `recencyWeight`/`weightedMedian`, since both consumers need identical math.

### SweetSpot retrofit

`derive.wakeWindowPrediction` keeps its exact input/output shape (`{low, high, midpoint, source, sampleSize, label}`) — only the internal `w_p` computation changes, from the n-only ramp to the precision-weighted formula above. The 0.5×–2× clamp against the population midpoint stays as a final backstop. This is a pure bug fix: same feature, dispersion now counted instead of ignored. No UI change.

### Insights (new)

New section inside **Trends**, appearing once enough data exists to say something (never a blank/empty state that implies "nothing to see" — it simply doesn't render below threshold). Four insights, all built on the same shrinkage primitive, all reusing detail fields already logged today (no new data collection required — this is what "use detail fields as insight inputs" meant):

1. **Personal wake-window calibration** — "Naps tend to land [earlier/later] than the age guide, around N minutes." Uses the same shrunk wake-window estimate SweetSpot already computes; Insights simply narrates the gap between her shrunk personal midpoint and the population midpoint, once `w_p` clears a legibility bar (population contribution small enough that the personal number is trustworthy on its own).
2. **Overtired correlation (lagged, not contemporaneous)** — does overshooting the wake window on nap *i* predict worse quality on nap *i+1*? Time-ordered, using fields already logged (`start`/`end`/`quality`). This is the corrected version of the original "overtired" idea: same-nap overshoot-vs-quality is confounded (a nap that's already bad may report low quality for unrelated reasons); the lagged version asks whether *today's* overshoot predicts *tomorrow's* nap, which is the causally cleaner and more actionable question.
3. **Nap/sleep duration trend** — is her typical nap length trending up/down over the last N weeks, shrunk toward the age-appropriate expectation rather than a raw rolling average.
4. **Bedtime/method quality comparison** — Beta-Binomial shrinkage comparing `quality` outcomes across a detail field (bedtime routine followed vs. not, or settling method), gated so it only surfaces once both groups have enough shrunk-precision to separate meaningfully.

All four share one **legibility ceiling**, non-negotiable regardless of how defensible the underlying statistic is:

- One insight, one number, one sentence. Sample size and any interval available behind a tap, never in the headline.
- No causal or blame language ("because you...", "your baby is worse at..."). Insights describe patterns, not conclusions about parenting choices.
- No point-forecasts ("will sleep 47 minutes"). Ranges or plain-language direction only.
- An insight that can't clear this bar in ≤12 words doesn't ship, no matter how solid the math behind it.
- Below-threshold data means the insight simply doesn't render — never a "not enough data yet" placeholder that turns the section into a nag screen.

## Out of scope for this spec

- **Population priors sourced across families** (aggregate stats instead of the hand-curated `WAKE_WINDOW_TABLE`) — real privacy and infra cost, marginal value until the user base is large enough for empirical data to beat the curated table. Revisit later; not v1.
- **WHO growth-percentile bands on the Growth chart** — separate spec, separate data source (WHO reference tables, not personal shrinkage), tracked independently.
- **Local JSON export** — backlogged in `todo.txt`, unrelated to this feature.

## Testing

- `store.test.js`: unit tests for the new precision-weighted `w_p` helper directly — verify a low-variance personal series reaches high `w_p` faster than a high-variance series at identical `n`; verify the clamp and floor/ceiling still hold; verify `wakeWindowPrediction`'s existing test cases still pass with the new internals (same fixtures, same expected shape, updated expected `w_p`/`midpoint` values where the math now differs from the old ramp).
- New tests for each Insights derivation: confirm no insight renders below its threshold, confirm the lagged-overtired insight correctly orders nap *i* against nap *i+1* rather than comparing within the same nap.

## Self-critique this spec applied

The natural shortcut here was to bolt Insights onto the existing `wakeWindowPrediction` weight formula unchanged and just reuse the number — that would have shipped confident-sounding pattern claims from a mechanism that can't tell a consistent baby from a scattered one, which is a worse failure mode for an asserted claim than for a displayed range. Fixing the shared primitive first, then building both consumers on it, costs a bit more upfront but removes that risk from both features instead of just the new one. The one bet this spec makes: reusing `stdDev`/`recencyWeight` to estimate variance from a small, recency-weighted personal sample is itself a rough estimate — with n as low as 7–10 the variance estimate is noisy. That's accepted as good enough given the population-precision floor keeps the blend from over-trusting a shaky variance estimate on tiny samples.
