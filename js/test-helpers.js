export class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}

export function withMockedNow(iso, fn) {
  const OrigDate = globalThis.Date;
  const nowMs = new OrigDate(iso).getTime();
  class MockDate extends OrigDate {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  globalThis.Date = MockDate;
  try { return fn(); }
  finally { globalThis.Date = OrigDate; }
}
