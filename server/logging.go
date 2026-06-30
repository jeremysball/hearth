package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

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
		"request",
		"method=" + sanitizeLogValue(info.Method),
		"path=" + sanitizeLogValue(info.Path),
		fmt.Sprintf("status=%d", info.Status),
		"duration=" + info.Duration.Round(time.Millisecond).String(),
		"host=" + sanitizeLogValue(info.Host),
		"ip=" + sanitizeLogValue(info.IP),
		"remote=" + sanitizeLogValue(info.Remote),
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
	fields := []string{
		"auth",
		"event=" + sanitizeLogValue(event),
		"ip=" + sanitizeLogValue(origin.IP),
		"remote=" + sanitizeLogValue(origin.Remote),
	}
	fields = appendIfSet(fields, "caregiver", session.CaregiverID)
	fields = appendIfSet(fields, "family", session.FamilyID)
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
	value = sanitizeLogValue(value)
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
	value = strings.TrimSpace(value)
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
