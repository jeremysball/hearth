// account.js — OAuth sign-in UI, signed-in state, and conflict resolution.
import { state, save } from './store.js';
import { esc, sheet, toast } from './ui.js';

let cachedMe = { identity: null };
export function meSnapshot() { return cachedMe; }
export async function loadMe() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) cachedMe = await res.json();
  } catch (e) { /* offline; keep last snapshot */ }
}

export function signInButtons() {
  return `<div class="signin-pills">
    <button class="signin-pill google" data-action="auth:signin" data-provider="google"><svg class="icon"><use href="#circle-user"></use></svg> Continue with Google</button>
    <button class="signin-pill apple" data-action="auth:signin" data-provider="apple"><svg class="icon"><use href="#circle-user"></use></svg> Continue with Apple</button>
  </div>`;
}

export function accountSection() {
  const id = cachedMe.identity;
  if (id) {
    return `<div class="set-row account-row">
        <span class="notif-txt"><b>Signed in</b><span class="fld-l">${esc(id.email || id.provider)}</span></span>
        <button class="btn-sm" data-action="auth:signout">Sign out</button>
      </div>`;
  }
  return `<p class="empty-note">Sign in to back up and sync across devices. Optional — Hearth works without an account.</p>${signInButtons()}`;
}

export function beginSignIn(provider) {
  // Full-page navigation so the provider redirect lands back on our callback.
  window.location.href = '/api/auth/' + provider;
}

export async function signOut(refresh) {
  try { await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' }); } catch (e) { /* ignore */ }
  cachedMe = { identity: null };
  toast('Signed out');
  if (refresh) refresh();
}

// onSignup is called when auth=ok and the app is still in first-run state (signedup
// on a fresh device). app.js provides the full boot sequence as the callback so that
// syncOnce/connectEvents, which are private to app.js, are not re-exported.
export async function handleAuthRedirect(refresh, onSignup) {
  const params = new URLSearchParams(location.search);
  const auth = params.get('auth');
  if (!auth) return;
  const pending = params.get('pending');
  history.replaceState(null, '', location.pathname);
  if (auth === 'ok') {
    await loadMe();
    if (onSignup) {
      await onSignup();
    } else {
      toast('Signed in');
      if (refresh) refresh();
    }
  }
  else if (auth === 'error') { toast('Sign-in failed — please try again'); }
  else if (auth === 'conflict' && pending) {
    try {
      const res = await fetch('/api/conflict/' + encodeURIComponent(pending), { credentials: 'include' });
      if (res.ok) openConflictSheet(await res.json(), pending);
    } catch (e) { toast('Could not load account details'); }
  }
}

function openConflictSheet(info, pending) {
  const fam = (f, label) => `<div class="conflict-fam"><b>${label}</b><span class="fld-l">${esc(f.babyName || 'Baby')} · ${f.entryCount} entr${f.entryCount === 1 ? 'y' : 'ies'}</span></div>`;
  sheet.open(`
    <p class="empty-note">This device has data, and your account already has a family. Nothing is deleted — choose what to do.</p>
    ${fam(info.current, 'This device')}
    ${fam(info.target, 'Your account')}
    <button class="btn-primary" data-action="auth:resolve" data-choice="merge" data-pending="${esc(pending)}"><svg class="icon"><use href="#check"></use></svg> Merge into my account</button>
    <button class="btn-ghost" data-action="auth:resolve" data-choice="switch" data-pending="${esc(pending)}">Switch to my account</button>
    <button class="btn-ghost" data-action="auth:resolve" data-choice="keep" data-pending="${esc(pending)}">Keep this device's data</button>`,
    { title: 'Choose your data' });
}

export async function resolveConflict(choice, pending, onDone) {
  try {
    const res = await fetch('/api/auth/resolve', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending, choice }),
    });
    if (!res.ok) { toast('Could not apply that choice'); return; }
  } catch (e) { toast('Could not reach the server'); return; }
  sheet.close();
  if (choice === 'switch' || choice === 'merge') {
    // The session now points at the account's family; pull it down on next load.
    state().setup = true; save();
    toast(choice === 'merge' ? 'Merged into your account' : 'Switched to your account');
  } else {
    toast('Kept this device\'s data');
  }
  if (onDone) onDone();
}
