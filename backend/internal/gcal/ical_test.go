package gcal

import "testing"

// Asia/Bangkok is UTC+7. 17:00Z = 00:00 next day; 05:00Z = 12:00 same day.
const sampleICS = "BEGIN:VCALENDAR\r\n" +
	"PRODID:-//Google Inc//Google Calendar 70.9054//EN\r\n" +
	"VERSION:2.0\r\n" +
	"X-WR-TIMEZONE:Asia/Bangkok\r\n" +
	"BEGIN:VEVENT\r\n" +
	"DTSTART:20260412T050000Z\r\n" +
	"DTEND:20260412T165900Z\r\n" +
	"UID:sameday@google.com\r\n" +
	"SUMMARY: yossawat.s@ext-lmwn.com\r\n" +
	"END:VEVENT\r\n" +
	"BEGIN:VEVENT\r\n" +
	"DTSTART:20260416T170000Z\r\n" +
	"DTEND:20260417T050000Z\r\n" +
	"UID:overnight@google.com\r\n" +
	"SUMMARY:pansa.h@lmwn.com\r\n" +
	"END:VEVENT\r\n" +
	"BEGIN:VEVENT\r\n" +
	"DTSTART;VALUE=DATE:20260101\r\n" +
	"DTEND;VALUE=DATE:20260103\r\n" +
	"UID:allday@google.com\r\n" +
	"SUMMARY:amornthep.s@lmwn.com\r\n" +
	"END:VEVENT\r\n" +
	"BEGIN:VEVENT\r\n" +
	"DTSTART:20260420T050000Z\r\n" +
	"DTEND:20260420T060000Z\r\n" +
	"RRULE:FREQ=WEEKLY\r\n" +
	"UID:recur@google.com\r\n" +
	"SUMMARY:banyar.s@lmwn.com\r\n" +
	"END:VEVENT\r\n" +
	"END:VCALENDAR\r\n"

func byUID(events []RawEvent) map[string]RawEvent {
	m := map[string]RawEvent{}
	for _, e := range events {
		m[e.UID] = e
	}
	return m
}

func TestParseICSDates(t *testing.T) {
	events, err := ParseICS(sampleICS)
	if err != nil {
		t.Fatalf("ParseICS: %v", err)
	}
	if len(events) != 4 {
		t.Fatalf("want 4 events, got %d", len(events))
	}
	m := byUID(events)

	if e := m["sameday@google.com"]; e.StartDate != "2026-04-12" || e.EndDate != "2026-04-12" {
		t.Errorf("sameday: got %s..%s want 2026-04-12..2026-04-12", e.StartDate, e.EndDate)
	}
	// 17:00Z/05:00Z both fall on Apr 17 in Bangkok.
	if e := m["overnight@google.com"]; e.StartDate != "2026-04-17" || e.EndDate != "2026-04-17" {
		t.Errorf("overnight: got %s..%s want 2026-04-17..2026-04-17", e.StartDate, e.EndDate)
	}
	// All-day DTEND is exclusive: 20260103 -> inclusive end 2026-01-02.
	if e := m["allday@google.com"]; e.StartDate != "2026-01-01" || e.EndDate != "2026-01-02" {
		t.Errorf("allday: got %s..%s want 2026-01-01..2026-01-02", e.StartDate, e.EndDate)
	}
	if e := m["recur@google.com"]; !e.HasRRULE {
		t.Errorf("recur: want HasRRULE=true")
	}
	if e := m["sameday@google.com"]; e.Summary != " yossawat.s@ext-lmwn.com" {
		t.Errorf("summary should be preserved verbatim, got %q", e.Summary)
	}
}

func TestUnfoldLines(t *testing.T) {
	// A value folded across two lines (continuation starts with a space).
	got := unfoldLines("SUMMARY:Hello\r\n World\r\nUID:x\r\n")
	if len(got) != 2 || got[0] != "SUMMARY:Hello World" || got[1] != "UID:x" {
		t.Fatalf("unfold failed: %#v", got)
	}
}
