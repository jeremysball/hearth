#!/usr/bin/env bash
# Generates site/robots.txt and site/sitemap.xml at deploy time so they
# never drift from the live page. The canonical host comes from site/CNAME;
# lastmod is the last commit date that touched the page. Run after
# stage-site-assets.sh and before the Pages artifact upload.
set -euo pipefail
cd "$(dirname "$0")/.."

host="$(tr -d '[:space:]' < site/CNAME)"
base="https://${host}"
lastmod="$(git log -1 --format=%cs -- site/index.html)"

cat > site/robots.txt <<EOF
User-agent: *
Allow: /
Sitemap: ${base}/sitemap.xml
EOF

cat > site/sitemap.xml <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
EOF

echo "Generated robots.txt and sitemap.xml for ${base} (lastmod ${lastmod})"
