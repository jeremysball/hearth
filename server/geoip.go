package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/oschwald/maxminddb-golang"
)

type geoIP struct {
	db *maxminddb.Reader
}

type geoInfo struct {
	Country string
	Region  string
	City    string
}

var downloadMaxMindDB = downloadMaxMindDBArchive

func setupGeoIP(cfg Config) (*geoIP, error) {
	if !cfg.GeoIPEnabled {
		return nil, nil
	}
	if cfg.GeoIPDBPath == "" {
		return nil, fmt.Errorf("GeoIP is enabled but GEOIP_DB_PATH is empty; set GEOIP_DB_PATH to a MaxMind GeoLite2-City .mmdb file, or set MAXMIND_LICENSE_KEY so Hearth can download it")
	}
	if _, err := os.Stat(cfg.GeoIPDBPath); err != nil {
		if !os.IsNotExist(err) {
			return nil, err
		}
		if cfg.MaxMindLicenseKey == "" {
			return nil, fmt.Errorf("GeoIP is enabled but %s does not exist; download GeoLite2-City.mmdb from MaxMind and set GEOIP_DB_PATH, or set MAXMIND_LICENSE_KEY so Hearth can acquire it", cfg.GeoIPDBPath)
		}
		if err := downloadMaxMindDB(cfg.MaxMindLicenseKey, cfg.GeoIPDBPath); err != nil {
			return nil, fmt.Errorf("downloading GeoIP database: %w", err)
		}
	}
	db, err := maxminddb.Open(cfg.GeoIPDBPath)
	if err != nil {
		return nil, fmt.Errorf("opening GeoIP database %s: %w", cfg.GeoIPDBPath, err)
	}
	return &geoIP{db: db}, nil
}

func (g *geoIP) Close() error {
	if g == nil || g.db == nil {
		return nil
	}
	return g.db.Close()
}

func (g *geoIP) Lookup(ipText string) geoInfo {
	if g == nil || g.db == nil || ipText == "" {
		return geoInfo{}
	}
	ip := net.ParseIP(ipText)
	if ip == nil {
		return geoInfo{}
	}
	var rec struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
		Subdivisions []struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"subdivisions"`
		City struct {
			Names map[string]string `maxminddb:"names"`
		} `maxminddb:"city"`
	}
	if err := g.db.Lookup(ip, &rec); err != nil {
		return geoInfo{}
	}
	info := geoInfo{Country: rec.Country.ISOCode}
	if len(rec.Subdivisions) > 0 {
		info.Region = rec.Subdivisions[0].ISOCode
	}
	info.City = rec.City.Names["en"]
	return info
}

func geoFromHeaders(r *http.Request) geoInfo {
	return geoInfo{
		Country: firstHeader(r, "CF-IPCountry", "X-Vercel-IP-Country", "X-Appengine-Country"),
		Region:  firstHeader(r, "X-Vercel-IP-Country-Region", "X-Appengine-Region"),
		City:    firstHeader(r, "X-Vercel-IP-City", "X-Appengine-City"),
	}
}

func firstHeader(r *http.Request, names ...string) string {
	for _, name := range names {
		if v := strings.TrimSpace(r.Header.Get(name)); v != "" {
			return sanitizeLogValue(v)
		}
	}
	return ""
}

func downloadMaxMindDBArchive(licenseKey, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}
	params := url.Values{}
	params.Set("edition_id", "GeoLite2-City")
	params.Set("license_key", licenseKey)
	params.Set("suffix", "tar.gz")
	url := "https://download.maxmind.com/app/geoip_download?" + params.Encode()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("MaxMind returned %s", resp.Status)
	}
	return extractMMDB(resp.Body, dest)
}

func extractMMDB(src io.Reader, dest string) error {
	gz, err := gzip.NewReader(src)
	if err != nil {
		return err
	}
	defer gz.Close()
	tw := tar.NewReader(gz)
	for {
		h, err := tw.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if h.Typeflag != tar.TypeReg || !strings.HasSuffix(h.Name, ".mmdb") {
			continue
		}
		tmp := dest + ".tmp"
		out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, tw)
		closeErr := out.Close()
		if copyErr != nil {
			os.Remove(tmp)
			return copyErr
		}
		if closeErr != nil {
			os.Remove(tmp)
			return closeErr
		}
		return os.Rename(tmp, dest)
	}
	return fmt.Errorf("archive did not contain an .mmdb file")
}
