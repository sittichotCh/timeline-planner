// Package gcal fetches and parses public Google Calendar iCal feeds. Read-only:
// it never writes back to Google (mirrors the jira package's posture).
package gcal

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"strings"
)

// ResolveFeedURL turns a user-supplied calendar reference into its public iCal
// feed URL. It accepts a "?cid=<base64>" share URL, a raw ".ics" URL, or a bare
// calendar id (e.g. "c_xxx@group.calendar.google.com").
func ResolveFeedURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("empty calendar URL")
	}
	if strings.HasSuffix(strings.ToLower(raw), ".ics") {
		return raw, nil
	}
	if cid := extractCID(raw); cid != "" {
		id, err := decodeCID(cid)
		if err != nil {
			return "", err
		}
		return icalURL(id), nil
	}
	// Bare calendar id (an email-like token, no URL path).
	if strings.Contains(raw, "@") && !strings.Contains(raw, "/") {
		return icalURL(raw), nil
	}
	return "", fmt.Errorf("unrecognized calendar URL: %q", raw)
}

// extractCID returns the "cid" query parameter, or "" if absent/unparsable.
func extractCID(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Query().Get("cid")
}

// decodeCID base64-decodes a calendar cid, tolerating missing padding and the
// URL-safe alphabet. The decoded value is the calendar id (must contain '@').
func decodeCID(cid string) (string, error) {
	candidates := []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding,
		base64.URLEncoding, base64.RawURLEncoding,
	}
	for _, enc := range candidates {
		if b, err := enc.DecodeString(cid); err == nil {
			if id := string(b); strings.Contains(id, "@") {
				return id, nil
			}
		}
	}
	return "", fmt.Errorf("could not decode calendar cid")
}

// icalURL builds the public basic.ics feed URL for a calendar id. The '@' is
// percent-encoded to %40 to match Google's canonical feed URL form.
func icalURL(calendarID string) string {
	escaped := strings.ReplaceAll(calendarID, "@", "%40")
	return "https://calendar.google.com/calendar/ical/" + escaped + "/public/basic.ics"
}
