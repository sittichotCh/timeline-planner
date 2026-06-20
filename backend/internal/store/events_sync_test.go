package store

import (
	"testing"

	"timeline-planner/internal/model"
)

func syncedEvent(uid, email, start string) model.Event {
	return model.Event{
		MemberEmails: []string{email}, Scope: model.ScopePersonal, Type: model.EventOncall,
		Title: "Oncall", StartDate: start, EndDate: start, CountsAsWorkingDay: true,
		ExternalUID: uid, // Source/SourceID set by ReplaceSyncedEvents
	}
}

func TestReplaceSyncedEventsAddUpdatePrune(t *testing.T) {
	s := newTestStore(t)
	// A manual event that must never be touched.
	if err := s.CreateEvent(model.Event{
		MemberEmails: []string{"m@co.com"}, Scope: model.ScopePersonal, Type: model.EventOther,
		Title: "Manual", StartDate: "2026-06-01", EndDate: "2026-06-01",
	}); err != nil {
		t.Fatalf("seed manual: %v", err)
	}

	// First sync: two events added.
	a, u, r, err := s.ReplaceSyncedEvents("src1", []model.Event{
		syncedEvent("uid-a@g", "a@co.com", "2026-06-10"),
		syncedEvent("uid-b@g", "b@co.com", "2026-06-11"),
	})
	if err != nil {
		t.Fatalf("sync1: %v", err)
	}
	if a != 2 || u != 0 || r != 0 {
		t.Fatalf("sync1 want add=2 upd=0 rem=0, got %d/%d/%d", a, u, r)
	}

	// Second sync: uid-a unchanged, uid-b moved date (update), uid-a dropped? No:
	// keep uid-a as-is, change uid-b, drop nothing, add uid-c.
	a, u, r, err = s.ReplaceSyncedEvents("src1", []model.Event{
		syncedEvent("uid-a@g", "a@co.com", "2026-06-10"), // unchanged
		syncedEvent("uid-b@g", "b@co.com", "2026-06-12"), // date changed -> update
		syncedEvent("uid-c@g", "c@co.com", "2026-06-13"), // new -> add
	})
	if err != nil {
		t.Fatalf("sync2: %v", err)
	}
	if a != 1 || u != 1 || r != 0 {
		t.Fatalf("sync2 want add=1 upd=1 rem=0, got %d/%d/%d", a, u, r)
	}

	// Third sync: only uid-a remains -> uid-b and uid-c pruned.
	a, u, r, err = s.ReplaceSyncedEvents("src1", []model.Event{
		syncedEvent("uid-a@g", "a@co.com", "2026-06-10"),
	})
	if err != nil {
		t.Fatalf("sync3: %v", err)
	}
	if a != 0 || u != 0 || r != 2 {
		t.Fatalf("sync3 want add=0 upd=0 rem=2, got %d/%d/%d", a, u, r)
	}

	all, _ := s.GetEvents()
	// Manual + uid-a = 2 events; verify the manual one survived and IDs are stable.
	if len(all) != 2 {
		t.Fatalf("want 2 events, got %d", len(all))
	}
	var sawManual, sawA bool
	for _, e := range all {
		if e.Title == "Manual" && e.Source == model.SourceManual {
			sawManual = true
		}
		if e.ExternalUID == "uid-a@g" && e.Source == model.SourceGoogle && e.SourceID == "src1" {
			sawA = true
		}
	}
	if !sawManual || !sawA {
		t.Fatalf("expected manual + uid-a to survive, got %+v", all)
	}
}

func TestReplaceSyncedEventsIsolatesSources(t *testing.T) {
	s := newTestStore(t)
	if _, _, _, err := s.ReplaceSyncedEvents("src1", []model.Event{syncedEvent("u1@g", "a@co.com", "2026-06-10")}); err != nil {
		t.Fatalf("src1: %v", err)
	}
	// Syncing src2 must not prune src1's events.
	a, _, r, err := s.ReplaceSyncedEvents("src2", []model.Event{syncedEvent("u2@g", "b@co.com", "2026-06-11")})
	if err != nil {
		t.Fatalf("src2: %v", err)
	}
	if a != 1 || r != 0 {
		t.Fatalf("src2 want add=1 rem=0, got add=%d rem=%d", a, r)
	}
	if all, _ := s.GetEvents(); len(all) != 2 {
		t.Fatalf("want 2 events across sources, got %d", len(all))
	}
}

func TestDeleteSyncedEventsBySource(t *testing.T) {
	s := newTestStore(t)
	_, _, _, _ = s.ReplaceSyncedEvents("src1", []model.Event{
		syncedEvent("u1@g", "a@co.com", "2026-06-10"),
		syncedEvent("u2@g", "b@co.com", "2026-06-11"),
	})
	n, err := s.DeleteSyncedEventsBySource("src1")
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if n != 2 {
		t.Fatalf("want 2 removed, got %d", n)
	}
	if all, _ := s.GetEvents(); len(all) != 0 {
		t.Fatalf("want 0 events, got %d", len(all))
	}
}

func TestReplaceSyncedEventsDedupesDuplicateUID(t *testing.T) {
	s := newTestStore(t)
	// Two incoming events share a UID; only one record should be stored.
	a, _, _, err := s.ReplaceSyncedEvents("src1", []model.Event{
		syncedEvent("dup@g", "a@co.com", "2026-06-10"),
		syncedEvent("dup@g", "a@co.com", "2026-06-11"),
	})
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if a != 1 {
		t.Fatalf("want add=1 for deduped UID, got %d", a)
	}
	all, _ := s.GetEvents()
	if len(all) != 1 {
		t.Fatalf("want 1 stored event after dedup, got %d", len(all))
	}
}

func TestReplaceSyncedEventsEmptyIncomingPrunesAll(t *testing.T) {
	s := newTestStore(t)
	if _, _, _, err := s.ReplaceSyncedEvents("src1", []model.Event{
		syncedEvent("u1@g", "a@co.com", "2026-06-10"),
		syncedEvent("u2@g", "b@co.com", "2026-06-11"),
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, _, removed, err := s.ReplaceSyncedEvents("src1", []model.Event{})
	if err != nil {
		t.Fatalf("prune-all: %v", err)
	}
	if removed != 2 {
		t.Fatalf("want removed=2, got %d", removed)
	}
	if all, _ := s.GetEvents(); len(all) != 0 {
		t.Fatalf("want 0 events after empty sync, got %d", len(all))
	}
}
