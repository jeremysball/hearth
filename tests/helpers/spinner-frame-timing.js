// tests/helpers/spinner-frame-timing.js
// Sample rAF callbacks during a scripted picker gesture and report frame
// intervals. The 60fps gate is enforced by medians and p95 of these samples,
// not by Safari trace paint counts.

function frameIntervalsFromRaf(samples) {
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    intervals.push(samples[i].t - samples[i - 1].t);
  }
  return intervals;
}

function summarize(samples) {
  const intervals = frameIntervalsFromRaf(samples);
  if (intervals.length === 0) {
    return { n: 0, median: 0, p95: 0, p99: 0, max: 0, over16: 0, over33: 0 };
  }
  const sorted = intervals.slice().sort((a, b) => a - b);
  const pick = (q) => {
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx];
  };
  return {
    n: sorted.length,
    median: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[sorted.length - 1],
    over16: sorted.filter((x) => x > 16.67).length,
    over33: sorted.filter((x) => x > 33.3).length,
  };
}

// Install the harness into a Playwright page. The harness wraps
// requestAnimationFrame to capture every callback's timestamp, then exposes
// the samples on window.__frames.
const installScript = `
(() => {
  window.__frames = [];
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return orig((t) => {
      window.__frames.push({ t });
      return cb(t);
    });
  };
})();
`;

function gate(summary) {
  return (
    summary.median <= 16.67 &&
    summary.p95 <= 20 &&
    summary.p99 <= 33.3 &&
    summary.over33 === 0
  );
}

module.exports = {
  installScript,
  summarize,
  gate,
  frameIntervalsFromRaf,
};
