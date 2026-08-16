// prediction-source.js: shared helper so Home and the prediction-info sheet
// can render source badges without pulling in the whole sleep.js module.
// Extracted from sleep.js so `home.js` doesn't force a parse of the sleep
// ring + SweetSpot schedule code on first paint. sleep.js re-exports this
// for backward compat (sleep.test.js imports from there).
import { state } from './store.js';

export function predictionSourceInfo(prediction) {
  const name = state().baby.name || 'your baby';
  const n = prediction?.sampleSize || 0;
  if (prediction?.source === 'personal') {
    return {
      cls: 'src-personal',
      heading: `Personalized to ${name}`,
      body: `Based on ${name}'s own nap pattern from the last 21 days (${n} naps logged).`,
    };
  }
  if (prediction?.source === 'blend') {
    return {
      cls: 'src-learning',
      heading: `Learning ${name}'s pattern`,
      body: `Blending ${name}'s own naps with typical ranges for this age (${n} nap${n === 1 ? '' : 's'} logged in the last 21 days). Personalizes further as you log more.`,
    };
  }
  return {
    cls: 'src-generic',
    heading: 'Generic estimate',
    body: `Not enough naps logged yet, so this window uses typical timing for this age. Log a few more naps to personalize it.`,
  };
}
