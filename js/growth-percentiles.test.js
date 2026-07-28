import test from 'node:test';
import assert from 'node:assert/strict';
import { percentileFor, medianCurveFor, ageMonthsAt } from './growth-percentiles.js';

function closeTo(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, want ${expected} +/- ${tol}`);
}

test('percentileFor recovers the 50th percentile when the measurement equals the WHO median (L != 0 branch)', () => {
  // boys weight-for-age, month 0: L=0.3487, M=3.3464
  closeTo(percentileFor('weightKg', 'boy', 0, 3.3464), 50.0, 0.05, 'boys weight month 0 at M');
});

test('percentileFor recovers the 50th percentile when the measurement equals the WHO median (L == 1 branch)', () => {
  // girls height-for-age, month 12: L=1, M=74.015
  closeTo(percentileFor('heightCm', 'girl', 12, 74.015), 50.0, 0.05, 'girls height month 12 at M');
});

test('percentileFor matches WHO\'s own published 97.7th-percentile column value', () => {
  // boys weight-for-age, month 0: WHO's "98th (97.7th)" column = 4.419354
  closeTo(percentileFor('weightKg', 'boy', 0, 4.419354), 97.7, 0.1, 'boys weight month 0 at WHO 97.7th col');
});

test('percentileFor matches WHO\'s own published 25th-percentile column value', () => {
  // girls weight-for-age, month 3: WHO's "25th" column = 5.368044
  closeTo(percentileFor('weightKg', 'girl', 3, 5.368044), 25.0, 0.1, 'girls weight month 3 at WHO 25th col');
});

test('percentileFor matches WHO\'s own published 75th-percentile column value', () => {
  // boys height-for-age, month 9: WHO's "75th" column = 73.48176
  closeTo(percentileFor('heightCm', 'boy', 9, 73.48176), 75.0, 0.1, 'boys height month 9 at WHO 75th col');
});

test('percentileFor matches WHO\'s own published 10th-percentile column value', () => {
  // girls head-circumference-for-age, month 18: WHO's "10th" column = 44.47224
  closeTo(percentileFor('headCm', 'girl', 18, 44.47224), 10.0, 0.1, 'girls head month 18 at WHO 10th col');
});

test('percentileFor returns null when sex is unset', () => {
  assert.equal(percentileFor('weightKg', '', 6, 8), null);
});

test('percentileFor returns null when age is past 24 months', () => {
  assert.equal(percentileFor('weightKg', 'boy', 25, 12), null);
});

test('percentileFor floors a fractional age to the completed month, not rounds', () => {
  // month 6 row for boys weight has M=7.934 (50th percentile). 6.9 months must
  // floor to month 6, not round to month 7 (M=8.297) -- floor-to-completed-month
  // is the documented rule (see the design spec), and monthly LMS rows mean
  // rounding up would silently apply next month's curve a few weeks early.
  closeTo(percentileFor('weightKg', 'boy', 6.9, 7.934), 50.0, 0.05, 'age 6.9 floors to month 6');
});

test('ageMonthsAt floors to completed months between two YYYY-MM-DD dates', () => {
  assert.equal(ageMonthsAt('2026-01-15', '2026-07-14'), 5); // one day short of 6 completed months
  assert.equal(ageMonthsAt('2026-01-15', '2026-07-15'), 6);
});

test('medianCurveFor returns the WHO median for each in-range age and null past 24 months', () => {
  const curve = medianCurveFor('weightKg', 'boy', [0, 6, 12, 25]);
  closeTo(curve[0], 3.3464, 0.0001, 'month 0');
  closeTo(curve[1], 7.934, 0.0001, 'month 6');
  closeTo(curve[2], 9.6479, 0.0001, 'month 12');
  assert.equal(curve[3], null, 'month 25 is out of range');
});

test('medianCurveFor returns null outright when sex is unset', () => {
  assert.equal(medianCurveFor('weightKg', '', [0, 6]), null);
});
