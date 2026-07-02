import { esc } from './ui.js';

export const CHANGELOG = [
  {
    date: '2026-07-02',
    version: '2026-07-02',
    changes: [
      'Fixed the Sleep tab failing to open overnight or for newborns.'
    ]
  },
  {
    date: '2026-06-30',
    version: '2026-06-30',
    changes: [
      'Added caregiver photos for shared logs.',
      'Added feed volume trends.',
      'Polished onboarding and Timeline details.'
    ]
  }
];

export function currentVersion() {
  return document.querySelector('meta[name="version"]')?.content || '';
}

export function renderChangelog() {
  return `<div class="card row-card changelog-card" id="changelog-card">
    <h2>Changelog</h2>
    ${CHANGELOG.map((entry) => `<section class="change-entry">
      <div class="change-date">${esc(entry.date)}</div>
      <ul>${entry.changes.map((change) => `<li>${esc(change)}</li>`).join('')}</ul>
    </section>`).join('')}
  </div>`;
}
