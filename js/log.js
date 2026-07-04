// log.js: gated, namespaced console instrumentation.
const ON = (() => {
  try { return localStorage.getItem('hearth.debug') === '1' || /[?&]debug\b/.test(location.search); }
  catch (e) { return false; }
})();
const style = { info:'#7d8a5c', warn:'#c08a3a', error:'#c0563a', event:'#5a7d9a' };
function emit(level, scope, msg, ...data) {
  if (!ON && level === 'info') return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`%c hearth %c ${scope} `, `background:${style[level]};color:#fff;border-radius:4px`, 'color:inherit', msg, ...data);
}
export const log = {
  info:  (s,m,...d) => emit('info', s, m, ...d),
  warn:  (s,m,...d) => emit('warn', s, m, ...d),
  error: (s,m,...d) => emit('error', s, m, ...d),
  event: (s,m,...d) => { if (ON) emit('event', s, m, ...d); }
};
