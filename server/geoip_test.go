package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetupGeoIPDisabledWhenNotConfigured(t *testing.T) {
	geo, err := setupGeoIP(Config{})
	if err != nil {
		t.Fatalf("setupGeoIP returned error: %v", err)
	}
	if geo != nil {
		t.Fatalf("setupGeoIP returned %v, want nil", geo)
	}
}

func TestSetupGeoIPPromptsWhenEnabledWithoutDatabaseOrLicense(t *testing.T) {
	_, err := setupGeoIP(Config{GeoIPEnabled: true, GeoIPDBPath: filepath.Join(t.TempDir(), "GeoLite2-City.mmdb")})
	if err == nil {
		t.Fatal("expected an error")
	}
	msg := err.Error()
	for _, want := range []string{"GeoIP is enabled", "GEOIP_DB_PATH", "MAXMIND_LICENSE_KEY", "MaxMind"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("error missing %q in %q", want, msg)
		}
	}
}

func TestSetupGeoIPDownloadsDatabaseWhenLicenseKeyConfigured(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "GeoLite2-City.mmdb")
	prev := downloadMaxMindDB
	downloadMaxMindDB = func(licenseKey, dest string) error {
		if licenseKey != "license" {
			t.Fatalf("licenseKey = %q", licenseKey)
		}
		return os.WriteFile(dest, []byte("fake-mmdb"), 0644)
	}
	t.Cleanup(func() { downloadMaxMindDB = prev })

	_, err := setupGeoIP(Config{GeoIPEnabled: true, GeoIPDBPath: dbPath, MaxMindLicenseKey: "license"})
	if err == nil {
		t.Fatal("expected invalid fake database error after download")
	}
	data, readErr := os.ReadFile(dbPath)
	if readErr != nil {
		t.Fatalf("expected downloaded db at %s: %v", dbPath, readErr)
	}
	if string(data) != "fake-mmdb" {
		t.Fatalf("db contents = %q", data)
	}
}
