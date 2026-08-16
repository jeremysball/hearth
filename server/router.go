package server

import (
	"database/sql"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jeremysball/hearth"
)

var requestGeoIP *geoIP

// logMiddleware logs every API request with origin, auth, and timing context.
// Static file requests (no /api/ prefix) are logged at a lower signal, only
// non-200 responses, to avoid noise from the shell assets.
func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		isAPI := len(r.URL.Path) > 4 && r.URL.Path[:5] == "/api/"
		if isAPI || rw.status >= 400 {
			origin := requestOrigin(r)
			geo := mergeGeoInfo(geoFromHeaders(r), requestGeoIP.Lookup(origin.IP))
			logRequest(requestLogInfo{
				Method: r.Method, Path: r.URL.Path, Status: rw.status, Duration: time.Since(start), Host: r.Host,
				IP: origin.IP, Remote: origin.Remote, XFF: origin.XFF, XRealIP: origin.XRealIP, Forwarded: origin.Forwarded,
				UserAgent: r.UserAgent(), Caregiver: rw.session.CaregiverID, Family: rw.session.FamilyID, Geo: geo,
			})
		}
	})
}

type statusWriter struct {
	http.ResponseWriter
	status  int
	session SessionInfo
}

func (sw *statusWriter) WriteHeader(status int) {
	sw.status = status
	sw.ResponseWriter.WriteHeader(status)
}

// Flush forwards to the wrapped writer so handlers behind logMiddleware can
// still be recognized as http.Flusher (e.g. handleEvents' SSE stream).
// Embedding the http.ResponseWriter interface only promotes Header/Write/
// WriteHeader, not Flush, so without this SSE always 500s here.
func (sw *statusWriter) Flush() {
	if f, ok := sw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (sw *statusWriter) setSession(session SessionInfo) {
	sw.session = session
}

// cacheControl handles the HTTP-cache story in one place. After the Vite
// migration, frontend JS/CSS bundles are emitted with content-hashed
// filenames under dist/static/ (see vite.config.js `assetsDir: 'static'`),
// so dist/index.html's <script> tag points at /static/<name>-<hash>.js and
// that exact URL's bytes will never change under the same hash. We send
// `Cache-Control: public, max-age=31536000, immutable` for that subtree so
// the browser can skip revalidation entirely. The unhashed public assets
// under /assets/* (sky, textures, foods) and /icons/* are NOT cacheable as
// immutable — their filenames don't change when their contents do, so an
// `immutable` header would pin a stale copy for a year on every user after
// the first edit. Those fall through to the file server's default
// behaviour (heuristic caching, revalidates with If-None-Match when the
// upstream sets ETag). The two entry points that gate updates — index.html
// (carries the <meta name="version">) and sw.js (the SW itself) — are
// forced to no-store by their own explicit route handlers, see serveShell
// below. Developer mode (?dev=1 or X-Hearth-Dev: 1) bypasses everything:
// every request goes through this handler in dev, and the no-store branch
// outranks the immutable branch, so a hot edit→refresh loop always hits
// the network. See sw.js's fetch handler for the Cache Storage counterpart.
func cacheControl(next http.Handler, cfg Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Dev bypass always wins — forced revalidation, ignore the rest.
		if r.URL.Query().Get("dev") == "1" || r.Header.Get("X-Hearth-Dev") == "1" || cfg.DevMode {
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r)
			return
		}
		// Hashed Vite bundles under /static/* are content-addressed; their
		// filename changes when their bytes change, so the URL is stable
		// for forever, which is exactly what `immutable` requires.
		if strings.HasPrefix(r.URL.Path, "/static/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		next.ServeHTTP(w, r)
	})
}

func newRouter(db *sql.DB, hub *Hub, staticDir string, cfg Config, pushes *pushScheduler) http.Handler {
	var staticFS fs.FS = hearth.StaticFS
	if staticDir != "" {
		staticFS = os.DirFS(staticDir)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/family", handleCreateFamily(db))
	mux.HandleFunc("GET /api/status", handleStatus(db, cfg))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("GET /api/sync", requireAuth(db, handleSync(db)))
	mux.HandleFunc("GET /api/push/public-key", requireAuth(db, handlePushPublicKey()))
	mux.HandleFunc("POST /api/push/subscribe", requireAuth(db, handlePushSubscribe(db)))
	mux.HandleFunc("POST /api/push/test", requireAuth(db, handlePushTest(pushes)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/launch-tokens", requireAuth(db, handleCreateLaunchToken(db)))
	mux.HandleFunc("GET /api/launch/{token}", handleRedeemLaunchToken(db))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db, hub))
	mux.HandleFunc("POST /api/dev/join", handleDevJoin(db, hub, cfg))
	// index.html carries the <meta name="version"> that bump-version.sh
	// updates on every release, and the service worker's network-first
	// navigation handler only skips its own Cache Storage, it doesn't stop
	// the browser's HTTP cache from silently satisfying that fetch with a
	// stale copy. Same reasoning as the sw.js route below: force revalidation
	// so a device can't get pinned to an old shell.
	serveShell := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFileFS(w, r, staticFS, "index.html")
	}
	mux.HandleFunc("GET /join/{token}", serveShell)
	// sw.js gates every frontend fix: browsers only learn a new one exists by
	// re-fetching this file. Without an explicit header they may serve a
	// stale HTTP-cached copy indefinitely (well, up to the 24h spec backstop),
	// silently pinning the client to old cached JS. Force revalidation.
	mux.HandleFunc("GET /sw.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFileFS(w, r, staticFS, "sw.js")
	})
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub, pushes)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.HandleFunc("PUT /api/growth/{id}", requireAuth(db, handleUpsertGrowth(db, hub)))
	mux.HandleFunc("DELETE /api/growth/{id}", requireAuth(db, handleDeleteGrowth(db, hub)))
	mux.HandleFunc("PATCH /api/baby", requireAuth(db, handlePatchBaby(db, hub)))
	mux.HandleFunc("PATCH /api/settings", requireAuth(db, handlePatchSettings(db, hub, pushes)))
	mux.HandleFunc("GET /api/caregivers", requireAuth(db, handleListCaregivers(db)))
	mux.HandleFunc("PATCH /api/caregivers/me", requireAuth(db, handlePatchCurrentCaregiver(db, hub)))
	mux.HandleFunc("PATCH /api/caregivers/{id}/role", requireAuth(db, handlePatchCaregiverRole(db, hub)))
	mux.HandleFunc("DELETE /api/caregivers/{id}", requireAuth(db, handleRemoveCaregiver(db, hub)))
	mux.HandleFunc("GET /api/auth/{provider}", handleAuthBegin(cfg))
	mux.HandleFunc("GET /api/auth/{provider}/callback", handleAuthCallback(db, hub, cfg))
	mux.HandleFunc("GET /api/me", requireAuth(db, handleMe(db)))
	mux.HandleFunc("POST /api/auth/signout", requireAuth(db, handleSignout(db)))
	mux.HandleFunc("GET /api/conflict/{pending}", handleConflictInfo(db))
	mux.HandleFunc("POST /api/auth/resolve", handleResolve(db, hub))
	mux.HandleFunc("GET /{$}", serveShell)
	mux.HandleFunc("GET /index.html", serveShell)
	mux.Handle("/", cacheControl(http.FileServerFS(staticFS), cfg))
	return logMiddleware(mux)
}
