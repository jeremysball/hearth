import { esc } from './ui.js';

export const CHANGELOG = [
  {
    date: '2026-07-07',
    version: '2026-07-07',
    features: [],
    fixes: [
      'Fixed the night sky\'s clouds, moon, and sun textures, plus card background textures, failing to load.',
      'Thinned out the Pisces constellation, which was too dense and busy compared to the other zodiac signs.',
      'The night sky\'s constellation now shows varying star sizes and renders a bit larger, so it no longer looks cramped.',
      'Thinned out Aquarius, Taurus, Gemini, Virgo, Scorpio, and Sagittarius, which were too dense and tangled compared to the rest of the zodiac constellations.'
    ]
  },
  {
    date: '2026-07-06',
    version: '2026-07-06',
    features: [
      'Replaced the night sky\'s stylized star patterns with real constellation shapes for each zodiac sign.'
    ],
    fixes: [
      'Fixed a lag on the first tap of the day, on the spinner or a log save, by warming up audio ahead of time instead of on first use.',
      'Fixed the view refreshing behind an open sheet when a sync arrived mid-edit; it now waits until you close the sheet.',
      'The sleep log\'s Woke field now defaults to today\'s date, so you only have to set the time.',
      'Sweet Spot now trusts your baby\'s own pattern faster when it\'s consistent, and holds back a little longer when naps are more unpredictable.'
    ]
  },
  {
    date: '2026-07-05',
    version: '2026-07-05',
    features: [
      'Added a "Couldn\'t save" section on Profile that shows any entry that failed to sync for good, so you can see it and re-enter it instead of it silently disappearing.'
    ],
    fixes: [
      'Fixed a bug where one bad log entry could silently block every entry logged after it from ever reaching the other caregiver.',
      'Toast messages can now be dismissed with a tap anywhere on them, instead of needing to hit a small close button.',
      'Signing back in after being removed from a family now shows a clear message instead of silently starting a brand-new, empty family.'
    ]
  },
  {
    date: '2026-07-04',
    version: '2026-07-04',
    features: [
      'Added optional sleep details: bedtime mood, time to fall asleep, how it happened, and how sleep ended. Tap "Details - Optional" on the sleep log sheet.',
      'Added a Hygiene card, for tracking custom items like nail trims or brushing teeth, each with its own reminder interval. Add it from "Add card" on Home.',
      'Added a close button to every toast message, so you can dismiss it right away instead of waiting for it to fade.',
      'Collapsed older changelog entries behind a "Show older updates" button so the Changelog card stays short.',
      'Added a default bottle amount setting, set it once from the Bottle card, and every new bottle log starts prefilled with it.',
      'Added an "Add or edit medicines" shortcut right in the medicine log form, so you no longer have to leave it to manage your medicine list.',
      'Pulling down further on refresh now syncs right away instead of waiting for you to let go.',
      'Renamed the smallest diaper size from "Small" to "Little" throughout the app.',
      'A Hearth instance now shows a sign-in screen instead of the setup form once it already has a family.'
    ],
    fixes: [
      'Fixed entries occasionally not reaching the other caregiver when two things were logged close together.',
      'Fixed a rare case where an entry logged right before the app closed could be lost instead of syncing on next launch.',
      'Fixed a race between caregivers logging at the same time that could permanently stop one device from seeing new entries until signing out and back in.',
      'Fixed the wake time anchor sometimes including a sleep that should have been closed, which could nudge the predicted wake window.',
      'Fixed push notifications silently failing to arrive on iPhone.',
      'Fixed the notifications setting getting stuck with no way to re-enable push, and made push automatically re-attach on next visit if the browser still had a saved subscription.',
      'Fixed sleep tips, the bedtime chip, and other small labels using the wrong text color.',
      'Fixed missed reminders resending every 5 minutes instead of backing off.',
      'Fixed reminders still firing for cards you\'d hidden from Home.',
      'Fixed a sheet opened right after closing another sometimes showing empty.'
    ]
  },
  {
    date: '2026-07-03',
    version: '2026-07-03',
    features: [
      'Repainted the home sky as a real lit scene: a glowing sun, drifting sun-lit clouds, and a richer starfield replace the old flat shapes.',
      'Replaced the sleep countdown\'s coal tiles with a single glowing ember that grows warmer as nap time approaches.',
      'Clouds and sunlight in the hero sky now have real painted texture and shading.'
    ],
    fixes: [
      'Fixed the birth constellation overlapping the moon at night.',
      'Fixed sleep timer text becoming hard to read against a hot ember glow, and cleaned up starfield glare.',
      'Fixed hard-to-read text on the home sky during morning, daytime, and newborn hours.',
      'Replaced a duplicated wake time on the home hero with the sweet spot window\'s start or end time.',
      'Fixed the sleep glow sliding sideways instead of gently warming in place as a nap continues.',
      'Fixed clouds jumping position when battery saver mode turns on.',
      'Fixed sync sometimes getting stuck right after creating a new account, blocking future updates from syncing.',
      'Fixed settings occasionally failing to save right after creating a new account.'
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

const VISIBLE_ENTRIES = 2;
let expanded = false;

export function currentVersion() {
  return document.querySelector('meta[name="version"]')?.content || '';
}

export function toggleChangelogExpanded() {
  expanded = !expanded;
}

function group(label, items) {
  if (!items || !items.length) return '';
  return `<div class="change-group">
    <div class="change-group-label">${esc(label)}</div>
    <ul>${items.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  </div>`;
}

export function renderChangelog() {
  const entries = expanded ? CHANGELOG : CHANGELOG.slice(0, VISIBLE_ENTRIES);
  const hasMore = CHANGELOG.length > VISIBLE_ENTRIES;
  return `<div class="card row-card changelog-card" id="changelog-card">
    <h2>Changelog</h2>
    ${entries.map((entry) => `<section class="change-entry">
      <div class="change-date">${esc(entry.date)}</div>
      ${group('New', entry.features)}
      ${group('Fixed', entry.fixes)}
    </section>`).join('')}
    ${hasMore ? `<button type="button" class="btn-ghost changelog-toggle" data-action="changelog:toggle">${expanded ? 'Show fewer updates' : 'Show older updates'}</button>` : ''}
  </div>`;
}