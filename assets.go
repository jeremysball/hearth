// Package hearth exposes the bundled frontend assets. Vite produces dist/
// (index.html + hashed JS/CSS in assets/ + manifest + icons + assets/), then
// the Go binary embeds everything under dist/ so the server can serve a
// self-contained build with no separate frontend step at runtime.
//
// To rebuild the embedded assets: run `npm ci && npm run build` (or the
// project's Dockerfile which does the same), then `go build`. Until npm run
// build has run, dist/ is a tracked placeholder directory (see .gitignore's
// `!dist/.gitkeep` rule) so `go build` itself does not require the rebuild.
//
// paths inside StaticFS are relative to the dist/ root: index.html,
// manifest.webmanifest, sw.js, assets/…, icons/…. Routes use
// `fs.Sub(StaticFS, "dist")` to strip the prefix so HTTP paths match what
// the client and the index.html itself already use ("/index.html",
// "/manifest.webmanifest", "/sw.js", "/assets/<hash>.js", "/icons/...").
package hearth

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distAll embed.FS

// StaticFS is the production asset tree the router serves. Initialised once
// at startup to a sub-FS rooted at the embedded dist/, so callers can use
// "index.html" / "sw.js" / "assets/<hash>.js" the same way regardless of
// whether the source lives at the repo root (dev, when STATIC_DIR=.) or in
// the post-build dist/ directory (production).
var StaticFS fs.FS

func init() {
	sub, err := fs.Sub(distAll, "dist")
	if err != nil {
		// unreachable: the `dist` directory is guaranteed by the embed
		// directive above plus the .gitkeep placeholder tracked in git.
		panic("hearth: could not sub dist/ from embedded FS: " + err.Error())
	}
	StaticFS = sub
}
