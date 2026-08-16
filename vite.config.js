// Vite config for Hearth's frontend build. See docs/codebase-quickref.md for
// the high-level layout. Key choices:
//
//   root: '.'              repo root is the project root
//   entry: index.html      single-page entry; Vite scans <link>/<script> tags
//   publicDir: 'public'    icons/, assets/, manifest.webmanifest — see the
//                          README "Install & Run" section
//   outDir:   'dist'       Go's //go:embed pulls from here after `npm run build`
//   assetsDir: 'static'    hashed JS/CSS output lives at dist/static/* so the
//                          server can safely send `Cache-Control: immutable`
//                          on /static/* without also pinning the unhashed
//                          public assets under /assets/* and /icons/* to a
//                          stale copy.
//   manifest: true         emits dist/.vite/manifest.json mapping source ->
//                          hashed output; scripts/patch-sw.mjs uses this to
//                          rewrite the hand-written sw.js SHELL list after
//                          vite build, so the SW precaches by hashed URL.
//
// The dev server proxies /api, /join, /auth, /sw.js, and any other
// non-static route to a Go server running alongside (port 8443 by default,
// override with HMR_BACKEND env if needed). See README "Development".
import { defineConfig } from 'vite';

const backend = process.env.HMR_BACKEND || 'http://127.0.0.1:8443';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'static',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // API/auth/caregiver/sync/etc. all live under /api/ — proxy the whole
      // subtree. The Go server stays the source of truth for everything
      // except the bundled frontend assets.
      '/api': { target: backend, changeOrigin: true },
      // Caregiver-join landing page is server-rendered by Go (see serveShell
      // in server/router.go). Proxy to Go for the same /index.html the
      // shell gets — Vite has no opinion about it, Go is authoritative.
      '/join': { target: backend, changeOrigin: true },
      // OAuth begin/callback routes
      '/auth': { target: backend, changeOrigin: true },
      // The hand-written sw.js is shipped from the Go server in dev too,
      // so editor changes there show up on reload without a Vite rebuild.
      '/sw.js': { target: backend, changeOrigin: true },
    },
  },
});
