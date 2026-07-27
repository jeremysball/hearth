# Growth percentiles (#144)

## Summary

Add WHO growth-percentile lookup for weight, height, and head circumference to the growth tab: a percentile badge on each stat card, and a WHO median overlay on the existing line chart. Covers ages 0-24 months only.

## Reference data

WHO Child Growth Standards, 0-24 months, stored as LMS parameters (L, M, S per month of age) rather than precomputed percentile bands. LMS lets the app compute an exact percentile for any measurement via the standard formula:

```
Z = ((measurement / M)^L - 1) / (L * S)   [L != 0]
Z = ln(measurement / M) / S               [L == 0]
percentile = Phi(Z) * 100                 (standard normal CDF)
```

Data lives in a new `js/growth-percentiles-data.js` module: three tables (weight, height, head circumference) x two sexes x ~25 monthly rows of `{ month, L, M, S }`. Bundled inline, no network fetch, added to `sw.js`'s `SHELL` array alongside the other client modules.

Scope is 0-24 months only — WHO publishes weight-for-age and head-circumference-for-age out to 60 months, but recumbent length-for-age (what this app tracks as "height" for babies) is itself only defined 0-24 months, and it's the age band where Hearth sees the most active use. Past 24 months, the badge and overlay simply don't render, the same way stats already taper off elsewhere in the app.

## New `sex` field

Percentile lookup needs a real biological-sex value, distinct from the existing cosmetic `theme` field (girl/boy/dayjob-girl/dayjob-boy, a color choice with no clinical meaning).

**Server** (`server/`):
- New migration `NNNN_add_baby_sex.sql`: `ALTER TABLE babies ADD COLUMN sex TEXT NOT NULL DEFAULT ''`. Update `server/schema.sql` to match in the same commit — `TestSchemaSQLMatchesMigrations` asserts the migration chain and `schema.sql` produce an identical column set, so a migration without the matching `schema.sql` edit fails CI.
- `family.go`: add `Sex` to the family-creation request struct and both `provisionFamily` call sites — `handleProvision` and the OAuth first-sign-in path in `reconcile.go` (currently hardcodes `"girl"` for `theme` and passes no sex; pass `""` there so OAuth-provisioned babies fall back to the graceful-omission behavior below until sex is set via the profile control).
- `patchBabyRequest`'s new `Sex` field must be `*string`, not `string`, and `handlePatchBaby`'s `UPDATE` must only set the column when non-nil. `handlePatchBaby` does a full-row `UPDATE babies SET name=?, birthdate=?, theme=?, photo=?, ...` from plain-string request fields, and the client's `enqueueBabySync` PATCHes the entire `_state.baby` object. A caregiver on a stale service-worker shell — whose local baby object predates the `sex` field — editing any other baby field would otherwise decode a missing `sex` key as `''` and silently erase a value another caregiver already set. `*string` (nil = leave the column untouched) avoids that.
- `sync.go`: add `sex` to the `SELECT` and the marshaled baby object in `handleSync`.
- Extend `family_test.go`, `sync_test.go`, and `settings_test.go` the same way the existing `theme` field is covered.

**Client** (`js/`):
- `js/onboarding.js`: a required girl/boy picker, independent of the theme picker.
- `js/profile.js`: an edit control alongside the existing theme picker.
- `js/store.js`: add `sex` to the baby shape.

**Missing sex on existing babies:** an empty/unset `sex` means the percentile badge and chart overlay don't render, same graceful-omission pattern as the current head-circumference "—" when that field hasn't been logged yet. No forced migration prompt on existing installs.

## Display (`js/growth.js`)

- Each stat card (Weight, Height, Head) gets a small percentile line under its value, computed from the latest measurement, the baby's age in months, and `sex`. Age in months is floored to the completed month (e.g. 3 months 20 days -> month 3 row) — simplest rule, and the WHO LMS rows are monthly resolution anyway so interpolation would overstate the precision.
- `lineChart()` gains a second polyline: the WHO 50th-percentile median curve for the shown stat, resampled onto the same x-axis as the baby's own points, drawn in a muted secondary stroke so it doesn't compete visually with the baby's own trend line. `lineChart()`'s y-domain currently comes from `Math.min`/`Math.max` over the baby's own points only — it must expand to include the WHO median curve's values too, or a baby tracking well above/below the median gets an overlay clipped outside the visible chart.
- Badge and overlay both omit cleanly (existing chart/card layout, no placeholder state) when `sex` is unset or the baby is older than 24 months.

## Testing

- New unit tests for the LMS percentile calculation against a few of WHO's own published worked examples (known input measurement + age + sex -> known percentile).
- `growth.test.js`: badge rendering, overlay rendering, and the missing-sex / over-24-months graceful-omission paths.
- Server: extend `family_test.go`, `sync_test.go`, `settings_test.go` for the new `sex` field, following the existing `theme` field's test pattern.

## Out of scope

- CDC 2-20 year growth reference data.
- Percentile support past 24 months old.
- Any change to the cosmetic `theme` field or its onboarding/profile UI.
