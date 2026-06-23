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
	certFile := os.Getenv("CERT_FILE")
	keyFile := os.Getenv("KEY_FILE")

	// If cert files are relative paths, try parent directory
	if certFile != "" {
		if _, err := os.Stat(certFile); err != nil {
			if _, err := os.Stat("../" + certFile); err == nil {
				certFile = "../" + certFile
			}
		}
	}
	if keyFile != "" {
		if _, err := os.Stat(keyFile); err != nil {
			if _, err := os.Stat("../" + keyFile); err == nil {
				keyFile = "../" + keyFile
			}
		}
	}

	return Config{
		Host:      getenv("HOST", "0.0.0.0"),
		Port:      getenv("PORT", "8443"),
		CertFile:  certFile,
		KeyFile:   keyFile,
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
		// Try parent directory if file not found in current directory
		if path == ".env" {
			f, err = os.Open("../.env")
			if err != nil {
				return
			}
		} else {
			return
		}
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
