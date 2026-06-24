// tests/run.js — orchestrate all Hearth browser tests.
// Builds the Go binary, starts the server on plain HTTP, runs every *.test.js
// under tests/, and exits non-zero if any suite reports failures.

const { execSync } = require('child_process');
const { spawn } = require('child_process');
const { existsSync, readdirSync, rmSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'hearth-server');
const SUITES = readdirSync(__dirname).filter(f => f.endsWith('.test.js'));

function buildServer() {
  execSync('go build -o ' + BIN + ' .', { cwd: path.join(ROOT, 'server'), stdio: 'pipe' });
}

let exitCode = 0;
const binExisted = existsSync(BIN);
if (!binExisted) {
  console.log('Building hearth-server...');
  buildServer();
}

(async () => {
  for (const suite of SUITES) {
    console.log('\n=== Running ' + suite + ' ===');
    await runSuite(suite);
  }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

function runSuite(suite) {
  return new Promise((resolve) => {
    const p = spawn('node', [path.join(__dirname, suite)], { stdio: 'inherit', cwd: ROOT });
    p.on('exit', (code) => {
      if (code !== 0 && exitCode === 0) exitCode = code;
      resolve();
    });
  });
}