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
}

func loadConfig() Config {
	loadEnvFile(".env")
	return Config{
		Host:      getenv("HOST", "0.0.0.0"),
		Port:      getenv("PORT", "8443"),
		CertFile:  os.Getenv("CERT_FILE"),
		KeyFile:   os.Getenv("KEY_FILE"),
		DBPath:    getenv("DB_PATH", "hearth.db"),
		StaticDir: getenv("STATIC_DIR", "."),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
