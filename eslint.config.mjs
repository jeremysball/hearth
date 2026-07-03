import js from '@eslint/js';
import globals from 'globals';

// Hearth is a no-build vanilla project: ES-module browser code under js/,
// a service worker (sw.js), and Node-run test scripts under tests/.
// Each gets its own global environment so `no-undef` is accurate.
export default [
  // Non-source trees: deps, agent/tooling state (incl. nested worktree copies),
  // and untracked local scratch scripts. None of these are project source.
  { ignores: ['node_modules/**', '.claude/**', '.worktrees/**', '_screenshot.js'] },

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

  // Node-run CommonJS test scripts and dev tooling scripts
  {
    files: ['tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
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
