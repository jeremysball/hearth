// growth-percentiles.js: WHO LMS growth-percentile lookup and the WHO-median
// overlay curve for the growth chart. Pure functions, no DOM/state access.
import { GROWTH_LMS } from './growth-percentiles-data.js';
import { parseDateOnlyLocal } from './store.js';

// Abramowitz & Stegun 7.1.26 approximation of erf(); max absolute error
// 1.5e-7, far more precise than the integer-rounded percentile this feeds.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

// Age is floored to the completed month per the design spec (WHO's own LMS
// rows are monthly resolution, so interpolating between rows would overstate
// precision the reference data doesn't have).
function rowForMonth(table, months) {
  const clamped = Math.max(0, Math.min(24, Math.floor(months)));
  return table.find((r) => r.month === clamped) || null;
}

export function ageMonthsAt(birthdate, dateStr) {
  const b = parseDateOnlyLocal(birthdate), d = parseDateOnlyLocal(dateStr);
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
  if (d.getDate() < b.getDate()) months--;
  return Math.max(0, months);
}

export function percentileFor(statKey, sex, ageMonths, measurement) {
  if (!sex || measurement == null || ageMonths == null || ageMonths > 24) return null;
  const table = GROWTH_LMS[statKey] && GROWTH_LMS[statKey][sex];
  if (!table) return null;
  const row = rowForMonth(table, ageMonths);
  if (!row) return null;
  const { L, M, S } = row;
  const z = L !== 0 ? (Math.pow(measurement / M, L) - 1) / (L * S) : Math.log(measurement / M) / S;
  return normalCdf(z) * 100;
}

export function medianCurveFor(statKey, sex, ages) {
  const table = sex && GROWTH_LMS[statKey] && GROWTH_LMS[statKey][sex];
  if (!table) return null;
  return ages.map((months) => {
    const row = months > 24 ? null : rowForMonth(table, months);
    return row ? row.M : null;
  });
}
