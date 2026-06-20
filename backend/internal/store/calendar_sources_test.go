package store

import (
	"testing"

	"timeline-planner/internal/model"
)

func TestCalendarSourceCRUD(t *testing.T) {
	s := newTestStore(t)

	src := model.CalendarSource{ID: "s1", Name: "On-call", URL: "https://x/basic.ics", EventType: model.EventOncall}
	if err := s.CreateCalendarSource(src); err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, err := s.GetCalendarSources()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(got) != 1 || got[0].Name != "On-call" || got[0].EventType != model.EventOncall {
		t.Fatalf("unexpected after create: %+v", got)
	}

	src.Name = "Renamed"
	src.LastSyncedAt = "2026-06-20T10:00:00Z"
	if err := s.UpdateCalendarSource("s1", src); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, _ = s.GetCalendarSources()
	if got[0].Name != "Renamed" || got[0].LastSyncedAt != "2026-06-20T10:00:00Z" {
		t.Fatalf("update not persisted: %+v", got[0])
	}

	if err := s.DeleteCalendarSource("s1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ = s.GetCalendarSources()
	if len(got) != 0 {
		t.Fatalf("want 0 after delete, got %d", len(got))
	}
}
