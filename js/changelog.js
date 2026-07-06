import { esc } from './ui.js';

export const CHANGELOG = [
  {
    date: '2026-07-06',
    version: '2026-07-06',
    fixes: [
      'Fixed push notifications silently failing on iPhone.'
    ]
  },
  {
    date: '2026-07-02',
    version: '2026-07-02',
    features: [
      'Split log dates and times into easier inputs.',
      'Added family admin controls with an admin crown, caregiver roles, and access removal.',
      'Added a SweetSpot prediction source indicator on the Sleep tab and home hero.',
      'Split wet and dirty sizes for Mixed diapers.',
      'Added a diaper rash toggle.',
      'Added a configurable list of play types.',
      'Added a note indicator dot on log rows.',
      'Revamped home info cards and fixed their icons.',
      'Showed caregiver photo next to "Logged by" in entry detail.',
      'Made app updates wait until sheets and undo messages are closed.'
    ],
    fixes: [
      'Fixed the Sleep tab failing to open overnight or for newborns.',
      'Fixed the app sometimes getting stuck on a stale cached version after an update.',
      'Fixed push reminders ignoring settings, failing to reschedule on restart, and silently dropping subscriptions.',
      'Fixed the diaper size thumb and stopped losing the Mixed size on older entries.',
      'Fixed play types not syncing across caregivers.',
      'Fixed the note field surviving into the next entry.',
      'Fixed pull-to-release snapping and the spinner restarting mid-flick.',
      'Fixed sleep entries not reopening when the Woke field cleared.',
      'Fixed caregiver metadata drifting out of sync.'
    ]
  },
  {
    date: '2026-07-01',
    version: '2026-07-01',
    features: [
      'Added push reminders for naps, bottles, and meds.',
      'Added caregiver names to shared log entries.',
      'Added a feed volume chart to Trends.',
      'Added a live 15s tick that refreshes overdue card labels.'
    ],
    fixes: [
      'Fixed birthdates showing a day early in some time zones.',
      'Fixed caregiver updates not appearing in real time.',
      'Fixed overdue labels missing on bottle, medicine, and generic cards.'
    ]
  },
  {
    date: '2026-06-30',
    version: '2026-06-30',
    features: [
      'Added caregiver photos for shared logs.',
      'Added feed volume trends.',
      'Added age-staged developmental tip cards.',
      'Added Dayjob theme choices in onboarding.',
      'Filled awake windows on the sleep ring and naps list.',
      'Extended the wake window by the preceding sleep duration.',
      'Polished onboarding and Timeline details.'
    ],
    fixes: [
      'Fixed the sleep rail showing during nighttime hours.',
      'Suppressed the SweetSpot rail for nighttime wakes before 6am.',
      'Fixed sync comparing timestamps incorrectly.',
      'Fixed MedCard defaults getting lost on the first sync.',
      'Shortened the first wake window to match the science.'
    ]
  }
];

export function currentVersion() {
  return document.querySelector('meta[name="version"]')?.content || '';
}

function group(label, items) {
  if (!items || !items.length) return '';
  return `<div class="change-group">
    <div class="change-group-label">${esc(label)}</div>
    <ul>${items.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  </div>`;
}

export function renderChangelog() {
  return `<div class="card row-card changelog-card" id="changelog-card">
    <h2>Changelog</h2>
    ${CHANGELOG.map((entry) => `<section class="change-entry">
      <div class="change-date">${esc(entry.date)}</div>
      ${group('New', entry.features)}
      ${group('Fixed', entry.fixes)}
    </section>`).join('')}
  </div>`;
}