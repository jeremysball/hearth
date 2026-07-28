import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM + storage shims so fx.js (and its store.js import) load under Node.
class MemoryStorage { constructor(){this.s={};} getItem(k){return Object.prototype.hasOwnProperty.call(this.s,k)?this.s[k]:null;} setItem(k,v){this.s[k]=String(v);} removeItem(k){delete this.s[k];} }
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
// Node's built-in `navigator` global has no `.vibrate` — same as iOS Safari,
// which is exactly the platform gap that routes buzz() through hapticAudio().

// Fake AudioContext whose resume() always rejects with the same error WebKit
// reports on a wedged audio session, so buzz() (the only iOS haptic path,
// since navigator.vibrate doesn't exist on iOS Safari) always falls through
// to hapticAudio() -> getCtx() -> resume().
let lastInstance = null;
class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.resumeCalls = 0; this.sampleRate = 44100; this.currentTime = 0; lastInstance = this; }
  resume() { this.resumeCalls++; return Promise.reject(new DOMException('Failed to start the audio device', 'InvalidStateError')); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return { connect: () => ({ connect: () => {} }), start: () => {} }; }
  createGain() { return { gain: { setValueAtTime: () => {} }, connect: () => ({ connect: () => {} }) }; }
}
globalThis.window.AudioContext = FakeAudioContext;

const { buzz } = await import('./fx.js');
const flush = () => new Promise((r) => setTimeout(r, 0));

test('buzz(): a wedged AudioContext does not storm-retry resume() and never surfaces an unhandled rejection', async (t) => {
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.once('unhandledRejection', onUnhandled);
  t.after(() => process.removeListener('unhandledRejection', onUnhandled));

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.after(() => t.mock.timers.reset());

  // First tap: constructs the shared AudioContext, first (failing) resume() attempt.
  buzz(3);
  await flush();
  assert.ok(lastInstance, 'AudioContext should have been constructed');
  assert.equal(lastInstance.resumeCalls, 1);

  // Simulate a spinner drag: js/sheets.js's maybeBuzz() throttles to one
  // buzz() per 40ms, so a ~1s drag fires ~25 calls in quick succession.
  for (let i = 0; i < 25; i++) buzz(3);
  await flush();
  assert.equal(lastInstance.resumeCalls, 1, 'a wedged context must not retry resume() on every call in a drag');

  // No unhandled rejection should have surfaced from any of the above.
  assert.equal(unhandled, false);

  // Once real time has actually passed, a later interaction may reasonably
  // try again (the audio session could have recovered, e.g. after a phone
  // call ends) — this is not a permanent lockout.
  t.mock.timers.tick(5000);
  buzz(3);
  await flush();
  assert.ok(lastInstance.resumeCalls > 1, 'a fresh interaction after a cooldown should retry, not stay wedged forever');
});
