# Sleep Model Design — Hearth

**Date:** 2026-06-28  
**Status:** Approved for implementation planning

---

## Problem

Hearth surfaces one number — the awake window — sourced from a population table. Parents see "1h 30m" and treat it as a target rather than a range. They feel failure when their baby doesn't conform. This is functionally identical to Huckleberry's approach and carries the same implicit judgment.

The goal: give parents accurate, mechanistic information they can trust — then make it personal to their baby over time, automatically, with no extra logging burden.

---

## Scientific Foundation

The Borbély Two-Process Model governs all predictions and explanations in this system:

- **Process S (sleep pressure):** Adenosine accumulates in the brain while awake. More awake time = more adenosine = stronger drive to sleep. This is the wake window. The "overtired" state is real: if sleep pressure peaks and then a cortisol spike fires, settling becomes harder — the window closes.
- **Process C (circadian clock):** The suprachiasmatic nucleus (SCN) maintains a ~24h rhythm entrained by morning light. Before ~3 months, the SCN is immature and circadian entrainment is weak — hence unpredictable newborn sleep. Morning light exposure (first 30 minutes of the day) accelerates circadian development.
- **Normal variation is wide:** Douglas (Possums/NDC) documents 9–20 hours total sleep at birth, 9–17 hours at 6 months, with day-to-day variation within one baby of up to 12 hours. Half of 6-month-olds still wake at night. This is not a problem — it is the distribution.

These two processes, not a schedule, determine when a baby is ready to sleep.

---

## Three Pillars

**1. Explain the why.** Every number Hearth surfaces carries a one-sentence mechanism. The awake window is not a countdown — it's a description of adenosine accumulation. Parents who understand the mechanism stop fighting it.

**2. Personalize, don't prescribe.** After 7+ logged naps, predictions shift from "babies this age" to "this baby." The provenance is always shown. Parents see Hearth getting smarter about their child, not evaluating them against a standard.

**3. Never blame.** No red warnings for short naps. No "missed window" alerts. No comparison to population targets. Anomalies are described as observations ("shorter than Ben usually sleeps") with mechanistic context, not failure states.

---

## Data Model

### Existing signals (no new logging required)

All predictions in Phase 1 and Phase 2 run on what's already captured:

| Field | Source | Derived use |
|---|---|---|
| `entry.start` | Log | Wake window start (after previous sleep end) |
| `entry.end` | Log | Sleep duration; wake window end |
| `entry.type === 'sleep'` | Log | Filters the relevant events |
| `baby.birthdate` | Settings | Age-bracket lookup for population prior |

### Optional enrichment (Phase 3+)

Single-tap post-nap prompt: **"How was that one?"** — three options (great / ok / rough). Skippable. If dismissed 5 consecutive times, stops appearing. Stored as `entry.quality` on the sleep entry, same field already present in the schema (seeded data uses `quality: 'good'`).

No mood-before-sleep field in v1. No how-they-fell-asleep field. This data adds signal but the core system must not depend on it.

---

## Algorithm

### Phase 1: Population prior (0–14 logged sleep events)

`awakeWindowMin()` is extended to return a **range** instead of a single value, and to annotate position in day:

```js
wakeWindowRange(position)
// position: 'first' | 'middle' | 'last'
// returns: { low, high, midpoint, source: 'population', ageMonths }
```

Population ranges by age (from Dubief, validated against existing data):

| Age | First window | Middle windows | Last window |
|---|---|---|---|
| 0–1m | 40–60 min | 40–60 min | 50–75 min |
| 1–3m | 60–80 min | 60–80 min | 75–100 min |
| 3–5m | 80–110 min | 80–110 min | 105–140 min |
| 5–7m | 110–140 min | 110–140 min | 140–180 min |
| 7–10m | 140–170 min | 140–170 min | 180–215 min |
| 10–13m | 170–200 min | 170–200 min | 215–250 min |
| 13m+ | 190–240 min | 190–240 min | — |

The last window multiplier (~1.3–1.5×) reflects higher cumulative sleep pressure by end of day.

"First" = first awake period of the day (before the day's first nap). "Last" = final period before bed. "Middle" = everything between.

Position is inferred from time-of-day since we can't know in real-time whether a window is "last" (that's only knowable retrospectively): before 10am → first; after 4pm → last; between → middle. The implementation should adjust these thresholds based on the baby's typical wake time once personal data accumulates.

### Phase 2: Blend (7–30 events)

After 7 completed sleep events, compute a rolling personal wake window per day position:

```js
personalWakeWindow(position)
// returns: { median, p25, p75, sampleSize }
// uses only events in the last 21 days (recency-weighted, λ = 0.93/day)
```

Blend formula:

