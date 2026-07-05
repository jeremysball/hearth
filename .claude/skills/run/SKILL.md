---
name: run
description: Use when launching the Hearth app to verify UI changes, screenshot the running app, or confirm a fix works in the browser.
---

# Run Hearth

## Launch

The Go entry point is `cmd/hearth/main.go` (the `server` package itself is a library, not `package main`). Run from **repo root** with env vars pointing at the worktree's static files:

```bash
REPO=/workspace/hearth   # or equivalent worktree path
CERT=$(ls $REPO/certs/*.crt | head -1)
KEY=${CERT%.crt}.key
cd $REPO
PORT=9878 STATIC_DIR=$REPO DB_PATH=/tmp/hearth-run.db CERT_FILE=$CERT KEY_FILE=$KEY PEPPER=$(openssl rand -hex 32) go run ./cmd/hearth &
sleep 4
curl -sk -o /dev/null -w "%{http_code}" https://localhost:9878/
# expect 200
```

`STATIC_DIR` points at whichever directory has `index.html` — use the worktree path when reviewing a branch. Port 8443 is used by the live server; use 9877–9879 for dev. The cert glob picks whichever `.crt` is present — cert filenames change as certs rotate. `PEPPER` is required at startup (HMAC key for hashing bearer tokens, `server/tokens.go`) — a fresh random value is fine for a throwaway dev DB.

**The live server (port 8443) must always use `DB_PATH=/workspace/hearth/hearth.db`** — the main checkout's database, never a worktree-relative or `/tmp` one. `*.db` is gitignored, so `DB_PATH` unset defaults to a `hearth.db` relative to cwd and each worktree silently gets its own empty database the first time it's launched there, splitting real dogfood data across copies (this happened once already — see git history around 2026-07-05). Ephemeral verification runs on 9877–9879 with a throwaway `/tmp` DB are unaffected by this rule; only the always-on 8443 instance needs the fixed absolute path.

## Screenshot with Playwright

Playwright is installed at repo root (`node_modules/playwright`). Always pass `--ignore-certificate-errors` for the self-signed cert.

```js
// run from repo root: node /tmp/screenshot.js
const { chromium } = require('/workspace/hearth/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const p = await b.newPage();
  await p.setViewportSize({ width: 390, height: 844 }); // iPhone 14
  await p.goto('https://localhost:9878/');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/hearth-screen.png' });
  await b.close();
})();
```

## Complete onboarding to reach home screen

The app opens on the onboarding form. To get to the home screen:

```js
await p.fill('input[placeholder="e.g. Olive"]', 'Olive');
await p.fill('input[type="date"]', '2025-01-15');
await p.click('text=Girl');   // or Boy, Day Job Girl, Day Job Boy
await p.fill('input[placeholder="e.g. Maya"]', 'Maya');
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(300);
await p.click('.btn-primary');
await p.waitForTimeout(2000);
await p.screenshot({ path: '/tmp/hearth-home.png' });
```

## Dark mode

```js
// toggle dark mode via settings tab (index 3)
await p.click('.tab:nth-child(4)');
// or inject directly:
await p.evaluate(() => document.documentElement.setAttribute('data-mode', 'dark'));
await p.waitForTimeout(300);
```

## Kill the server

```bash
kill $(rg -l "" /proc/*/cmdline 2>/dev/null | xargs grep -l "hearth" 2>/dev/null | grep -oP '\d+' | head -1)
# or just: pkill -f "go run ."
```
