// tests/helpers.js — shared utilities for spinning up the Hearth server
// and driving Playwright against it.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { rmSync } = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'hearth-server');

function buildServer() {
  const { execSync } = require('child_process');
  execSync('go build -o ' + BIN + ' ./cmd/hearth', { cwd: ROOT, stdio: 'pipe' });
}

async function startServer(port = 18787) {
  port = Number(process.env.TEST_PORT) || port;
  buildServer();
  const dbPath = `/tmp/hearth-test-${process.pid}.db`;
  rmSync(dbPath, { force: true });
  const proc = spawn(BIN, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      STATIC_DIR: ROOT,
      DB_PATH: dbPath,
      PORT: String(port),
      HOST: '127.0.0.1',
      CERT_FILE: '',
      KEY_FILE: '',
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || 'test-public-key',
      VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || 'test-private-key',
      VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:test@example.com',
      PEPPER: process.env.PEPPER || 'test-pepper-must-be-at-least-32-bytes-long',
    },
    stdio: 'pipe',
  });
  proc.stderr.on('data', (d) => { if (process.env.DEBUG) process.stderr.write('[srv] ' + d); });
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, 20000);
  return { proc, base, dbPath, close() {
      if (!proc.killed) proc.kill('SIGTERM');
      const killTimer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 2000);
      killTimer.unref();
      proc.once('exit', () => clearTimeout(killTimer));
      rmSync(dbPath, { force: true });
    } };
}

function waitForServer(base, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(base + '/', (res) => {
        res.destroy();
        if (res.statusCode === 200) resolve();
        else retry(start, timeoutMs, check, reject, 'status ' + res.statusCode);
      }).on('error', () => retry(start, timeoutMs, check, reject, 'connect'));
    };
    check();
  });
}
function retry(start, timeoutMs, check, reject, why) {
  if (Date.now() - start > timeoutMs) reject(new Error('server never came up (' + why + ')'));
  else setTimeout(check, 100);
}

async function launchBrowser() {
  const opts = { args: ['--no-sandbox', '--ignore-certificate-errors'] };
  if (process.env.CHROMIUM) opts.executablePath = process.env.CHROMIUM;
  return chromium.launch(opts);
}

async function onboard(page) {
  // Skip onboarding if already done; fill otherwise.
  if (await page.$('#onb-name')) {
    await page.fill('#onb-name', 'Test');
    await page.fill('#onb-bd', '2025-01-01');
    await page.fill('#onb-cg', 'Maya');
    await page.click('[data-action="onboard:finish"]');
    await page.waitForTimeout(800);
  }
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label + (extra ? ' — ' + extra : '')); }
}
function tally() {
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  return fail === 0 ? 0 : 1;
}
function resetCounters() { pass = 0; fail = 0; }

module.exports = { startServer, launchBrowser, onboard, check, tally, resetCounters, ROOT };
