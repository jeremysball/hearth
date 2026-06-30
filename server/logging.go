package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

type logStyle struct {
	enabled bool
}

var currentLogStyle = newLogStyle()

func newLogStyle() logStyle {
	return logStyle{enabled: isTerminal(os.Stderr)}
}

func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

func (s logStyle) color(code, value string) string {
	if !s.enabled {
		return value
	}
	return "\x1b[" + code + "m" + value + "\x1b[0m"
}

func (s logStyle) event(value string) string {
	switch value {
	case "auth":
		return s.color("35", value)
	case "geoip":
		return s.color("36", value)
	default:
		return value
	}
}

func (s logStyle) status(status int) string {
	value := fmt.Sprintf("status=%d", status)
	switch {
	case status >= 500:
		return s.color("31", value)
	case status >= 400:
		return s.color("33", value)
	case status >= 300:
		return s.color("36", value)
	default:
		return s.color("32", value)
	}
}

type requestLogInfo struct {
	Method    string
	Path      string
	Status    int
	Duration  time.Duration
	Host      string
	IP        string
	Remote    string
	XFF       string
	XRealIP   string
	Forwarded string
	UserAgent string
	Caregiver string
	Family    string
	Geo       geoInfo
}

func logRequest(info requestLogInfo) {
	fields := []string{
		currentLogStyle.event("request"),
		"method=" + sanitizeLogValue(info.Method),
		currentLogStyle.status(info.Status),
		"duration=" + info.Duration.Round(time.Millisecond).String(),
		"path=" + sanitizeLogValue(info.Path),
		"ip=" + sanitizeLogValue(info.IP),
		"remote=" + sanitizeLogValue(info.Remote),
		"host=" + sanitizeLogValue(info.Host),
	}
	fields = appendIfSet(fields, "xff", normalizeListHeader(info.XFF))
	fields = appendIfSet(fields, "xreal", info.XRealIP)
	fields = appendIfSet(fields, "forwarded", info.Forwarded)
	fields = appendIfSet(fields, "ua", info.UserAgent)
	fields = appendIfSet(fields, "caregiver", info.Caregiver)
	fields = appendIfSet(fields, "family", info.Family)
	fields = appendIfSet(fields, "geo_country", info.Geo.Country)
	fields = appendIfSet(fields, "geo_region", info.Geo.Region)
	fields = appendIfSet(fields, "geo_city", info.Geo.City)
	log.Print(strings.Join(fields, " "))
}

func logAuthEvent(r *http.Request, event string, session SessionInfo) {
	origin := requestOrigin(r)
	geo := mergeGeoInfo(geoFromHeaders(r), requestGeoIP.Lookup(origin.IP))
	fields := []string{
		currentLogStyle.event("auth"),
		"event=" + sanitizeLogValue(event),
		"ip=" + sanitizeLogValue(origin.IP),
		"remote=" + sanitizeLogValue(origin.Remote),
	}
	fields = appendIfSet(fields, "caregiver", session.CaregiverID)
	fields = appendIfSet(fields, "family", session.FamilyID)
	fields = appendIfSet(fields, "geo_country", geo.Country)
	fields = appendIfSet(fields, "geo_region", geo.Region)
	fields = appendIfSet(fields, "geo_city", geo.City)
	log.Print(strings.Join(fields, " "))
}

type originInfo struct {
	IP        string
	Remote    string
	XFF       string
	XRealIP   string
	Forwarded string
}

func requestOrigin(r *http.Request) originInfo {
	remote := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	xff := r.Header.Get("X-Forwarded-For")
	xreal := r.Header.Get("X-Real-IP")
	forwarded := r.Header.Get("Forwarded")
	ip := firstForwardedIP(xff)
	if ip == "" {
		ip = strings.TrimSpace(xreal)
	}
	if ip == "" {
		ip = remote
	}
	return originInfo{IP: ip, Remote: remote, XFF: xff, XRealIP: xreal, Forwarded: forwarded}
}

func firstForwardedIP(xff string) string {
	for _, part := range strings.Split(xff, ",") {
		if ip := strings.TrimSpace(part); ip != "" {
			return ip
		}
	}
	return ""
}

func mergeGeoInfo(primary, fallback geoInfo) geoInfo {
	if primary.Country == "" {
		primary.Country = fallback.Country
	}
	if primary.Region == "" {
		primary.Region = fallback.Region
	}
	if primary.City == "" {
		primary.City = fallback.City
	}
	return primary
}

func appendIfSet(fields []string, key, value string) []string {
	value = sanitizeLogValueOnce(value)
	if value == "" {
		return fields
	}
	return append(fields, key+"="+value)
}

func normalizeListHeader(value string) string {
	parts := strings.Split(value, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return strings.Join(parts, ",")
}

func sanitizeLogValue(value string) string {
	return sanitizeLogValueOnce(value)
}

func sanitizeLogValueOnce(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		return value
	}
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\t", " ")
	if strings.ContainsAny(value, " \\\"") {
		value = strings.ReplaceAll(value, `\`, `\\`)
		value = strings.ReplaceAll(value, `"`, `\"`)
		return `"` + value + `"`
	}
	return value
}
