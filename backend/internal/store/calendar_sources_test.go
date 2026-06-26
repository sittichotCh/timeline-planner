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

func TestCalendarSourceWorkingDayRoundTrip(t *testing.T) {
	s := newTestStore(t)
	src := model.CalendarSource{ID: "s1", Name: "On-call", URL: "u", EventType: model.EventOncall, CountsAsWorkingDay: true}
	if err := s.CreateCalendarSource(src); err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, err := s.GetCalendarSources()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(got) != 1 || !got[0].CountsAsWorkingDay {
		t.Fatalf("counts_as_working_day not persisted: %+v", got)
	}
}

func TestParseCalendarSourceRowLegacyDefaultsFalse(t *testing.T) {
	// A pre-migration 5-column row (no counts_as_working_day) must default false
	// and still read last_synced_at from index 4.
	legacy := []string{"s1", "On-call", "u", "oncall", "2026-06-20T10:00:00Z"}
	src := parseCalendarSourceRow(legacy)
	if src.CountsAsWorkingDay {
		t.Errorf("legacy row should default CountsAsWorkingDay to false, got true")
	}
	if src.LastSyncedAt != "2026-06-20T10:00:00Z" {
		t.Errorf("legacy last_synced_at misparsed: %q", src.LastSyncedAt)
	}
	// A 6-column row with "true" parses true.
	full := []string{"s1", "On-call", "u", "oncall", "2026-06-20T10:00:00Z", "true"}
	if !parseCalendarSourceRow(full).CountsAsWorkingDay {
		t.Errorf("6-column row with true should parse CountsAsWorkingDay=true")
	}
}
