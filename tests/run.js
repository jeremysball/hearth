// tests/run.js — orchestrate all Hearth browser tests in parallel.
// Builds the Go binary once, then runs every *.test.js concurrently (up to
// CONCURRENCY at a time), each on its own port. Output is buffered per suite
// and printed in original alphabetical order after all suites finish.

const { execSync, spawn } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'hearth-server');
const SUITES = readdirSync(__dirname).filter(f => f.endsWith('.test.js'));
const BASE_PORT = 19000;
const CONCURRENCY = Math.min(Number(process.env.TEST_CONCURRENCY) || 1, SUITES.length);

function buildServer() {
  execSync('go build -o ' + BIN + ' .', { cwd: path.join(ROOT, 'server'), stdio: 'pipe' });
}

(async () => {
  console.log('Building hearth-server...');
  buildServer();

  console.log('Running ' + SUITES.length + ' suites (' + CONCURRENCY + ' parallel)\n');

  const results = new Array(SUITES.length).fill(null);
  let next = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < SUITES.length) {
        const i = next++;
        process.stdout.write('starting ' + SUITES[i] + ' on port ' + (BASE_PORT + i) + '\n');
        results[i] = await runSuite(SUITES[i], BASE_PORT + i);
      }
    })
  );

  let exitCode = 0;
  let totalPass = 0, totalFail = 0;
  for (const { output, code } of results) {
    process.stdout.write(output);
    if (code !== 0 && exitCode === 0) exitCode = code;
    const m = output.match(/(\d+) pass, (\d+) fail/);
    if (m) { totalPass += Number(m[1]); totalFail += Number(m[2]); }
  }

  process.stdout.write('\n=== ALL SUITES DONE === ' + totalPass + ' pass, ' + totalFail + ' fail, exit ' + exitCode + '\n');
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

function runSuite(suite, port) {
  return new Promise((resolve) => {
    const chunks = ['\n=== Running ' + suite + ' ===\n'];
    const p = spawn('node', [path.join(__dirname, suite)], {
      stdio: 'pipe',
      cwd: ROOT,
      env: { ...process.env, TEST_PORT: String(port) },
    });
    p.stdout.on('data', (d) => chunks.push(d.toString()));
    p.stderr.on('data', (d) => chunks.push(d.toString()));
    p.on('exit', (code) => resolve({ output: chunks.join(''), code: code || 0 }));
  });
}
