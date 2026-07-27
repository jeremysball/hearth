// onboarding.js: first-run setup (name, birthdate, theme, photo, caregiver).
import { state, save, seed, reset, markSynced, enqueueSettingsSync } from './store.js';
import { $, applyTheme, toast, $$, THEME_COLORS, resolveMode } from './ui.js';
import { router } from './app.js';
import { log } from './log.js';
import { signInButtons } from './account.js';

let _onbPhoto = null;

export function onboarding() {
  const t = document.body.dataset.theme || 'girl';
  return `<div class="onboard">
    <div class="onb-top">
      <img src="icons/hearth-logo.svg" class="onb-logo" alt="Hearth" />
      <p class="onb-sub onb-tagline">A calm home for your baby's days.&nbsp;<br>Let's set things up.</p>
    </div>

    <div class="onb-card">
      <button class="onb-photo" data-action="onboard:photo" id="onb-photo">
        <span class="avatar lg"><svg class="icon"><use href="#camera"></use></svg></span>
        <span class="onb-photo-l">Add photo</span>
      </button>

      <label class="fld"><span class="fld-l">Baby's name</span>
        <input id="onb-name" placeholder="e.g. Olive" autocomplete="off" /></label>

      <label class="fld"><span class="fld-l">Birthdate</span>
        <input id="onb-bd" type="date" max="${new Date().toISOString().slice(0, 10)}" /></label>

      <div class="fld"><span class="fld-l">Theme</span>
        <div class="theme-pick" style="padding: 8px 0;">
          <button type="button" class="theme-opt ${t === 'girl' ? 'on' : ''}" data-action="onboard:theme" data-theme="girl"><span class="theme-swatch girl"></span><span>Girl</span></button>
          <button type="button" class="theme-opt ${t === 'boy' ? 'on' : ''}" data-action="onboard:theme" data-theme="boy"><span class="theme-swatch boy"></span><span>Boy</span></button>
          <button type="button" class="theme-opt ${t === 'dayjob-girl' ? 'on' : ''}" data-action="onboard:theme" data-theme="dayjob-girl"><span class="theme-swatch dayjob-girl"></span><span>Warm</span></button>
          <button type="button" class="theme-opt ${t === 'dayjob-boy' ? 'on' : ''}" data-action="onboard:theme" data-theme="dayjob-boy"><span class="theme-swatch dayjob-boy"></span><span>Cool</span></button>
        </div>
      </div>

      <label class="fld"><span class="fld-l">Your name <span class="opt">(caregiver)</span></span>
        <input id="onb-cg" placeholder="e.g. Maya" autocomplete="off" /></label>
    </div>

    <button class="btn-primary onb-go" data-action="onboard:finish"><svg class="icon"><use href="#heart"></use></svg> Create Hearth</button>
    <div class="onb-or">or</div>
    ${signInButtons()}
    <div class="onb-foot">You can change any of this later in Profile.</div>
  </div>`;
}

export function provisionedView() {
  return `<div class="onboard">
    <div class="onb-top">
      <img src="icons/hearth-logo.svg" class="onb-logo" alt="Hearth" />
      <p class="onb-sub onb-tagline">This Hearth already has a family.&nbsp;<br>Sign in if you're a caregiver, or ask for an invite link.</p>
    </div>
    ${signInButtons()}
  </div>`;
}

export function onboardTheme(theme) {
  document.body.dataset.theme = theme;
  $$('.theme-opt').forEach((b) => b.classList.toggle('on', b.dataset.theme === theme));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const c = THEME_COLORS[theme] || THEME_COLORS.girl;
    meta.content = resolveMode() === 'dark' ? c.dark : c.light;
  }
}

export function onboardPhoto() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sz = 240, cv = document.createElement('canvas'); cv.width = sz; cv.height = sz;
        const cx = cv.getContext('2d');
        const s = Math.min(img.width, img.height);
        cx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, sz, sz);
        _onbPhoto = cv.toDataURL('image/jpeg', 0.82);
        const holder = $('#onb-photo .avatar');
        if (holder) { holder.style.backgroundImage = `url('${_onbPhoto}')`; holder.innerHTML = ''; }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  inp.click();
}

export async function onboardFinish() {
  const name = $('#onb-name').value.trim();
  if (!name) { $('#onb-name').focus(); $('#onb-name').classList.add('shake'); setTimeout(() => $('#onb-name').classList.remove('shake'), 500); return; }
  const st = state();
  st.baby.name = name;
  st.baby.birthdate = $('#onb-bd').value || '';
  st.baby.theme = document.body.dataset.theme || 'girl';
  st.baby.caregiver = $('#onb-cg').value.trim();
  st.baby.photo = _onbPhoto;
  st.setup = true;
  seed();
  save();
  applyTheme();
  router.boot();
  router.go('home');
  toast('Welcome, ' + name + ' 🤍');

  try {
    const res = await fetch('/api/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        babyName: name, birthdate: st.baby.birthdate, theme: st.baby.theme,
        caregiverName: st.baby.caregiver || 'Parent'
      })
    });
    // Enqueue the settings sync only once the family/session is established —
    // queuing it earlier races the session cookie: a sync drain triggered in
    // that gap (background interval, visibilitychange, SSE push) 401s and
    // gets stuck at the head of the outbox, blocking every future sync until
    // it's retried and finally succeeds.
    if (res.ok) markSynced();
    else if (res.status === 409) {
      reset();
      $('#app').innerHTML = provisionedView();
      toast('This Hearth was already set up on another device.');
      return;
    } else log.warn('onboard', 'family create failed', res.status);
  } catch (e) {
    log.warn('onboard', 'family create offline', e);
  }
  enqueueSettingsSync();
}
