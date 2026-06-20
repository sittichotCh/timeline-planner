package gcal

import (
	"strings"
	"time"

	// Embed the timezone database so time.LoadLocation works on Windows and on
	// minimal containers that lack system zoneinfo.
	_ "time/tzdata"
)

// RawEvent is one parsed VEVENT with dates already normalized to inclusive
// YYYY-MM-DD strings in the feed's display timezone.
type RawEvent struct {
	UID       string
	Summary   string
	StartDate string
	EndDate   string
	HasRRULE  bool
}

// ParseICS parses a Google Calendar iCal feed into RawEvents. Recurring events
// (with an RRULE) are returned with HasRRULE=true rather than expanded.
func ParseICS(ics string) ([]RawEvent, error) {
	lines := unfoldLines(ics)
	loc := time.UTC
	if tz := findProp(lines, "X-WR-TIMEZONE"); tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}

	var events []RawEvent
	var cur *RawEvent
	for _, line := range lines {
		switch {
		case line == "BEGIN:VEVENT":
			cur = &RawEvent{}
		case line == "END:VEVENT":
			if cur != nil {
				events = append(events, *cur)
				cur = nil
			}
		case cur == nil:
			// outside an event; ignore
		default:
			name, params, value := parseProp(line)
			switch name {
			case "UID":
				cur.UID = value
			case "SUMMARY":
				cur.Summary = value
			case "RRULE":
				cur.HasRRULE = true
			case "DTSTART":
				cur.StartDate = toDate(value, params, loc, false)
			case "DTEND":
				cur.EndDate = toDate(value, params, loc, true)
			}
		}
	}

	// A missing DTEND means a single-day event.
	for i := range events {
		if events[i].EndDate == "" {
			events[i].EndDate = events[i].StartDate
		}
	}
	return events, nil
}

// unfoldLines splits an iCal body into logical lines: CRLF/LF are line breaks,
// and a line beginning with a space or tab is a continuation of the previous one.
func unfoldLines(ics string) []string {
	rawLines := strings.Split(ics, "\n")
	var out []string
	for _, raw := range rawLines {
		raw = strings.TrimRight(raw, "\r")
		if raw == "" {
			continue
		}
		if (raw[0] == ' ' || raw[0] == '\t') && len(out) > 0 {
			out[len(out)-1] += raw[1:]
			continue
		}
		out = append(out, raw)
	}
	return out
}

// parseProp splits "NAME;PARAM=X:value" into its name, raw params, and value.
func parseProp(line string) (name, params, value string) {
	colon := strings.IndexByte(line, ':')
	if colon < 0 {
		return line, "", ""
	}
	left := line[:colon]
	value = line[colon+1:]
	if semi := strings.IndexByte(left, ';'); semi >= 0 {
		return left[:semi], left[semi+1:], value
	}
	return left, "", value
}

// findProp returns the value of the first top-level line with the given name.
func findProp(lines []string, name string) string {
	for _, line := range lines {
		if n, _, v := parseProp(line); n == name {
			return v
		}
	}
	return ""
}

// toDate converts an iCal DTSTART/DTEND value to an inclusive YYYY-MM-DD string.
// Timed values ("YYYYMMDDThhmmssZ") are converted from UTC to loc. All-day
// values (params contain VALUE=DATE, or value is "YYYYMMDD") use the date
// verbatim; for an all-day DTEND (isEnd), the date is exclusive so one day is
// subtracted.
func toDate(value, params string, loc *time.Location, isEnd bool) string {
	if strings.Contains(params, "VALUE=DATE") || len(value) == 8 {
		t, err := time.ParseInLocation("20060102", value, time.UTC)
		if err != nil {
			return ""
		}
		if isEnd {
			t = t.AddDate(0, 0, -1)
		}
		return t.Format("2006-01-02")
	}
	t, err := time.Parse("20060102T150405Z", value)
	if err != nil {
		// Some feeds emit local-time values without a trailing Z; fall back.
		if t, err = time.Parse("20060102T150405", value); err != nil {
			return ""
		}
	}
	return t.In(loc).Format("2006-01-02")
}
