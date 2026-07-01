import test from 'node:test';
import assert from 'node:assert/strict';

const HR = 3600000;
const NOW = Date.now();

// ---------- localStorage ----------
class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
const mem = new MemoryStorage();
globalThis.localStorage = mem;

// ---------- DOM globals ----------
function mockEl() {
  return {
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    style: {},
    dataset: {},
    innerHTML: '',
    scrollTop: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    offsetLeft: 0,
    contains() { return false; },
    getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0 }; },
    setPointerCapture() {},
    getTotalLength() { return 0; },
  };
}
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: () => mockEl(),
  body: mockEl(),
};
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
Object.defineProperty(globalThis, 'location', {
  value: { search: '', protocol: 'http:', reload: () => {} },
  writable: true,
  configurable: true,
});
globalThis.requestAnimationFrame = (fn) => fn();

// ---------- Notification ----------
globalThis.Notification = {
  requestPermission: async () => 'granted',
};

// ---------- navigator ----------
Object.defineProperty(globalThis, 'navigator', {
  value: {
    serviceWorker: {
      ready: Promise.resolve({ showNotification: () => Promise.resolve() }),
      register: () => Promise.resolve().catch(() => {}),
      controller: null,
      addEventListener: () => {},
    },
  },
  writable: true,
  configurable: true,
});

// ---------- setTimeout capture + clearTimeout ----------
const timeoutCalls = [];
globalThis.setTimeout = (fn, delay) => {
  const id = timeoutCalls.length + 1;
  timeoutCalls.push({ fn, delay, id });
  return id;
};
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => {};

// ---------- Pre-populate state: feed 5h ago, bottleIntervalH=3 → due now-2h ----------
const initialState = {
  setup: true,
  synced: false,
  baby: { name: 'Test', birthdate: '2025-01-01', theme: 'girl', photo: null, caregiver: '' },
  settings: {
    theme: '',
    bottleIntervalH: 3,
    meds: [
      { id: 'm1', name: 'Vitamin D', dose: '1', unit: 'drop', everyH: 24 }
    ],
    units: { volume: 'ml', temp: 'C', weight: 'kg', length: 'cm' },
    reminders: { naps: false, bottle: true, meds: false, lead: 0, quietStart: '20:00', quietEnd: '07:00' },
    cards: { bottle: true, medicine: true, order: ['bottle', 'medicine'], intervals: {} },
    sound: true,
    clock24: '12h',
    darkMode: 'auto'
  },
  log: [
    { id: 'f1', type: 'feed', start: new Date(NOW - 5 * HR).toISOString() }
  ],
  growth: []
};
localStorage.setItem('hearth.state.v1', JSON.stringify(initialState));

// ---------- Import modules ----------
const { scheduleReminders, enableNotifs } = await import('./reminders.js');
const { addEntry } = await import('./store.js');

// ---------- Helpers ----------
function timeoutForBottle() {
  return timeoutCalls.find((c) => c.delay <= 0);
}

function resetTimeouts() {
  timeoutCalls.length = 0;
}

// ---------- Tests ----------

test('Past-due reminder fires once', async () => {
  // Clear any previous notified state
  localStorage.removeItem('hearth.notified.v1');
  resetTimeouts();

  // Enable notifs — sets _granted=true and calls scheduleReminders
  await enableNotifs();

  // Bottle due = now - 2h → past-due → delay clamped to 0
  const call = timeoutForBottle();
  assert.ok(call, 'setTimeout should be called for past-due bottle reminder');
  assert.ok(call.delay <= 0, `delay should be <= 0, got ${call.delay}`);

  // Fire the callback — should write to notified set
  call.fn();

  const raw = localStorage.getItem('hearth.notified.v1');
  assert.ok(raw, 'notified set should be persisted after callback fires');
  const notified = new Map(JSON.parse(raw));
  const found = [...notified.keys()].find((k) => k.startsWith('bottle:'));
  assert.ok(found, 'notified set should contain a bottle key');
});

test('Does not re-fire on second call', () => {
  // notified key is already in localStorage from test 1
  resetTimeouts();
  scheduleReminders();

  const call = timeoutForBottle();
  assert.equal(call, undefined, 'should not schedule again for the same notified reminder');
});

test('New bottle re-arms when due time changes', () => {
  // Add a newer feed (4h ago) so nextBottle().due changes to now-1h
  addEntry({ type: 'bottle', start: new Date(NOW - 4 * HR).toISOString() });

  resetTimeouts();
  scheduleReminders();

  const call = timeoutForBottle();
  assert.ok(call, 'setTimeout should be called for the new due time');
  assert.ok(call.delay <= 0, `delay should be <= 0, got ${call.delay}`);
});

