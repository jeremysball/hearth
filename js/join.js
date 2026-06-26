// join.js — accepting an invite link to join an existing family as a caregiver.
import { state, save, applySyncResponse } from './store.js';
import { $, applyTheme, toast } from './ui.js';
import { router } from './app.js';

export function joinView(token) {
  return `<div class="onboard">
    <div class="onb-top">
      <div class="onb-mark"><svg class="icon"><use href="#heart"></use></svg></div>
      <h1 class="onb-title">You've been invited</h1>
      <p class="onb-sub">Join as a caregiver to see and log alongside the rest of the family.</p>
    </div>
    <div class="onb-card">
      <label class="fld"><span class="fld-l">Your name</span>
        <input id="join-name" placeholder="e.g. Dad" autocomplete="off" /></label>
    </div>
    <button class="btn-primary onb-go" data-action="join:finish" data-token="${token}"><svg class="icon"><use href="#heart"></use></svg> Join family</button>
  </div>`;
}

function installGuideView() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const steps = isIOS
    ? `<ol class="install-steps">
        <li>Tap the <svg class="icon icon-sm"><use href="#share-2"></use></svg> Share button in Safari</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
        <li>Tap <strong>Add</strong></li>
      </ol>`
    : `<p class="onb-sub">Chrome will prompt you to install — tap <strong>Install</strong> when it appears, or use the browser menu → <strong>Add to Home Screen</strong>.</p>`;
  return `<div class="onboard">
    <div class="onb-top">
      <div class="onb-mark"><svg class="icon"><use href="#heart"></use></svg></div>
      <h1 class="onb-title">You're in! Now install Hearth</h1>
      <p class="onb-sub">Follow these steps to add Hearth to your Home Screen.</p>
    </div>
    <div class="onb-card">
      ${steps}
      <p class="install-note">This install link expires in 10 minutes.</p>
    </div>
  </div>`;
}

export async function joinFinish(token) {
  const nameInput = $('#join-name');
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus(); nameInput.classList.add('shake'); setTimeout(() => nameInput.classList.remove('shake'), 500);
    return;
  }

  try {
    const res = await fetch('/api/join/' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ caregiverName: name })
    });
    if (!res.ok) throw new Error('join failed: ' + res.status);
  } catch (e) {
    toast('Could not join — check the link or your connection');
    return;
  }

  if (!window.matchMedia('(display-mode: standalone)').matches) {
    try {
      const ltRes = await fetch('/api/launch-tokens', { method: 'POST', credentials: 'include' });
      if (!ltRes.ok) throw new Error('launch token failed');
      const { token: launchToken } = await ltRes.json();
      history.replaceState(null, '', '/?launch=' + launchToken);
    } catch (_) {
      // best-effort — cookie sharing works on iOS 16.4+ even without token
    }
    $('#app').innerHTML = installGuideView();
    return;
  }

  const syncRes = await fetch('/api/sync', { credentials: 'include' });
  const data = await syncRes.json();
  applySyncResponse(data);
  state().baby.caregiver = name;
  state().setup = true;
  save();
  applyTheme();
  history.replaceState(null, '', '/');
  router.boot();
  router.go('home');
  toast('Welcome to the family, ' + name + ' 🤍');
}
