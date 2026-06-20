package store

import (
	"os"
	"path/filepath"
	"testing"

	"timeline-planner/internal/model"
)

func TestEventSourceRoundTrip(t *testing.T) {
	s := newTestStore(t) // helper in import_test.go (same package)
	if err := s.CreateEvent(model.Event{
		MemberEmails: []string{"x@co.com"}, Scope: model.ScopePersonal, Type: model.EventOther,
		Title: "Synced", StartDate: "2026-06-01", EndDate: "2026-06-01",
		Source: model.SourceGoogle, SourceID: "src1", ExternalUID: "uid-1@google.com",
	}); err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
	got, err := s.GetEvents()
	if err != nil {
		t.Fatalf("GetEvents: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 event, got %d", len(got))
	}
	e := got[0]
	if e.Source != model.SourceGoogle || e.SourceID != "src1" || e.ExternalUID != "uid-1@google.com" {
		t.Errorf("source fields not round-tripped: %+v", e)
	}
}

func TestEventSourceDefaultsToManual(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	// Legacy 8-column events.csv (no source columns).
	legacy := "id,member_emails,scope,type,title,start_date,end_date,counts_as_working_day\n" +
		"abc123,x@co.com,personal,other,Legacy,2026-06-01,2026-06-02,false\n"
	if err := os.WriteFile(filepath.Join(dir, "events.csv"), []byte(legacy), 0o644); err != nil {
		t.Fatalf("write legacy: %v", err)
	}
	got, err := s.GetEvents()
	if err != nil {
		t.Fatalf("GetEvents: %v", err)
	}
	if len(got) != 1 || got[0].Source != model.SourceManual {
		t.Fatalf("legacy row should default Source=manual, got %+v", got)
	}
}
