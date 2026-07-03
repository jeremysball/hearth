const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18799);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 360, height: 820 });
    await page.goto(srv.base + '/');
    await onboard(page);

    await page.evaluate(() => {
      const raw = localStorage.getItem('hearth.state.v1');
      const st = JSON.parse(raw);
      const now = new Date();
      const birth = new Date(now);
      birth.setDate(birth.getDate() - 154);
      st.baby.name = 'Mina';
      st.baby.birthdate = birth.toISOString().slice(0, 10);
      st.settings.tipMorningLightDismissed = false;
      st.settings.dismissedTips = [];
      st.settings.dismissedRegressions = [];
      st.log = [];
      for (let i = 0; i < 14; i += 1) {
        const day = new Date(now);
        day.setDate(day.getDate() - i);
        const start = new Date(day);
        start.setHours(0, 30, 0, 0);
        const end = new Date(day);
        end.setHours(7, 5, 0, 0);
        st.log.push({ id: `night-${i}`, type: 'sleep', start: start.toISOString(), end: end.toISOString() });
      }
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });

    await page.reload();
    await page.waitForSelector('.tip-card');

    const sourceLines = await page.$$eval('.tip-source', (els) => els.map((el) => el.textContent.trim()));
    check('info cards render secondary source lines', sourceLines.length >= 2, sourceLines.join(' | '));
    check('morning light card cites circadian research', sourceLines.some((line) => line.includes('Yates 2018') && line.includes('Kok 2024')), sourceLines.join(' | '));

    const headings = await page.$$eval('.tip-card', (cards) => cards.map((card) => ({
      title: card.querySelector('.tip-hd')?.textContent.trim() || '',
      text: card.textContent.trim(),
    })));
    check('info cards render a title', headings.every((h) => h.title), JSON.stringify(headings));
    check('info card titles do not start with info prefix', headings.every((h) => !/^info\s+/i.test(h.title)), JSON.stringify(headings));

    const morning = headings.find((h) => h.title.includes('Morning light'));
    check('morning light title renders without icon category prefix', morning && !/^info\s+/i.test(morning.title), JSON.stringify(headings));
    check('morning light copy includes observed wake time', morning && /7:0?5/.test(morning.text), morning ? morning.text : JSON.stringify(headings));
    check('stage tip cites research', sourceLines.some((line) => /Source:/.test(line) && !line.includes('Yates 2018; Kok 2024')), sourceLines.join(' | '));
  } catch (e) {
    check('info cards test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
