// Captures the four README screenshots (hero card + bottle-logging modal,
// light and dark) against a running Hearth instance.
//
// Usage: start the server per .claude/skills/run/SKILL.md, then:
//   node scripts/capture-readme-screenshots.js [baseUrl]
// Writes PNGs to screenshots/readme-{hero,logging}-{light,dark}.png.

const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.argv[2] || 'https://localhost:9878';
const outDir = path.join(__dirname, '..', 'screenshots');

async function dismissTips(page) {
  for (;;) {
    const btn = await page.$('.tip-dismiss');
    if (!btn) break;
    await btn.click();
    await page.waitForTimeout(200);
  }
}

async function scrollToTop(page) {
  await page.evaluate(() => document.querySelector('.screen').scrollTo(0, 0));
}

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl);
  await page.waitForTimeout(1500);

  await page.fill('input[placeholder="e.g. Olive"]', 'Olive');
  await page.fill('input[type="date"]', '2026-04-15');
  await page.click('text=Girl');
  await page.fill('input[placeholder="e.g. Maya"]', 'Maya');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.click('.btn-primary');
  await page.waitForTimeout(2000);

  await dismissTips(page);
  await scrollToTop(page);
  await page.screenshot({ path: path.join(outDir, 'readme-hero-light.png') });

  await page.click('[data-action="log:open"][data-type="bottle"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'readme-logging-light.png') });
  await page.click('[data-action="sheet:close"]');
  await page.waitForTimeout(400);

  await page.evaluate(() => { document.body.dataset.mode = 'dark'; });
  await scrollToTop(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'readme-hero-dark.png') });

  await page.click('[data-action="log:open"][data-type="bottle"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'readme-logging-dark.png') });

  await browser.close();
  console.log('Wrote 4 screenshots to', outDir);
})();
