package hearth

import "embed"

//go:embed index.html js styles.css icons assets manifest.webmanifest sw.js
var StaticFS embed.FS
