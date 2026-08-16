import js from '@eslint/js';
import globals from 'globals';

// Hearth is a no-build vanilla project: ES-module browser code under js/,
// a service worker (sw.js), and Node-run test scripts under tests/.
// Each gets its own global environment so `no-undef` is accurate.
export default [
  // Non-source trees: deps, agent/tooling state (incl. nested worktree copies),
  // and untracked local scratch scripts. None of these are project source.
  { ignores: ['node_modules/**', '.claude/**', '.worktrees/**', '_screenshot.js', 'dist/**'] },

  js.configs.recommended,

  // Project-wide rule tuning: keep the high-signal bug catchers as errors
  // (no-undef, no-redeclare, no-const-assign, no-dupe-keys, no-unreachable…
  // — these block the commit), demote stylistic noise to warnings so it
  // informs without halting work.
  {
    rules: {
      'no-unused-vars': ['warn', { caughtErrors: 'none', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-useless-assignment': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Browser ES modules
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },

  // Service worker (script context, SW globals: self, caches, clients)
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },

  // Node-run CommonJS test scripts
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Node-run dev scripts (e.g. scripts/sky-phases.js, scripts/patch-sw.mjs):
  // same shape as tests/ — Node globals for the script itself, browser
  // globals for the in-page callbacks passed to page.evaluate(). Uses ESM
  // (`sourceType: 'module'`) so .mjs files like patch-sw.mjs pick up the
  // same env, and `top-level await` (which patch-sw.mjs does not need but
  // sibling scripts may).
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Vite config: pure Node ESM. Lives at repo root, not under js/scripts/
  // — give it node globals only (no DOM).
  {
    files: ['vite.config.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Test files also live under js/ (e.g. js/store.test.js, run via `node:test`).
  // The js/**/*.js block above only gives them browser globals; layer Node globals
  // on top for ANY *.test.js regardless of directory. Only contributes globals, so
  // sourceType (module under js/, commonjs under tests/) is left intact by the merge.
  {
    files: ['**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
