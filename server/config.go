package main

import (
	"bufio"
	"os"
	"strings"
)

type Config struct {
	Host      string
	Port      string
	CertFile  string
	KeyFile   string
	DBPath    string
	StaticDir string

	GeoIPEnabled      bool
	GeoIPDBPath       string
	MaxMindLicenseKey string

	PublicBaseURL      string
	GoogleClientID     string
	GoogleClientSecret string
	AppleClientID      string
	AppleClientSecret  string
	AppleTeamID        string
	AppleKeyID         string
}

func loadConfig() Config {
	loadEnvFile(".env")
	return Config{
		Host:      getenv("HOST", "0.0.0.0"),
		Port:      getenv("PORT", "8443"),
		CertFile:  os.Getenv("CERT_FILE"),
		KeyFile:   os.Getenv("KEY_FILE"),
		DBPath:    getenv("DB_PATH", "hearth.db"),
		StaticDir: getenv("STATIC_DIR", ""),

		GeoIPEnabled:      envBool("GEOIP_ENABLED"),
		GeoIPDBPath:       os.Getenv("GEOIP_DB_PATH"),
		MaxMindLicenseKey: os.Getenv("MAXMIND_LICENSE_KEY"),

		PublicBaseURL:      os.Getenv("PUBLIC_BASE_URL"),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		AppleClientID:      os.Getenv("APPLE_CLIENT_ID"),
		AppleClientSecret:  os.Getenv("APPLE_CLIENT_SECRET"),
		AppleTeamID:        os.Getenv("APPLE_TEAM_ID"),
		AppleKeyID:         os.Getenv("APPLE_KEY_ID"),
	}
}

func (c Config) OAuthConfigured(provider string) bool {
	switch provider {
	case "google":
		return c.PublicBaseURL != "" && c.GoogleClientID != "" && c.GoogleClientSecret != ""
	case "apple":
		return c.PublicBaseURL != "" && c.AppleClientID != "" && c.AppleClientSecret != "" && c.AppleTeamID != "" && c.AppleKeyID != ""
	}
	return false
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// loadEnvFile reads KEY=VALUE lines from path into the process environment,
// skipping blank lines and lines starting with '#'. It never overwrites a
// variable that's already set in the real environment.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, val)
		}
	}
}
