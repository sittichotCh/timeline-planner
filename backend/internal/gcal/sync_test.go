package gcal

import (
	"testing"

	"timeline-planner/internal/model"
)

func TestExtractEmail(t *testing.T) {
	cases := map[string]string{
		" yossawat.s@ext-lmwn.com":  "yossawat.s@ext-lmwn.com",
		"On-call: pansa.h@lmwn.com": "pansa.h@lmwn.com",
		"New Event":                 "",
		"":                          "",
	}
	for in, want := range cases {
		if got := extractEmail(in); got != want {
			t.Errorf("extractEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildEventsMatchesAndSkips(t *testing.T) {
	src := model.CalendarSource{ID: "src1", Name: "POS On-call", URL: "x", EventType: model.EventOncall}
	known := map[string]bool{"yossawat.s@ext-lmwn.com": true, "pansa.h@lmwn.com": true}
	// amornthep is NOT known -> skipped; "New Event" has no email -> skipped;
	// recur has RRULE -> skipped.
	events, skipped, err := BuildEvents(src, sampleICS, known)
	if err != nil {
		t.Fatalf("BuildEvents: %v", err)
	}
	// sampleICS (Task 5) has: yossawat (known), pansa (known), amornthep (unknown),
	// banyar (RRULE). So 2 built, 2 skipped.
	if len(events) != 2 {
		t.Fatalf("want 2 built events, got %d (%+v)", len(events), events)
	}
	if skipped != 2 {
		t.Fatalf("want 2 skipped, got %d", skipped)
	}
	e := events[0]
	if e.Scope != model.ScopePersonal || e.Source != model.SourceGoogle || e.SourceID != "src1" {
		t.Errorf("unexpected event scaffolding: %+v", e)
	}
	if len(e.MemberEmails) != 1 {
		t.Errorf("want exactly one member email, got %v", e.MemberEmails)
	}
	if e.Type != model.EventOncall || !e.CountsAsWorkingDay {
		t.Errorf("oncall should count as a working day: %+v", e)
	}
	// Title follows the store's canonical rule (oncall -> "Oncall").
	if e.Title != "Oncall" {
		t.Errorf("oncall title should be canonical \"Oncall\", got %q", e.Title)
	}
	if e.ExternalUID == "" {
		t.Errorf("ExternalUID must be set from the iCal UID")
	}
}

func TestBuildEventsOtherTypeUsesSourceName(t *testing.T) {
	src := model.CalendarSource{ID: "s", Name: "WFH Calendar", URL: "x", EventType: model.EventOther}
	known := map[string]bool{"pansa.h@lmwn.com": true, "yossawat.s@ext-lmwn.com": true, "amornthep.s@lmwn.com": true}
	events, _, err := BuildEvents(src, sampleICS, known)
	if err != nil {
		t.Fatalf("BuildEvents: %v", err)
	}
	for _, e := range events {
		if e.Title != "WFH Calendar" {
			t.Errorf("other-type events use the source name as title, got %q", e.Title)
		}
		if e.CountsAsWorkingDay != true {
			t.Errorf("other type should count as a working day")
		}
	}
}
