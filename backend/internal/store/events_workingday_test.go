package store

import (
	"os"
	"path/filepath"
	"testing"

	"timeline-planner/internal/model"
)

func TestEventCountsAsWorkingDayRoundTrip(t *testing.T) {
	s := newTestStore(t) // helper defined in import_test.go (same package)
	if err := s.CreateEvent(model.Event{
		MemberEmails: []string{"x@co.com"}, Scope: model.ScopePersonal, Type: model.EventOther,
		Title: "Regression", StartDate: "2026-06-01", EndDate: "2026-06-03",
		CountsAsWorkingDay: true,
	}); err != nil {
		t.Fatalf("CreateEvent A: %v", err)
	}
	if err := s.CreateEvent(model.Event{
		MemberEmails: []string{"y@co.com"}, Scope: model.ScopePersonal, Type: model.EventOther,
		Title: "Normal", StartDate: "2026-06-04", EndDate: "2026-06-05",
		CountsAsWorkingDay: false,
	}); err != nil {
		t.Fatalf("CreateEvent B: %v", err)
	}
	got, err := s.GetEvents()
	if err != nil {
		t.Fatalf("GetEvents: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 events, got %d", len(got))
	}
	byTitle := map[string]model.Event{}
	for _, e := range got {
		byTitle[e.Title] = e
	}
	if !byTitle["Regression"].CountsAsWorkingDay {
		t.Errorf("Regression should round-trip CountsAsWorkingDay=true")
	}
	if byTitle["Normal"].CountsAsWorkingDay {
		t.Errorf("Normal should round-trip CountsAsWorkingDay=false")
	}
}

func TestGetEventsBackCompatMissingColumn(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	// Legacy 7-column events.csv (no counts_as_working_day column).
	legacy := "id,member_emails,scope,type,title,start_date,end_date\n" +
		"abc123,x@co.com,personal,other,Legacy,2026-06-01,2026-06-02\n"
	if err := os.WriteFile(filepath.Join(dir, "events.csv"), []byte(legacy), 0o644); err != nil {
		t.Fatalf("write legacy: %v", err)
	}
	got, err := s.GetEvents()
	if err != nil {
		t.Fatalf("GetEvents: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 event, got %d", len(got))
	}
	if got[0].Title != "Legacy" {
		t.Errorf("legacy row mis-parsed: %+v", got[0])
	}
	if got[0].CountsAsWorkingDay {
		t.Errorf("legacy row should parse CountsAsWorkingDay=false")
	}
}
