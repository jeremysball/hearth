// join.js — accepting an invite link to join an existing family as a caregiver.
import { state, save, applySyncResponse } from './store.js';
import { $, applyTheme, toast } from './ui.js';
import { router } from './app.js';

export function joinView(token) {
  return `<div class="onboard">
    <div class="onb-top">
      <div class="onb-mark"><i class="ph ph-heart-straight"></i></div>
      <h1 class="onb-title">You've been invited</h1>
      <p class="onb-sub">Join as a caregiver to see and log alongside the rest of the family.</p>
    </div>
    <div class="onb-card">
      <label class="fld"><span class="fld-l">Your name</span>
        <input id="join-name" placeholder="e.g. Dad" autocomplete="off" /></label>
    </div>
    <button class="btn-primary onb-go" data-action="join:finish" data-token="${token}"><i class="ph ph-heart-straight"></i> Join family</button>
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
