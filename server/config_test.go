package main

import (
	"os"
	"testing"
)

func TestLoadEnvFileSetsUnsetVars(t *testing.T) {
	dir := t.TempDir()
	envPath := dir + "/.env"
	if err := os.WriteFile(envPath, []byte("FOO_TEST_KEY=bar\n# a comment\n\nBAZ_TEST_KEY=\"quoted\"\n"), 0644); err != nil {
		t.Fatal(err)
	}
	os.Unsetenv("FOO_TEST_KEY")
	os.Unsetenv("BAZ_TEST_KEY")

	loadEnvFile(envPath)

	if got := os.Getenv("FOO_TEST_KEY"); got != "bar" {
		t.Fatalf("expected FOO_TEST_KEY=bar, got %q", got)
	}
	if got := os.Getenv("BAZ_TEST_KEY"); got != "quoted" {
		t.Fatalf("expected BAZ_TEST_KEY=quoted, got %q", got)
	}
	os.Unsetenv("FOO_TEST_KEY")
	os.Unsetenv("BAZ_TEST_KEY")
}

func TestLoadEnvFileDoesNotOverrideExistingVars(t *testing.T) {
	dir := t.TempDir()
	envPath := dir + "/.env"
	os.WriteFile(envPath, []byte("OVERRIDE_TEST_KEY=fromfile\n"), 0644)
	os.Setenv("OVERRIDE_TEST_KEY", "fromenv")
	defer os.Unsetenv("OVERRIDE_TEST_KEY")

	loadEnvFile(envPath)

	if got := os.Getenv("OVERRIDE_TEST_KEY"); got != "fromenv" {
		t.Fatalf("expected real env var to win, got %q", got)
	}
}

func TestGetenvFallback(t *testing.T) {
	os.Unsetenv("MISSING_TEST_KEY")
	if got := getenv("MISSING_TEST_KEY", "default"); got != "default" {
		t.Fatalf("expected default, got %q", got)
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	for _, k := range []string{"HOST", "PORT", "DB_PATH", "STATIC_DIR", "GEOIP_ENABLED", "GEOIP_DB_PATH", "MAXMIND_LICENSE_KEY"} {
		os.Unsetenv(k)
	}
	cfg := loadConfig()
	if cfg.Host != "0.0.0.0" {
		t.Errorf("Host = %q, want 0.0.0.0", cfg.Host)
	}
	if cfg.Port != "8443" {
		t.Errorf("Port = %q, want 8443", cfg.Port)
	}
	if cfg.DBPath != "hearth.db" {
		t.Errorf("DBPath = %q, want hearth.db", cfg.DBPath)
	}
	if cfg.StaticDir != "" {
		t.Errorf("StaticDir = %q, want empty (embedded by default)", cfg.StaticDir)
	}
	if cfg.GeoIPEnabled {
		t.Error("GeoIPEnabled = true, want false by default")
	}
}

func TestLoadConfigReadsGeoIPEnv(t *testing.T) {
	os.Setenv("GEOIP_ENABLED", "true")
	os.Setenv("GEOIP_DB_PATH", "/var/lib/hearth/GeoLite2-City.mmdb")
	os.Setenv("MAXMIND_LICENSE_KEY", "license")
	defer func() {
		os.Unsetenv("GEOIP_ENABLED")
		os.Unsetenv("GEOIP_DB_PATH")
		os.Unsetenv("MAXMIND_LICENSE_KEY")
	}()

	cfg := loadConfig()
	if !cfg.GeoIPEnabled {
		t.Error("GeoIPEnabled = false, want true")
	}
	if cfg.GeoIPDBPath != "/var/lib/hearth/GeoLite2-City.mmdb" {
		t.Errorf("GeoIPDBPath = %q", cfg.GeoIPDBPath)
	}
	if cfg.MaxMindLicenseKey != "license" {
		t.Errorf("MaxMindLicenseKey = %q", cfg.MaxMindLicenseKey)
	}
}

func TestLoadConfigReadsOAuthEnv(t *testing.T) {
	os.Setenv("PUBLIC_BASE_URL", "https://hearth.example")
	os.Setenv("GOOGLE_CLIENT_ID", "gid")
	os.Setenv("GOOGLE_CLIENT_SECRET", "gsec")
	defer func() {
		os.Unsetenv("PUBLIC_BASE_URL")
		os.Unsetenv("GOOGLE_CLIENT_ID")
		os.Unsetenv("GOOGLE_CLIENT_SECRET")
	}()
	c := loadConfig()
	if c.PublicBaseURL != "https://hearth.example" {
		t.Errorf("PublicBaseURL = %q", c.PublicBaseURL)
	}
	if !c.OAuthConfigured("google") {
		t.Error("expected google to be configured")
	}
	if c.OAuthConfigured("apple") {
		t.Error("apple should be unconfigured without its env")
	}
}
