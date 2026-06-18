package store

import (
	"testing"

	"timeline-planner/internal/model"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

func TestImportEventsAppendsAndAssignsIDs(t *testing.T) {
	s := newTestStore(t)
	cands := []model.Event{
		{Scope: model.ScopePersonal, Type: model.EventOther, Title: "A", StartDate: "2026-06-01", EndDate: "2026-06-02", MemberEmails: []string{"x@co.com"}},
		{Scope: model.ScopeTeam, Type: model.EventHoliday, Title: "Holiday", StartDate: "2026-06-03", EndDate: "2026-06-03", MemberEmails: []string{}},
	}
	added, skipped, err := s.ImportEvents(cands)
	if err != nil {
		t.Fatalf("ImportEvents: %v", err)
	}
	if added != 2 || skipped != 0 {
		t.Fatalf("added=%d skipped=%d; want 2,0", added, skipped)
	}
	got, _ := s.GetEvents()
	if len(got) != 2 {
		t.Fatalf("want 2 stored, got %d", len(got))
	}
	for _, e := range got {
		if e.ID == "" {
			t.Errorf("event missing ID: %+v", e)
		}
	}
}

func TestImportEventsSkipsDuplicateOfExisting(t *testing.T) {
	s := newTestStore(t)
	base := model.Event{Scope: model.ScopePersonal, Type: model.EventOther, Title: "A", StartDate: "2026-06-01", EndDate: "2026-06-02", MemberEmails: []string{"a@co.com", "b@co.com"}}
	if _, _, err := s.ImportEvents([]model.Event{base}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Same content, reversed member order -> still a duplicate.
	dup := base
	dup.MemberEmails = []string{"b@co.com", "a@co.com"}
	added, skipped, err := s.ImportEvents([]model.Event{dup})
	if err != nil {
		t.Fatalf("ImportEvents: %v", err)
	}
	if added != 0 || skipped != 1 {
		t.Fatalf("added=%d skipped=%d; want 0,1", added, skipped)
	}
	got, _ := s.GetEvents()
	if len(got) != 1 {
		t.Fatalf("want 1 stored, got %d", len(got))
	}
}

func TestImportEventsSkipsDuplicateWithinBatch(t *testing.T) {
	s := newTestStore(t)
	e := model.Event{Scope: model.ScopePersonal, Type: model.EventOther, Title: "A", StartDate: "2026-06-01", EndDate: "2026-06-02", MemberEmails: []string{"x@co.com"}}
	added, skipped, err := s.ImportEvents([]model.Event{e, e})
	if err != nil {
		t.Fatalf("ImportEvents: %v", err)
	}
	if added != 1 || skipped != 1 {
		t.Fatalf("added=%d skipped=%d; want 1,1", added, skipped)
	}
}

func TestImportDeadlinesDedupIgnoresColor(t *testing.T) {
	s := newTestStore(t)
	added, skipped, err := s.ImportDeadlines([]model.Deadline{{Title: "Ship", Date: "2026-08-03", Color: "red"}})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	if added != 1 || skipped != 0 {
		t.Fatalf("added=%d skipped=%d; want 1,0", added, skipped)
	}
	// Same title+date, different color -> duplicate.
	added, skipped, err = s.ImportDeadlines([]model.Deadline{{Title: "Ship", Date: "2026-08-03", Color: "blue"}})
	if err != nil {
		t.Fatalf("ImportDeadlines: %v", err)
	}
	if added != 0 || skipped != 1 {
		t.Fatalf("added=%d skipped=%d; want 0,1", added, skipped)
	}
	got, _ := s.GetDeadlines()
	if len(got) != 1 {
		t.Fatalf("want 1 stored, got %d", len(got))
	}
}