```
predicted = (w_p × personal.median) + (w_pop × population.midpoint)

where:
  w_p   = clamp((n - 7) / 23, 0, 0.9)  // 0% at n=7, 90% at n=30+
  w_pop = 1 - w_p
  n     = sampleSize for that position
```

Display range is derived from the personal p25–p75 (at full weight) blended toward the population range (at zero weight).

Population acts as a sanity floor/ceiling: if the personal median falls outside 0.5×–2× the population midpoint, clamp to the population range and flag in the data (possible data anomaly — don't surface to parent).

### Phase 3: Personal-first (30+ events)

Weight is 90% personal, 10% population (sanity check only). The source label shifts:
- < 7 events: "typical for [age]"
- 7–29 events: "based on [name]'s recent naps"
- 30+ events: "based on [name]'s pattern"

### Prediction output shape

```js
derive.wakeWindowPrediction(position)
// returns:
{
  low: number,          // minutes
  high: number,         // minutes
  midpoint: number,     // minutes
  source: 'population' | 'blend' | 'personal',
  sampleSize: number,
  label: string,        // e.g. "typical for 4 months" or "based on Ben's pattern"
}
```

`derive.sweetSpot()` is updated to use this instead of the bare `awakeWindowMin()` number. The existing 30-minute window (`from` → `to`) becomes `low` → `high` of the prediction range.

---

## Two Modes of Operation

Hearth operates in one of two modes depending on how much logged data is available. The mode shifts automatically — parents never configure it or know there's a transition. The UI just gets more specific over time.

### Mode A — Typical (population prior active)

**Activates:** Always. Fallback when personal data is insufficient.  
**Source:** Age-based population tables (Dubief, validated against AASM ranges).  
**What it can say:** What babies at this age generally do — ranges, not targets.  
**What it cannot say:** Anything specific to this baby.  
**Confidence framing:** Explicitly labeled as typical, not predictive.

| What parents see | |
|---|---|
| Nap window | "Babies at 4 months usually nap after 80–110 min awake." |
| Sweet spot card | "Typical for her age — 1h 20m–1h 50m from last wake." |
| Mechanism note | "Sleep pressure builds while she's awake and releases during sleep." |

Mode A is always honest about its source. No number is presented as a fact about this baby until data backs it up.

---

### Mode B — Personal (logged data active)

**Activates:** After 7+ completed sleep events (auto, no setup).  
**Source:** This baby's own logged wake intervals, recency-weighted.  
**What it can say:** This baby's personal wake window, per position in day, with a confidence range.  
**What it cannot say:** Clock-time predictions until the circadian anchor is also active (see Phase 3).  
**Confidence framing:** Labeled with sample size and recency.

The algorithm is classical statistics — a recency-weighted percentile calculation. Each sleep log event is an observation. Older observations decay in weight at 7% per day (λ = 0.93). No training, no model — every output is directly explainable from the raw log entries.

| What parents see | |
|---|---|
| Nap window (7–29 events) | "Based on her recent naps — usually 85–100 min from last wake." |
| Nap window (30+ events) | "Based on her pattern — 85–98 min, first nap of the day." |
| Source chip (on tap) | "From her last 18 morning naps, logged over 3 weeks." |
| Sweet spot card | "Around now — 94 min is her usual." |

**Mode B + Circadian** (Phase 3, requires morning wake consistency):  
Once morning wake times are stable (SD < 45 min, 14+ observations), the interval prediction gains a clock-time anchor.

| What parents see | |
|---|---|
| Nap window | "First nap usually around 8:10–8:35am." |
| Bedtime (evening only) | "Sleep clock pointing toward bed around 7:20–7:45pm." |
| Morning light tip (once) | "She wakes around 6:40am most days. Morning light in the first 30 minutes helps anchor her sleep clock." |

---

### Mode comparison at a glance

| | Mode A | Mode B | Mode B + Circadian |
|---|---|---|---|
| **Source** | Population table | Her logged intervals | Her intervals + morning wake |
| **Activates at** | Always | 7 sleep events | 14 morning wakes, SD < 45 min |
| **Nap timing** | Range ("80–110 min") | Personal range ("85–98 min") | Clock time ("around 8:15am") |
| **Bedtime estimate** | No | No | Yes |
| **Confidence language** | "typical for 4 months" | "based on her pattern" | "based on her pattern" |
| **What can't it do** | Know this baby | Know the clock | — |

The handoff between modes is invisible to parents. No announcement, no setup screen. The source label on the sweet spot card is the only signal — it quietly shifts from "typical for her age" to "based on her pattern" as data accumulates.

---

## Science Copy Layer

Explanatory copy is **output, not input**. It requires no parent action. It appears on surfaces parents already use.

### Surfaces and triggers

| Surface | Trigger | Copy example |
|---|---|---|
| Home hero timer (awake) | Always | "Building sleep pressure — adenosine rising" |
| Home hero timer (approaching window) | Awake > `low` | "Nap window opening. Watch for yawning or looking away." |
| Home hero timer (past window) | Awake > `high` | "Past the usual window. Settling may be harder now." (no warning color) |
| Post-nap summary | After sleep ends | "40-minute nap — lighter sleep cycle. Normal, especially in the afternoon." |
| Info chip on sweet spot card | On tap | Balloon explanation of sleep pressure |
| Regression banner | Age-triggered | See Regression section |

### Balloon metaphor (primary explanatory frame)

Adenosine is the "sleep pressure balloon." Awake time fills it. Sleep releases it. Too flat = won't nap. Overinflated (cortisol spike) = hard to settle. The sweet spot is when the balloon is about three-quarters full.

This metaphor is accurate (adenosine model is the mechanism), non-judgmental, and doesn't imply the parent did anything wrong.

### Copy tone rules

- Use the baby's name, not "your baby."
- Describe mechanism, not compliance. "Adenosine is rising" not "window is closing."
- Ranges, not targets. "Usually between 70–90 minutes" not "should be 75 minutes."
- Anomalies are observations. "Shorter than Ben's usual" not "short nap."
- Past the window: factual, not alarming. "May be harder to settle now" not "missed the window."

---

## Regression Heads-Up

Automatic, age-based. Zero logging burden. No parent action required.

Regressions are documented developmental events with known age ranges. Hearth surfaces a heads-up banner ~1 week before the typical onset.

| Regression | Onset range | Mechanism (shown to parent) |
|---|---|---|
| 4-month | 3.5–5 months | Brain begins cycling through adult sleep stages. Architecture changes; sleep gets lighter. |
| 6-month | 5.5–7 months | Increased cognitive load from developmental leap. |
| 8–10-month | 7.5–10.5 months | Object permanence + separation awareness activating. |
| 12-month | 11–13 months | Nap transition pressure + walking milestone cortisol. |
| 18-month | 17–19 months | Language explosion; vocabulary acquisition interferes with sleep. |

**Banner copy pattern:**
> "Ben is approaching the 4-month sleep change — one of the most common. Some babies experience shorter naps and more frequent night waking for a few weeks. This is the brain wiring up new sleep stages, not a problem to fix. [Learn what's happening →]"

Banner appears once per regression, dismissed with one tap, and does not return. Stored as a dismissed flag in `_state.settings`.

---

## Circadian Phase Tracking

The wake window algorithm (Phase 2) tells parents *how long* Ben will typically be awake before needing a nap. The circadian layer tells them *what time on the clock* that usually lands — which is more useful day-to-day. These two signals together are what makes predictions actionable.

### How the circadian anchor is detected

Morning wake time is already in the log: it's the `end` timestamp on the overnight sleep (the long sleep that ends between 4am–10am, with duration > 3 hours). No new logging required.

```js
derive.circadianAnchor()
// returns: { morningWakeTime: Date (time-only), confidence: 'low'|'medium'|'high', sampleSize: number }
// or null if fewer than 5 morning wake observations
```

Confidence thresholds:
- < 5 morning wakes: null (not enough data)
- 5–13 morning wakes: `'low'`
- 14–27 morning wakes: `'medium'`
- 28+ morning wakes: `'high'`

The anchor is the recency-weighted median of morning wake times (same λ = 0.93/day weighting as the wake window). A standard deviation is also tracked — if the SD is > 45 minutes, confidence is capped at `'low'` (schedule is too variable to anchor).

### What circadian tracking adds

**Clock-time nap predictions.** Instead of "after 80–100 minutes awake," Hearth can say "first nap usually around 8:00–8:30am." This is derived by adding the personal wake window range to the circadian morning anchor:

```
nap_window_clock = morningWakeMedian + wakeWindowPrediction('first')
```

When both signals are available (Phase 2 + Phase 3 active), the two are combined: the prediction is the interval range shifted to start at the circadian anchor. If the parent is already past the interval-based window but not yet near the clock-time anchor (or vice versa), the later of the two is used — sleep pressure and circadian reinforcement both matter.

**Bedtime anchor.** Total awake time across the day accumulates predictably. Once the morning anchor and personal wake windows are known, Hearth can estimate when peak sleep pressure aligns with the falling circadian curve — the biological bedtime window:

```js
derive.bedtimeWindow()
// returns: { from: Date, to: Date, confidence: 'low'|'medium'|'high' }
```

This is surfaced as a gentle note in the evening, not a countdown. "Ben's sleep clock usually points toward bed around 7:15–7:45pm."

**Morning light coaching.** A one-time tip shown once the circadian anchor is detected with medium+ confidence:

> "Ben wakes around 6:30am most mornings. Morning light in the first 30 minutes — open curtains, step outside — helps anchor his sleep clock and makes nap timing more predictable. Bright light suppresses melatonin and tells his SCN what time it is."

Dismissed with one tap, never shown again. Stored as a dismissed flag in `_state.settings`.

**Circadian immaturity framing (< 3 months).** Before the SCN matures, the circadian anchor can't stabilize. For babies under 12 weeks, skip the anchor entirely and surface this instead:

> "Ben's sleep clock is still developing — circadian rhythm matures around 3 months. Unpredictable nap timing before then is biology, not a problem to fix."

### Affected by circadian phase

- `sweetSpot()` gains clock-time output when anchor is available.
- `derive.bedtimeWindow()` is new.
- `derive.circadianAnchor()` is new.
- Home view: sweet spot card gains clock-time label ("around 8:15–8:30am") alongside the interval label.
- Home view: bedtime chip appears in the evening when confidence ≥ medium.
- One-time morning light tip card.

---

## Affected Files

| File | Change |
|---|---|
| `store.js` | Replace `awakeWindowMin()` with `wakeWindowRange(position)`. Add `derive.personalWakeWindow(position)`, `derive.wakeWindowPrediction(position)`, `derive.circadianAnchor()`, `derive.bedtimeWindow()`, `derive.regressionAlert()`. Extend `sweetSpot()` to use prediction range and circadian anchor. |
| `home.js` | Update hero timer copy to use science framing. Update sweet spot card to show range + clock time + source label. Add bedtime chip. Add regression banner slot. Add morning-light tip card. |
| `sleep.js` | Add post-nap summary copy (duration context + mechanism note). |
| `styles.css` | Add regression banner and bedtime chip styles (card-variant, dismissible). |
| `store.test.js` | Tests for `wakeWindowRange`, `personalWakeWindow`, blend formula, circadian anchor detection, bedtime window, regression trigger logic. |

No new files required. No schema changes. No server changes.

---

## Implementation Phases

### Phase 1 — Reframe existing (no new algorithm)

- Replace `awakeWindowMin()` single value with `wakeWindowRange()` returning low/high.
- Update `sweetSpot()` to use the range.
- Update home hero timer copy to use science framing (balloon/adenosine language).
- Update sweet spot card to show range instead of single time.
- Add source label: "typical for [age]" until personalization kicks in.
- Add post-nap summary copy on the sleep view.

Deliverable: science framing is live. Still population-only, but honest about it.

### Phase 2 — Wake window personalisation

- Implement `derive.personalWakeWindow(position)` rolling median with recency weighting.
- Implement blend formula and `derive.wakeWindowPrediction(position)`.
- Wire source label transitions (population → blend → personal).
- Tests: blend formula accuracy, position-detection logic, edge cases (< 7 events, stale data, out-of-range clamping).

Deliverable: Hearth gets smarter the more you log. Predictions cite Ben's data, not a table.

### Phase 3 — Circadian phase tracking

Requires Phase 2 to be live (needs morning wake observations to accumulate).

- Implement `derive.circadianAnchor()` — recency-weighted median of morning wake times, SD-gated confidence.
- Implement `derive.bedtimeWindow()` — derived from morning anchor + personal awake totals.
- Update `sweetSpot()` to combine interval and clock-time predictions.
- Add clock-time label to sweet spot card ("around 8:15–8:30am").
- Add bedtime chip to home view (evening only, confidence ≥ medium).
- Add one-time morning light tip card (dismissed to `_state.settings`).
- Circadian immaturity banner for < 12 weeks.
- Tests: anchor detection, SD-gating, bedtime window, confidence thresholds, immaturity bypass.

Deliverable: predictions shift from interval-based to clock-time-anchored. Parents see "around 8:15am" not just "in about 20 minutes."

### Phase 4 — Regression alerts + pattern surface

- Implement `derive.regressionAlert()` — returns current approaching regression or null.
- Add regression banner to home view.
- Add dismissed-regression tracking to `_state.settings`.
- (Optional) Pattern summary surface in the sleep view: "Here's what we've learned about Ben."

Deliverable: proactive developmental context with zero parent action.

---

## Out of Scope

- Mood-before-sleep logging (deferred — adds friction, not required for core algorithm)
- How-baby-fell-asleep logging (deferred)
- Night-sleep prediction (different model; sufficient complexity for a separate spec)
- Neural networks, gradient boosting, or any trained model — the recency-weighted rolling median is classical statistics (weighted percentile calculation), fully interpretable, and sufficient. "No ML" means no trained models, not no math.
