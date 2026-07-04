// tests/run.js — unified test runner: lint, unit, Go, and E2E legs.
// `npm test` runs all four (lint fail-fast; unit/go/e2e buffer output and
// keep going so one leg's failure doesn't hide another's).
// `npm test -- --e2e-only` (or `npm run test:e2e`) runs only the E2E leg —
// used by the CI e2e matrix job, which already has separate lint/unit/go jobs.

const { spawn, spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'hearth-server');
const E2E_SUITES = readdirSync(__dirname).filter(f => f.endsWith('.test.js'));
const UNIT_SUITES = readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.test.js'));
const BASE_PORT = 19000;
const CONCURRENCY = Math.min(Number(process.env.TEST_CONCURRENCY) || 1, E2E_SUITES.length);
const E2E_ONLY = process.argv.includes('--e2e-only');

function buildServer() {
  spawnSync('go', ['build', '-o', BIN, './cmd/hearth'], { cwd: ROOT, stdio: 'pipe' });
}

function runBuffered(label, cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  const output = (result.stdout || '') + (result.stderr || '');
  process.stdout.write('\n=== ' + label + ' ===\n' + output);
  return { label, ok: result.status === 0 };
}

function runSuite(suite, port) {
  return new Promise((resolve) => {
    const chunks = ['\n=== Running ' + suite + ' ===\n'];
    const p = spawn('node', [path.join(__dirname, suite)], {
      stdio: 'pipe',
      cwd: ROOT,
      env: { ...process.env, TEST_PORT: String(port), HEARTH_SERVER_PREBUILT: '1' },
    });
    p.stdout.on('data', (d) => chunks.push(d.toString()));
    p.stderr.on('data', (d) => chunks.push(d.toString()));
    p.on('exit', (code) => resolve({ output: chunks.join(''), code: code || 0 }));
  });
}

async function runE2E() {
  console.log('Building hearth-server...');
  buildServer();
  console.log('Running ' + E2E_SUITES.length + ' suites (' + CONCURRENCY + ' parallel)\n');

  const results = new Array(E2E_SUITES.length).fill(null);
  let next = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < E2E_SUITES.length) {
        const i = next++;
        process.stdout.write('starting ' + E2E_SUITES[i] + ' on port ' + (BASE_PORT + i) + '\n');
        results[i] = await runSuite(E2E_SUITES[i], BASE_PORT + i);
      }
    })
  );

  let pass = 0, fail = 0, anyNonZeroExit = false;
  for (const { output, code } of results) {
    process.stdout.write(output);
    if (code !== 0) anyNonZeroExit = true;
    const m = output.match(/(\d+) pass, (\d+) fail/);
    if (m) { pass += Number(m[1]); fail += Number(m[2]); }
  }
  return { label: 'e2e', ok: fail === 0 && !anyNonZeroExit, detail: pass + ' pass, ' + fail + ' fail' };
}

(async () => {
  const legs = [];

  if (E2E_ONLY) {
    legs.push(await runE2E());
  } else {
    const lint = runBuffered('lint', 'npm', ['run', 'check']);
    legs.push(lint);
    if (!lint.ok) {
      printSummary(legs);
      process.exit(1);
    }
    legs.push(runBuffered('unit', 'node', ['--test', ...UNIT_SUITES.map(f => path.join('js', f))]));
    legs.push(runBuffered('go', 'go', ['test', './server']));
    legs.push(await runE2E());
  }

  printSummary(legs);
  process.exit(legs.every(l => l.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

function printSummary(legs) {
  console.log('\n=== SUMMARY ===');
  for (const leg of legs) {
    const status = leg.ok ? '✓' : '✗ FAIL';
    console.log(leg.label + ' ' + status + (leg.detail ? ' ' + leg.detail : ''));
  }
}
