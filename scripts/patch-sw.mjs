#!/usr/bin/env node
// Patch the hand-written sw.js against Vite's actual output:
//  - read dist/.vite/manifest.json (built by `vite build`)
//  - rewrite every active './js/*.js' or './styles.css' string in sw.js's SHELL
//    array to the chunk path Vite emitted for that source
//  - leave public-dir pass-throughs (./assets/.../*, ./icons/.../*,
//    ./manifest.webmanifest, ./, ./index.html, ./sw.js) untouched — Vite
//    copies them to dist/ at their original paths, no hash
//  - keep all line comments verbatim so the SHELL stays self-documenting
//
// Run after `vite build`. Idempotent: re-running on an already-patched
// sw.js (./assets/<hash>.js strings) is a no-op.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, 'dist');
const manifestPath = join(distDir, '.vite', 'manifest.json');
const sourceSw = join(root, 'sw.js');
const distSw = join(distDir, 'sw.js');

if (!existsSync(manifestPath)) {
  console.error(`patch-sw: no manifest at ${manifestPath} — run \`vite build\` first.`);
  process.exit(1);
}
if (!existsSync(sourceSw)) {
  console.error(`patch-sw: no sw.js at ${sourceSw}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const swSrc = readFileSync(sourceSw, 'utf8');

// Build a map of every source path -> emitted chunk file. Every chunk
// in dist/ that Vite tracks is in this map; static imports absorbed into
// the entry chunk are NOT (their source path doesn't appear as a key),
// so we handle that case in resolvePath() below.
const chunkBySource = new Map();
for (const [, entry] of Object.entries(manifest)) {
  if (entry?.src && entry.file) {
    chunkBySource.set(entry.src, entry.file);
  }
}

// The entry chunk's emitted filename is manifest['index.html'].file. CSS
// emitted for the entry lives at manifest['index.html'].css[0].
const entry = manifest['index.html'];
const entryJs = entry?.file;
const entryCss = entry?.css?.[0];
if (!entryJs) {
  console.error('patch-sw: manifest has no entry chunk (index.html missing?)');
  process.exit(1);
}

function resolvePath(p) {
  // p is './something' relative to site root; normalize to 'something'.
  const rel = p.replace(/^\.\//, '');

  // Vite-processed source: a JS module
  if (rel === 'styles.css') return entryCss ? `./${entryCss}` : p;
  if (rel.startsWith('js/') && rel.endsWith('.js')) {
    if (chunkBySource.has(rel)) return `./${chunkBySource.get(rel)}`;
    // Absorbed into entry chunk — that's where its bytes live now.
    return `./${entryJs}`;
  }
  // Anything else (publicDir passthrough, './', './index.html',
  // './manifest.webmanifest', './sw.js', './assets/*', './icons/*'):
  // Vite emitted them at the same path under dist/.
  return p;
}

const isSwCommentedLazy = /^\s*\/\/\s*'\./; // '  //   \'./js/sleep.js\','
const isSwEntry = /^(?<indent>\s*)'(?<path>\.\/[^']+)'(?<rest>,?[^']*)$/;

const patchedLines = swSrc.split('\n').map((line) => {
  const m = line.match(isSwEntry);
  if (!m) return line;
  if (isSwCommentedLazy.test(line)) return line; // doc-only commented path
  const { indent, path, rest } = m.groups;
  const rewritten = resolvePath(path);
  if (rewritten === path) return line;
  return `${indent}'${rewritten}'${rest}`;
});

writeFileSync(distSw, patchedLines.join('\n'));

const dedup = new Set();
const activeEntries = patchedLines
  .filter((l) => /^\s*'\./.test(l) && !isSwCommentedLazy.test(l))
  .map((l) => (l.match(/'\.\/[^']+'/)?.[0] ?? ''));
for (const e of activeEntries) dedup.add(e);
console.log(
  `patch-sw: wrote ${distSw} (${activeEntries.length} active SHELL entries, ${dedup.size} unique URLs)`
);
