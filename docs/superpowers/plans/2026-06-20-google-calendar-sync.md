# Google Calendar Event Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings page that registers public Google Calendar feeds and syncs their events onto the timeline, matching each event to a member by the email in the event title.

**Architecture:** Backend follows the existing config → handler → store ↔ CSV pattern. A new `gcal` package (pure parsing + a thin resty fetcher, mirroring the read-only `jira` package) resolves a Google Calendar URL to its public iCal feed, parses events, and maps them to members. A new `calendar_sources.csv` stores the registered feeds; synced events live in the existing `events.csv` tagged with `source=google` + `source_id` + `external_uid` so re-syncs can upsert and prune them idempotently. Frontend adds a `SettingsPage` (a `PageView` like `JiraSyncPage`) plus an auto-on-load sync in `App.tsx`.

**Tech Stack:** Go 1.x + Gin + resty (backend), React 19 + TypeScript + Vite + Tailwind v4 (frontend). CSV file persistence. No new backend dependency (custom minimal iCal parser).

## Global Constraints

- **Jira-style read-only external access** — never write back to Google; fetch via public iCal only, no OAuth.
- **Strict TypeScript** — no `any` types in frontend code.
- **CSV persistence** — all new state is CSV under `DATA_DIR`, via the existing `readCSV`/`writeCSV` + `genID()` helpers under the store's single `sync.RWMutex`.
- **Members are keyed by email.** Synced events reference members via `member_emails`. Unknown emails are skipped (NOT auto-created).
- **Lazy CSV migration** — new columns are optional on read (old rows parse with defaults) and written on the next save. Never rewrite/migrate eagerly.
- **Branch:** `feat/google-calendar-sync` (already checked out).
- Backend tests run with `go test ./...` from `backend/`. Frontend has no unit-test runner — verify with `npm run build` (tsc) + `npm run lint` + Playwright MCP.

---

## File Structure

**Backend (create)**
- `backend/internal/model/calendar_source.go` — `CalendarSource` struct + `Source*` event constants.
- `backend/internal/store/calendar_sources.go` — `calendar_sources.csv` CRUD.
- `backend/internal/gcal/url.go` — `ResolveFeedURL`, `cid` decode.
- `backend/internal/gcal/ical.go` — minimal iCal parser (`ParseICS`).
- `backend/internal/gcal/sync.go` — `BuildEvents`, email extraction, working-day rule.
- `backend/internal/gcal/client.go` — resty `Client.FetchFeed`.
- `backend/internal/handler/calendar_sources.go` — CRUD + `SyncAll` handler.
- Test files alongside each.

**Backend (modify)**
- `backend/internal/model/event.go` — add `Source`, `SourceID`, `ExternalUID`.
- `backend/internal/store/events.go` — header/parse/serialize + `ReplaceSyncedEvents`, `DeleteSyncedEventsBySource`.
- `backend/cmd/server/main.go` — register `/api/calendar-sources` routes.

**Frontend (create)**
- `frontend/src/api/calendarSources.ts` — CRUD + sync wrappers.
- `frontend/src/components/SettingsPage.tsx` — the Settings page.

**Frontend (modify)**
- `frontend/src/types/index.ts` — `CalendarSource`, `CalendarSyncResult`; extend `CalendarEvent`.
- `frontend/src/App.tsx` — nav item, `PageView`, render, auto-on-load sync.

---

## Task 1: Extend Event model + CSV with source fields

**Files:**
- Modify: `backend/internal/model/event.go`
- Modify: `backend/internal/store/events.go:15` (header), `:43-61` (parse/serialize)
- Test: `backend/internal/store/events_source_test.go` (create)

**Interfaces:**
- Produces: `model.Event` gains `Source string` (`json:"source"`), `SourceID string` (`json:"source_id"`), `ExternalUID string` (`json:"external_uid"`); constants `model.SourceManual = "manual"`, `model.SourceGoogle = "google"`. `events.csv` header becomes `id,member_emails,scope,type,title,start_date,end_date,counts_as_working_day,source,source_id,external_uid`. A row with empty/missing `source` parses as `"manual"`.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/store/events_source_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/store -run TestEventSource`
Expected: FAIL — compile error (`e.Source` undefined) / `model.SourceGoogle` undefined.

- [ ] **Step 3: Add the model fields and constants**

In `backend/internal/model/event.go`, add the constants after the `EventScope` consts block (after line 17):

```go
// Event source markers. Synced events are owned by their sync source and may be
// overwritten on the next sync; manual events are user-created and never touched.
const (
	SourceManual = "manual"
	SourceGoogle = "google"
)
```

Replace the `Event` struct (lines 19-28) with:

```go
type Event struct {
	ID                 string     `json:"id"`
	MemberEmails       []string   `json:"member_emails"`
	Scope              EventScope `json:"scope"`
	Type               EventType  `json:"type"`
	Title              string     `json:"title"`
	StartDate          string     `json:"start_date"`
	EndDate            string     `json:"end_date"`
	CountsAsWorkingDay bool       `json:"counts_as_working_day"`
	// Source is "manual" (user-created, default) or "google" (calendar sync).
	Source string `json:"source"`
	// SourceID is the CalendarSource.id that produced a synced event ("" for manual).
	SourceID string `json:"source_id"`
	// ExternalUID is the upstream iCal UID for a synced event ("" for manual).
	ExternalUID string `json:"external_uid"`
}
```

- [ ] **Step 4: Update the CSV header and (de)serialization**

In `backend/internal/store/events.go`, replace `eventsHeader` (line 15):

```go
var eventsHeader = []string{"id", "member_emails", "scope", "type", "title", "start_date", "end_date", "counts_as_working_day", "source", "source_id", "external_uid"}
```

Replace `parseEventRow` (lines 43-57):

```go
func parseEventRow(row []string) model.Event {
	e := model.Event{
		ID:           row[0],
		MemberEmails: parseEmails(row[1]),
		Scope:        model.EventScope(row[2]),
		Type:         model.EventType(row[3]),
		Title:        row[4],
		StartDate:    row[5],
		EndDate:      row[6],
	}
	if len(row) >= 8 {
		e.CountsAsWorkingDay = strings.EqualFold(strings.TrimSpace(row[7]), "true")
	}
	if len(row) >= 9 {
		e.Source = strings.TrimSpace(row[8])
	}
	if len(row) >= 10 {
		e.SourceID = strings.TrimSpace(row[9])
	}
	if len(row) >= 11 {
		e.ExternalUID = strings.TrimSpace(row[10])
	}
	if e.Source == "" {
		e.Source = model.SourceManual
	}
	return e
}
```

Replace `eventToRow` (lines 59-61):

```go
func eventToRow(e model.Event) []string {
	source := e.Source
	if source == "" {
		source = model.SourceManual
	}
	return []string{e.ID, joinEmails(e.MemberEmails), string(e.Scope), string(e.Type), e.Title, e.StartDate, e.EndDate, strconv.FormatBool(e.CountsAsWorkingDay), source, e.SourceID, e.ExternalUID}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && go test ./internal/store -run TestEvent`
Expected: PASS (new source tests + existing `TestEventCountsAsWorkingDayRoundTrip` / `TestGetEventsBackCompatMissingColumn` still pass).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/model/event.go backend/internal/store/events.go backend/internal/store/events_source_test.go
git commit -m "feat(events): add source/source_id/external_uid for synced events"
```

---

## Task 2: CalendarSource model + store CRUD

**Files:**
- Create: `backend/internal/model/calendar_source.go`
- Create: `backend/internal/store/calendar_sources.go`
- Test: `backend/internal/store/calendar_sources_test.go`

**Interfaces:**
- Produces: `model.CalendarSource{ID, Name, URL string; EventType EventType; LastSyncedAt string}` with json tags `id,name,url,event_type,last_synced_at`. Store methods: `GetCalendarSources() ([]model.CalendarSource, error)`, `CreateCalendarSource(model.CalendarSource) error`, `UpdateCalendarSource(id string, model.CalendarSource) error`, `DeleteCalendarSource(id string) error`. CSV file `calendar_sources.csv`.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/store/calendar_sources_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/store -run TestCalendarSourceCRUD`
Expected: FAIL — `model.CalendarSource` / `s.CreateCalendarSource` undefined.

- [ ] **Step 3: Create the model**

Create `backend/internal/model/calendar_source.go`:

```go
package model

// CalendarSource is a registered public Google Calendar feed. Sync fetches its
// iCal feed and writes matching events tagged with Source=google + SourceID=ID.
type CalendarSource struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	URL          string    `json:"url"`
	EventType    EventType `json:"event_type"`
	LastSyncedAt string    `json:"last_synced_at"`
}
```

- [ ] **Step 4: Create the store (mirrors `deadlines.go`)**

Create `backend/internal/store/calendar_sources.go`:

```go
package store

import (
	"fmt"

	"timeline-planner/internal/model"
)

const calendarSourcesFile = "calendar_sources.csv"

var calendarSourcesHeader = []string{"id", "name", "url", "event_type", "last_synced_at"}

func parseCalendarSourceRow(row []string) model.CalendarSource {
	src := model.CalendarSource{
		ID:        row[0],
		Name:      row[1],
		URL:       row[2],
		EventType: model.EventType(row[3]),
	}
	if len(row) >= 5 {
		src.LastSyncedAt = row[4]
	}
	return src
}

func calendarSourceToRow(src model.CalendarSource) []string {
	return []string{src.ID, src.Name, src.URL, string(src.EventType), src.LastSyncedAt}
}

func (s *Store) GetCalendarSources() ([]model.CalendarSource, error) {
	rows, err := s.readCSV(calendarSourcesFile)
	if err != nil {
		return nil, err
	}
	var sources []model.CalendarSource
	for i, row := range rows {
		if i == 0 || len(row) < 4 {
			continue
		}
		sources = append(sources, parseCalendarSourceRow(row))
	}
	if sources == nil {
		return []model.CalendarSource{}, nil
	}
	return sources, nil
}

func (s *Store) CreateCalendarSource(src model.CalendarSource) error {
	sources, err := s.GetCalendarSources()
	if err != nil {
		return err
	}
	sources = append(sources, src)
	return s.writeCalendarSources(sources)
}

func (s *Store) UpdateCalendarSource(id string, src model.CalendarSource) error {
	sources, err := s.GetCalendarSources()
	if err != nil {
		return err
	}
	for i, existing := range sources {
		if existing.ID == id {
			src.ID = id
			sources[i] = src
			return s.writeCalendarSources(sources)
		}
	}
	return fmt.Errorf("calendar source %s not found", id)
}

func (s *Store) DeleteCalendarSource(id string) error {
	sources, err := s.GetCalendarSources()
	if err != nil {
		return err
	}
	filtered := make([]model.CalendarSource, 0, len(sources))
	for _, src := range sources {
		if src.ID != id {
			filtered = append(filtered, src)
		}
	}
	if len(filtered) == len(sources) {
		return fmt.Errorf("calendar source %s not found", id)
	}
	return s.writeCalendarSources(filtered)
}

func (s *Store) writeCalendarSources(sources []model.CalendarSource) error {
	rows := make([][]string, len(sources))
	for i, src := range sources {
		rows[i] = calendarSourceToRow(src)
	}
	return s.writeCSV(calendarSourcesFile, calendarSourcesHeader, rows)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./internal/store -run TestCalendarSourceCRUD`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/model/calendar_source.go backend/internal/store/calendar_sources.go backend/internal/store/calendar_sources_test.go
git commit -m "feat(store): add CalendarSource CRUD (calendar_sources.csv)"
```

---

## Task 3: Upsert/prune synced events in the store

**Files:**
- Modify: `backend/internal/store/events.go` (add two methods + a comparison helper at end of file)
- Test: `backend/internal/store/events_sync_test.go`

**Interfaces:**
- Consumes: `model.Event` source fields (Task 1), `genID()` (events.go:17).
- Produces:
  - `func (s *Store) ReplaceSyncedEvents(sourceID string, incoming []model.Event) (added, updated, removed int, err error)` — replaces all `source=google` events for `sourceID`. Each `incoming` event is matched to an existing one by `ExternalUID`: re-seen & unchanged → no count; re-seen & changed → `updated`; new → `added` (new `ID` assigned); existing-not-in-incoming → `removed`. Manual events and other sources are never touched. The method sets `Source=google` and `SourceID=sourceID` on every incoming event before persisting.
  - `func (s *Store) DeleteSyncedEventsBySource(sourceID string) (int, error)` — removes all `source=google` events with that `sourceID`; returns the count removed.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/store/events_sync_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/store -run "TestReplaceSyncedEvents|TestDeleteSyncedEventsBySource"`
Expected: FAIL — `ReplaceSyncedEvents` / `DeleteSyncedEventsBySource` undefined.

- [ ] **Step 3: Implement the methods**

Append to `backend/internal/store/events.go` (end of file):

```go
// sameSyncedEvent reports whether two events have identical user-visible content
// (everything except identity/source bookkeeping). Used to avoid counting an
// unchanged re-synced event as "updated".
func sameSyncedEvent(a, b model.Event) bool {
	return joinEmails(a.MemberEmails) == joinEmails(b.MemberEmails) &&
		a.Scope == b.Scope &&
		a.Type == b.Type &&
		a.Title == b.Title &&
		a.StartDate == b.StartDate &&
		a.EndDate == b.EndDate &&
		a.CountsAsWorkingDay == b.CountsAsWorkingDay
}

// ReplaceSyncedEvents upserts the events for one calendar source, matched by
// ExternalUID, and prunes that source's events no longer present. Manual events
// and events from other sources are left untouched.
func (s *Store) ReplaceSyncedEvents(sourceID string, incoming []model.Event) (added, updated, removed int, err error) {
	events, err := s.GetEvents()
	if err != nil {
		return 0, 0, 0, err
	}

	existing := make(map[string]model.Event)
	result := make([]model.Event, 0, len(events))
	for _, e := range events {
		if e.Source == model.SourceGoogle && e.SourceID == sourceID {
			existing[e.ExternalUID] = e
		} else {
			result = append(result, e) // untouched
		}
	}

	seen := make(map[string]struct{}, len(incoming))
	for _, ne := range incoming {
		ne.Source = model.SourceGoogle
		ne.SourceID = sourceID
		seen[ne.ExternalUID] = struct{}{}
		if old, ok := existing[ne.ExternalUID]; ok {
			ne.ID = old.ID // keep a stable id across syncs
			if !sameSyncedEvent(old, ne) {
				updated++
			}
		} else {
			ne.ID = genID()
			added++
		}
		result = append(result, ne)
	}
	for uid := range existing {
		if _, ok := seen[uid]; !ok {
			removed++
		}
	}

	if err := s.writeEvents(result); err != nil {
		return 0, 0, 0, err
	}
	return added, updated, removed, nil
}

// DeleteSyncedEventsBySource removes every google-sourced event for sourceID.
func (s *Store) DeleteSyncedEventsBySource(sourceID string) (int, error) {
	events, err := s.GetEvents()
	if err != nil {
		return 0, err
	}
	kept := make([]model.Event, 0, len(events))
	removed := 0
	for _, e := range events {
		if e.Source == model.SourceGoogle && e.SourceID == sourceID {
			removed++
			continue
		}
		kept = append(kept, e)
	}
	if removed > 0 {
		if err := s.writeEvents(kept); err != nil {
			return 0, err
		}
	}
	return removed, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/store -run "TestReplaceSyncedEvents|TestDeleteSyncedEventsBySource"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/events.go backend/internal/store/events_sync_test.go
git commit -m "feat(store): ReplaceSyncedEvents upsert/prune + DeleteSyncedEventsBySource"
```

---

## Task 4: Resolve a Google Calendar URL to its iCal feed

**Files:**
- Create: `backend/internal/gcal/url.go`
- Test: `backend/internal/gcal/url_test.go`

**Interfaces:**
- Produces: `func ResolveFeedURL(raw string) (string, error)` — accepts a `?cid=<base64>` share URL, a raw `.ics` URL, or a bare calendar ID; returns the public iCal feed URL `https://calendar.google.com/calendar/ical/<id-with-%40>/public/basic.ics`. Package is `gcal`.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/gcal/url_test.go`:

```go
package gcal

import "testing"

const exampleShareURL = "https://calendar.google.com/calendar/u/0?cid=Y19iY2FhZWU1OGY1OTQ5NjZiNjUxNDhkZjg5OWU3MGYyOTE5MDhiOTc5YzY5NDFiNmI4ZmFmNDI1ZmYxYTE2Njg3QGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20"

const exampleFeedURL = "https://calendar.google.com/calendar/ical/c_bcaaee58f594966b65148df899e70f291908b979c6941b6b8faf425ff1a16687%40group.calendar.google.com/public/basic.ics"

func TestResolveFeedURLFromCID(t *testing.T) {
	got, err := ResolveFeedURL(exampleShareURL)
	if err != nil {
		t.Fatalf("ResolveFeedURL: %v", err)
	}
	if got != exampleFeedURL {
		t.Errorf("got  %s\nwant %s", got, exampleFeedURL)
	}
}

func TestResolveFeedURLPassthroughICS(t *testing.T) {
	raw := "https://example.com/whatever/basic.ics"
	got, err := ResolveFeedURL(raw)
	if err != nil {
		t.Fatalf("ResolveFeedURL: %v", err)
	}
	if got != raw {
		t.Errorf("want passthrough, got %s", got)
	}
}

func TestResolveFeedURLBareID(t *testing.T) {
	got, err := ResolveFeedURL("c_abc123@group.calendar.google.com")
	if err != nil {
		t.Fatalf("ResolveFeedURL: %v", err)
	}
	want := "https://calendar.google.com/calendar/ical/c_abc123%40group.calendar.google.com/public/basic.ics"
	if got != want {
		t.Errorf("got %s want %s", got, want)
	}
}

func TestResolveFeedURLEmpty(t *testing.T) {
	if _, err := ResolveFeedURL("   "); err == nil {
		t.Errorf("want error for empty URL")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/gcal -run TestResolveFeedURL`
Expected: FAIL — no package `gcal` / `ResolveFeedURL` undefined.

- [ ] **Step 3: Implement `ResolveFeedURL`**

Create `backend/internal/gcal/url.go`:

```go
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/gcal -run TestResolveFeedURL`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/gcal/url.go backend/internal/gcal/url_test.go
git commit -m "feat(gcal): resolve cid/share URL to public iCal feed URL"
```

---

## Task 5: Minimal iCal parser

**Files:**
- Create: `backend/internal/gcal/ical.go`
- Test: `backend/internal/gcal/ical_test.go`

**Interfaces:**
- Produces:
  - `type RawEvent struct { UID, Summary, StartDate, EndDate string; HasRRULE bool }` — `StartDate`/`EndDate` are inclusive `YYYY-MM-DD`, already converted to the feed's display timezone.
  - `func ParseICS(ics string) ([]RawEvent, error)` — parses every `VEVENT`. Timed (`…Z`) `DTSTART`/`DTEND` are converted from UTC to the feed's `X-WR-TIMEZONE` (fallback UTC) before taking the date. All-day (`VALUE=DATE`) uses the date verbatim with `DTEND` treated as exclusive (`EndDate = DTEND − 1 day`). Events with an `RRULE` are returned with `HasRRULE=true` (the caller decides to skip).

- [ ] **Step 1: Write the failing test**

Create `backend/internal/gcal/ical_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/gcal -run "TestParseICS|TestUnfold"`
Expected: FAIL — `ParseICS` / `unfoldLines` / `RawEvent` undefined.

- [ ] **Step 3: Implement the parser**

Create `backend/internal/gcal/ical.go`:

```go
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
	UID      string
	Summary  string
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/gcal -run "TestParseICS|TestUnfold"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/gcal/ical.go backend/internal/gcal/ical_test.go
git commit -m "feat(gcal): minimal iCal parser (tz-aware dates, all-day exclusive end, RRULE flag)"
```

---

## Task 6: Map parsed events to members (BuildEvents)

**Files:**
- Create: `backend/internal/gcal/sync.go`
- Test: `backend/internal/gcal/sync_test.go`

**Interfaces:**
- Consumes: `ParseICS` + `RawEvent` (Task 5), `model.CalendarSource` (Task 2), `model.Event` source fields (Task 1), `model.CanonicalTitle` (event.go:47).
- Produces: `func BuildEvents(src model.CalendarSource, ics string, knownEmails map[string]bool) ([]model.Event, int, error)` — parses `ics`, and for each non-RRULE event extracts an email from the `SUMMARY`; if it matches a known member, emits a `model.Event` (`Scope=personal`, `Type=src.EventType`, title per the store's canonical rule, `Source=google`, `SourceID=src.ID`, `ExternalUID=UID`, `CountsAsWorkingDay` derived from type). Returns the events and the count of skipped events (no email, unknown member, or RRULE).

- [ ] **Step 1: Write the failing test**

Create `backend/internal/gcal/sync_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/gcal -run "TestExtractEmail|TestBuildEvents"`
Expected: FAIL — `extractEmail` / `BuildEvents` undefined.

- [ ] **Step 3: Implement BuildEvents**

Create `backend/internal/gcal/sync.go`:

```go
package gcal

import (
	"regexp"

	"timeline-planner/internal/model"
)

var emailRe = regexp.MustCompile(`[\w.+-]+@[\w.-]+\.\w+`)

// extractEmail returns the first email found in s, or "" if none.
func extractEmail(s string) string {
	return emailRe.FindString(s)
}

// countsAsWorkingDay derives the working-day flag from an event type: leave and
// holiday do not count; oncall and anything else do.
func countsAsWorkingDay(t model.EventType) bool {
	return t != model.EventLeave && t != model.EventHoliday
}

// titleFor returns the title a synced event should carry. It mirrors the store's
// canonical-title normalization (GetEvents forces "Leave"/"Oncall"/"Holiday" for
// those types), so the title stays stable across syncs; "other" keeps the
// source name.
func titleFor(src model.CalendarSource) string {
	if canonical, ok := model.CanonicalTitle(src.EventType); ok {
		return canonical
	}
	return src.Name
}

// BuildEvents parses an iCal feed and maps each event to a member by the email
// in its SUMMARY. Events with no email, an unknown member, or an RRULE are
// skipped (and counted).
func BuildEvents(src model.CalendarSource, ics string, knownEmails map[string]bool) ([]model.Event, int, error) {
	raws, err := ParseICS(ics)
	if err != nil {
		return nil, 0, err
	}
	title := titleFor(src)
	cwd := countsAsWorkingDay(src.EventType)

	var out []model.Event
	skipped := 0
	for _, r := range raws {
		if r.HasRRULE {
			skipped++
			continue
		}
		email := extractEmail(r.Summary)
		if email == "" || !knownEmails[email] {
			skipped++
			continue
		}
		out = append(out, model.Event{
			MemberEmails:       []string{email},
			Scope:              model.ScopePersonal,
			Type:               src.EventType,
			Title:              title,
			StartDate:          r.StartDate,
			EndDate:            r.EndDate,
			CountsAsWorkingDay: cwd,
			Source:             model.SourceGoogle,
			SourceID:           src.ID,
			ExternalUID:        r.UID,
		})
	}
	return out, skipped, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/gcal`
Expected: PASS (all gcal tests, including Tasks 4 & 5).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/gcal/sync.go backend/internal/gcal/sync_test.go
git commit -m "feat(gcal): BuildEvents maps calendar events to members by email"
```

---

## Task 7: iCal HTTP fetcher

**Files:**
- Create: `backend/internal/gcal/client.go`
- Test: `backend/internal/gcal/client_test.go`

**Interfaces:**
- Produces: `type Client struct { ... }`, `func NewClient() *Client`, `func (c *Client) FetchFeed(url string) (string, error)` — GETs the feed and returns its body, or an error for an empty URL / non-2xx response. Uses resty, mirroring the jira client.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/gcal/client_test.go`:

```go
package gcal

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchFeedEmptyURL(t *testing.T) {
	if _, err := NewClient().FetchFeed(""); err == nil {
		t.Errorf("want error for empty URL")
	}
}

func TestFetchFeedSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/calendar")
		_, _ = w.Write([]byte("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"))
	}))
	defer srv.Close()

	body, err := NewClient().FetchFeed(srv.URL)
	if err != nil {
		t.Fatalf("FetchFeed: %v", err)
	}
	if body == "" {
		t.Errorf("want non-empty body")
	}
}

func TestFetchFeedHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if _, err := NewClient().FetchFeed(srv.URL); err == nil {
		t.Errorf("want error for 404 response")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/gcal -run TestFetchFeed`
Expected: FAIL — `NewClient` / `FetchFeed` undefined.

- [ ] **Step 3: Implement the client**

Create `backend/internal/gcal/client.go`:

```go
package gcal

import (
	"fmt"

	"github.com/go-resty/resty/v2"
)

// Client fetches public iCal feeds. Read-only: it issues GETs only.
type Client struct {
	http *resty.Client
}

func NewClient() *Client {
	return &Client{http: resty.New().SetHeader("Accept", "text/calendar")}
}

// FetchFeed returns the raw iCal body at url.
func (c *Client) FetchFeed(url string) (string, error) {
	if url == "" {
		return "", fmt.Errorf("empty calendar feed URL")
	}
	resp, err := c.http.R().Get(url)
	if err != nil {
		return "", err
	}
	if resp.IsError() {
		return "", fmt.Errorf("calendar feed returned %d", resp.StatusCode())
	}
	return resp.String(), nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/gcal`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/gcal/client.go backend/internal/gcal/client_test.go
git commit -m "feat(gcal): resty-based public iCal feed fetcher"
```

---

## Task 8: Calendar-sources handler + routes

**Files:**
- Create: `backend/internal/handler/calendar_sources.go`
- Modify: `backend/cmd/server/main.go:81-86` (add route group after the jira group)
- Test: `backend/internal/handler/calendar_sources_test.go`

**Interfaces:**
- Consumes: store methods (Tasks 2 & 3), `gcal.ResolveFeedURL`, `gcal.BuildEvents` (Tasks 4 & 6), `gcal.NewClient().FetchFeed` (Task 7), `model.GetMembers` (members.go:86), `generateID()` (events.go handler:14).
- Produces:
  - `type CalendarSources struct { store *store.Store; fetch func(url string) (string, error) }` with `func NewCalendarSources(s *store.Store) *CalendarSources` (defaults `fetch` to a `gcal.Client`).
  - Handlers `List`, `Create`, `Update`, `Delete`, `SyncAll`.
  - JSON response types `SyncSourceResult{source_id,name,added,updated,removed,skipped,error}` and `SyncResult{sources,added,updated,removed,skipped}`.
  - Routes: `GET/POST /api/calendar-sources`, `POST /api/calendar-sources/sync`, `PUT/DELETE /api/calendar-sources/:id`.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/handler/calendar_sources_test.go`:

```go
package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

// fakeFeed is a tiny on-call feed: one known member, one unknown.
const fakeFeed = "BEGIN:VCALENDAR\r\n" +
	"X-WR-TIMEZONE:Asia/Bangkok\r\n" +
	"BEGIN:VEVENT\r\nDTSTART:20260412T050000Z\r\nDTEND:20260412T060000Z\r\nUID:u1@g\r\nSUMMARY:known@co.com\r\nEND:VEVENT\r\n" +
	"BEGIN:VEVENT\r\nDTSTART:20260413T050000Z\r\nDTEND:20260413T060000Z\r\nUID:u2@g\r\nSUMMARY:stranger@co.com\r\nEND:VEVENT\r\n" +
	"END:VCALENDAR\r\n"

func newCalendarRouter(t *testing.T) (*gin.Engine, *store.Store, *CalendarSources) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s, err := store.New(t.TempDir())
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	h := &CalendarSources{store: s, fetch: func(string) (string, error) { return fakeFeed, nil }}
	r := gin.New()
	g := r.Group("/api/calendar-sources")
	g.GET("", h.List)
	g.POST("", h.Create)
	g.POST("/sync", h.SyncAll)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	return r, s, h
}

func do(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestCalendarSourceCreateAndList(t *testing.T) {
	r, _, _ := newCalendarRouter(t)
	rec := do(t, r, http.MethodPost, "/api/calendar-sources", `{"name":"On-call","url":"https://x/basic.ics","event_type":"oncall"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d (%s)", rec.Code, rec.Body.String())
	}
	var created model.CalendarSource
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.ID == "" {
		t.Fatalf("server should assign an id")
	}
	rec = do(t, r, http.MethodGet, "/api/calendar-sources", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "On-call") {
		t.Fatalf("list failed: %d %s", rec.Code, rec.Body.String())
	}
}

func TestCalendarSyncAll(t *testing.T) {
	r, s, _ := newCalendarRouter(t)
	// A known member so one event matches; the other (stranger@co.com) is skipped.
	if _, err := s.CreateMember(model.Member{Email: "known@co.com", Name: "Known"}); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	// Register a source.
	if err := s.CreateCalendarSource(model.CalendarSource{ID: "src1", Name: "On-call", URL: "https://x/basic.ics", EventType: model.EventOncall}); err != nil {
		t.Fatalf("seed source: %v", err)
	}

	rec := do(t, r, http.MethodPost, "/api/calendar-sources/sync", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("sync status = %d (%s)", rec.Code, rec.Body.String())
	}
	var result SyncResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Added != 1 || result.Skipped != 1 {
		t.Fatalf("want added=1 skipped=1, got %+v", result)
	}
	// The matched event should now exist for the member.
	events, _ := s.GetEventsByMember("known@co.com")
	if len(events) != 1 || events[0].Source != model.SourceGoogle {
		t.Fatalf("want 1 synced event for member, got %+v", events)
	}

	// last_synced_at should be stamped.
	sources, _ := s.GetCalendarSources()
	if sources[0].LastSyncedAt == "" {
		t.Errorf("last_synced_at should be set after sync")
	}
}

func TestCalendarSourceDeletePrunesEvents(t *testing.T) {
	r, s, _ := newCalendarRouter(t)
	_, _, _, _ = s.ReplaceSyncedEvents("src1", []model.Event{{
		MemberEmails: []string{"known@co.com"}, Scope: model.ScopePersonal, Type: model.EventOncall,
		Title: "Oncall", StartDate: "2026-06-10", EndDate: "2026-06-10", ExternalUID: "u1@g",
	}})
	if err := s.CreateCalendarSource(model.CalendarSource{ID: "src1", Name: "On-call", URL: "x", EventType: model.EventOncall}); err != nil {
		t.Fatalf("seed source: %v", err)
	}
	rec := do(t, r, http.MethodDelete, "/api/calendar-sources/src1", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d", rec.Code)
	}
	if events, _ := s.GetEvents(); len(events) != 0 {
		t.Fatalf("deleting a source should prune its events, got %+v", events)
	}
}
```

> Note: `s.CreateMember(model.Member) (model.Member, error)` is the members store method (returns the created member + error — hence the `_, err :=` form).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/handler -run TestCalendar`
Expected: FAIL — `CalendarSources` / `SyncResult` undefined.

- [ ] **Step 3: Implement the handler**

Create `backend/internal/handler/calendar_sources.go`:

```go
package handler

import (
	"net/http"
	"time"

	"timeline-planner/internal/gcal"
	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type CalendarSources struct {
	store *store.Store
	fetch func(url string) (string, error)
}

func NewCalendarSources(s *store.Store) *CalendarSources {
	client := gcal.NewClient()
	return &CalendarSources{store: s, fetch: client.FetchFeed}
}

// SyncSourceResult is the per-source outcome of a sync.
type SyncSourceResult struct {
	SourceID string `json:"source_id"`
	Name     string `json:"name"`
	Added    int    `json:"added"`
	Updated  int    `json:"updated"`
	Removed  int    `json:"removed"`
	Skipped  int    `json:"skipped"`
	Error    string `json:"error,omitempty"`
}

// SyncResult is the aggregate outcome returned by SyncAll.
type SyncResult struct {
	Sources []SyncSourceResult `json:"sources"`
	Added   int                `json:"added"`
	Updated int                `json:"updated"`
	Removed int                `json:"removed"`
	Skipped int                `json:"skipped"`
}

func (h *CalendarSources) List(c *gin.Context) {
	sources, err := h.store.GetCalendarSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sources)
}

func (h *CalendarSources) Create(c *gin.Context) {
	var src model.CalendarSource
	if err := c.ShouldBindJSON(&src); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if src.ID == "" {
		src.ID = generateID()
	}
	if err := h.store.CreateCalendarSource(src); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, src)
}

func (h *CalendarSources) Update(c *gin.Context) {
	id := c.Param("id")
	var src model.CalendarSource
	if err := c.ShouldBindJSON(&src); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateCalendarSource(id, src); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, src)
}

func (h *CalendarSources) Delete(c *gin.Context) {
	id := c.Param("id")
	if _, err := h.store.DeleteSyncedEventsBySource(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.DeleteCalendarSource(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *CalendarSources) SyncAll(c *gin.Context) {
	sources, err := h.store.GetCalendarSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	members, err := h.store.GetMembers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	known := make(map[string]bool, len(members))
	for _, m := range members {
		known[m.Email] = true
	}

	result := SyncResult{Sources: []SyncSourceResult{}}
	for _, src := range sources {
		sr := SyncSourceResult{SourceID: src.ID, Name: src.Name}

		feedURL, err := gcal.ResolveFeedURL(src.URL)
		if err != nil {
			sr.Error = err.Error()
			result.Sources = append(result.Sources, sr)
			continue
		}
		ics, err := h.fetch(feedURL)
		if err != nil {
			sr.Error = err.Error()
			result.Sources = append(result.Sources, sr)
			continue
		}
		events, skipped, err := gcal.BuildEvents(src, ics, known)
		if err != nil {
			sr.Error = err.Error()
			result.Sources = append(result.Sources, sr)
			continue
		}
		added, updated, removed, err := h.store.ReplaceSyncedEvents(src.ID, events)
		if err != nil {
			sr.Error = err.Error()
			result.Sources = append(result.Sources, sr)
			continue
		}

		src.LastSyncedAt = time.Now().UTC().Format(time.RFC3339)
		_ = h.store.UpdateCalendarSource(src.ID, src)

		sr.Added, sr.Updated, sr.Removed, sr.Skipped = added, updated, removed, skipped
		result.Added += added
		result.Updated += updated
		result.Removed += removed
		result.Skipped += skipped
		result.Sources = append(result.Sources, sr)
	}
	c.JSON(http.StatusOK, result)
}
```

- [ ] **Step 4: Wire the routes**

In `backend/cmd/server/main.go`, after the `jira` group's closing brace (line 86, before the outer `}` on line 87), add:

```go
			calendars := api.Group("/calendar-sources")
			{
				h := handler.NewCalendarSources(yamlStore)
				calendars.GET("", h.List)
				calendars.POST("", h.Create)
				calendars.POST("/sync", h.SyncAll)
				calendars.PUT("/:id", h.Update)
				calendars.DELETE("/:id", h.Delete)
			}
```

- [ ] **Step 5: Run tests + build to verify they pass**

Run: `cd backend && go test ./... && go build ./cmd/server`
Expected: PASS — all tests green; server builds.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/calendar_sources.go backend/internal/handler/calendar_sources_test.go backend/cmd/server/main.go
git commit -m "feat(api): calendar-sources CRUD + sync-all endpoint"
```

---

## Task 9: Frontend types + API wrapper

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/api/calendarSources.ts`

**Interfaces:**
- Produces:
  - `CalendarSource { id: string; name: string; url: string; event_type: EventType; last_synced_at?: string }`
  - `CalendarSyncSourceResult { source_id: string; name: string; added: number; updated: number; removed: number; skipped: number; error?: string }`
  - `CalendarSyncResult { sources: CalendarSyncSourceResult[]; added: number; updated: number; removed: number; skipped: number }`
  - `CalendarEvent` gains optional `source?: string; source_id?: string; external_uid?: string`.
  - API: `fetchCalendarSources()`, `createCalendarSource(input)`, `updateCalendarSource(id, src)`, `deleteCalendarSource(id)`, `syncCalendars()`.

- [ ] **Step 1: Extend the shared types**

In `frontend/src/types/index.ts`, replace the `CalendarEvent` interface (lines 14-23) with:

```ts
export interface CalendarEvent {
  id: string;
  member_emails: string[];
  scope: EventScope;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
  counts_as_working_day: boolean;
  /** "manual" (user-created) or "google" (calendar sync). Optional on writes. */
  source?: string;
  source_id?: string;
  external_uid?: string;
}
```

Append to the end of `frontend/src/types/index.ts`:

```ts
export interface CalendarSource {
  id: string;
  name: string;
  url: string;
  event_type: EventType;
  last_synced_at?: string;
}

export interface CalendarSyncSourceResult {
  source_id: string;
  name: string;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  error?: string;
}

export interface CalendarSyncResult {
  sources: CalendarSyncSourceResult[];
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}
```

- [ ] **Step 2: Create the API wrapper**

Create `frontend/src/api/calendarSources.ts`:

```ts
import type { CalendarSource, CalendarSyncResult } from "@/types";

export async function fetchCalendarSources(): Promise<CalendarSource[]> {
  const res = await fetch("/api/calendar-sources");
  if (!res.ok) throw new Error("Failed to fetch calendar sources");
  return (await res.json()) ?? [];
}

export async function createCalendarSource(
  input: Omit<CalendarSource, "id" | "last_synced_at">
): Promise<CalendarSource> {
  const res = await fetch("/api/calendar-sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create calendar source");
  return res.json() as Promise<CalendarSource>;
}

export async function updateCalendarSource(
  id: string,
  src: CalendarSource
): Promise<CalendarSource> {
  const res = await fetch(`/api/calendar-sources/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(src),
  });
  if (!res.ok) throw new Error("Failed to update calendar source");
  return res.json() as Promise<CalendarSource>;
}

export async function deleteCalendarSource(id: string): Promise<void> {
  const res = await fetch(`/api/calendar-sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete calendar source");
}

export async function syncCalendars(): Promise<CalendarSyncResult> {
  const res = await fetch("/api/calendar-sources/sync", { method: "POST" });
  if (!res.ok) throw new Error("Failed to sync calendars");
  return res.json() as Promise<CalendarSyncResult>;
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/calendarSources.ts
git commit -m "feat(frontend): calendar-source types + API wrapper"
```

---

## Task 10: Settings page

**Files:**
- Create: `frontend/src/components/SettingsPage.tsx`

**Interfaces:**
- Consumes: `CalendarSource`, `CalendarSyncResult`, `EventType` (Task 9 types); `fetchCalendarSources`, `createCalendarSource`, `updateCalendarSource`, `deleteCalendarSource`, `syncCalendars` (Task 9 API); UI components `Button`, `Input`, `Label`, `Select*` (existing under `@/components/ui/`).
- Produces: `export function SettingsPage(props: SettingsPageProps)` where `SettingsPageProps = { onEventsChanged: () => void }`. The page lists calendar sources (each row: name, URL, event-type select, save/delete), supports adding a row, and has a "Sync now" button that calls `syncCalendars()`, shows the result summary, and invokes `onEventsChanged()` so the timeline refetches.

- [ ] **Step 1: Create the page**

Create `frontend/src/components/SettingsPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { CalendarSource, CalendarSyncResult, EventType } from "@/types";
import {
  fetchCalendarSources,
  createCalendarSource,
  updateCalendarSource,
  deleteCalendarSource,
  syncCalendars,
} from "@/api/calendarSources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, RefreshCw } from "lucide-react";

interface SettingsPageProps {
  onEventsChanged: () => void;
}

const eventTypes: EventType[] = ["oncall", "leave", "holiday", "other"];

interface DraftRow {
  id?: string;
  name: string;
  url: string;
  event_type: EventType;
  last_synced_at?: string;
}

function toDraft(src: CalendarSource): DraftRow {
  return { id: src.id, name: src.name, url: src.url, event_type: src.event_type, last_synced_at: src.last_synced_at };
}

export function SettingsPage({ onEventsChanged }: SettingsPageProps) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalendarSyncResult | null>(null);

  useEffect(() => {
    fetchCalendarSources()
      .then((sources) => setRows(sources.map(toDraft)))
      .catch(() => setError("Failed to load calendar sources"));
  }, []);

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { name: "", url: "", event_type: "oncall" }]);
  }

  async function saveRow(index: number) {
    const row = rows[index];
    if (!row.name.trim() || !row.url.trim()) {
      setError("Name and URL are required");
      return;
    }
    setError(null);
    try {
      if (row.id) {
        const saved = await updateCalendarSource(row.id, {
          id: row.id,
          name: row.name,
          url: row.url,
          event_type: row.event_type,
          last_synced_at: row.last_synced_at,
        });
        updateRow(index, toDraft(saved));
      } else {
        const saved = await createCalendarSource({
          name: row.name,
          url: row.url,
          event_type: row.event_type,
        });
        updateRow(index, toDraft(saved));
      }
    } catch {
      setError("Failed to save calendar source");
    }
  }

  async function removeRow(index: number) {
    const row = rows[index];
    if (row.id) {
      try {
        await deleteCalendarSource(row.id);
      } catch {
        setError("Failed to delete calendar source");
        return;
      }
    }
    setRows((prev) => prev.filter((_, i) => i !== index));
    onEventsChanged();
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await syncCalendars();
      setResult(res);
      // Refresh saved sources to pick up last_synced_at stamps.
      const sources = await fetchCalendarSources();
      setRows(sources.map(toDraft));
      onEventsChanged();
    } catch {
      setError("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="h-full overflow-auto p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Google Calendar Sync</h2>
          <p className="text-[12px] text-muted-foreground">
            Register public Google Calendar links. Events are matched to members by the email in each event's title.
          </p>
        </div>
        <Button size="sm" onClick={handleSync} disabled={syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Sync now
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-[12px]">
          {result.added} added · {result.updated} updated · {result.removed} removed · {result.skipped} skipped
          {result.sources.some((s) => s.error) && (
            <ul className="mt-1 text-red-700">
              {result.sources.filter((s) => s.error).map((s) => (
                <li key={s.source_id}>{s.name}: {s.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={row.id ?? `new-${i}`} className="rounded-lg border p-3 space-y-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</Label>
                <Input
                  value={row.name}
                  placeholder="On-call calendar"
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  className="h-8 !text-[12px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Type</Label>
                <Select value={row.event_type} onValueChange={(v) => updateRow(i, { event_type: v as EventType })}>
                  <SelectTrigger className="h-8 !text-[12px] w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {eventTypes.map((t) => (
                      <SelectItem key={t} value={t} className="text-[12px]">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Calendar URL</Label>
              <Input
                value={row.url}
                placeholder="https://calendar.google.com/calendar/u/0?cid=…"
                onChange={(e) => updateRow(i, { url: e.target.value })}
                className="h-8 !text-[12px]"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {row.last_synced_at ? `Last synced ${new Date(row.last_synced_at).toLocaleString()}` : "Not synced yet"}
              </span>
              <div className="flex gap-2">
                <Button size="xs" variant="outline" onClick={() => saveRow(i)}>Save</Button>
                <Button size="xs" variant="ghost" onClick={() => removeRow(i)}>
                  <Trash2 className="text-red-600" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button size="sm" variant="outline" className="mt-3" onClick={addRow}>
        <Plus /> Add calendar
      </Button>
    </div>
  );
}
```

> The `Button` `xs` size and `outline`/`ghost` variants exist in `@/components/ui/button` (confirmed).

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SettingsPage.tsx
git commit -m "feat(frontend): Settings page for Google Calendar sources"
```

---

## Task 11: Wire Settings into App + auto-on-load sync

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `SettingsPage` (Task 10), `syncCalendars` (Task 9), `fetchEvents` (existing).
- Produces: a `"settings"` `PageView` with a nav button; `SettingsPage` rendered in `main`; an auto-sync on mount that refreshes events.

- [ ] **Step 1: Add imports**

In `frontend/src/App.tsx`, add to the imports (after line 15, the `ImportPage` import):

```ts
import { SettingsPage } from "@/components/SettingsPage";
import { syncCalendars } from "@/api/calendarSources";
```

And add `Settings` to the existing lucide import on line 17:

```ts
import { Users, CalendarDays, ClipboardCheck, RefreshCw, Flag, GanttChartSquare, Upload, Settings } from "lucide-react";
```

- [ ] **Step 2: Add the page to the PageView union and nav**

Replace line 19:

```ts
type PageView = "timeline" | "tasks" | "jira" | "import" | "settings";
```

Replace the `pageItems` array (lines 22-27):

```ts
const pageItems: { key: PageView; label: string; icon: typeof Users }[] = [
  { key: "timeline", label: "Timeline", icon: GanttChartSquare },
  { key: "tasks", label: "Tasks", icon: ClipboardCheck },
  { key: "jira", label: "Jira Sync", icon: RefreshCw },
  { key: "import", label: "Import", icon: Upload },
  { key: "settings", label: "Settings", icon: Settings },
];
```

- [ ] **Step 3: Add the auto-on-load sync effect**

In `frontend/src/App.tsx`, immediately after the existing `useEffect` mount block (after line 61, the `}, []);` that closes the initial-load effect), add a new effect:

```ts
  // Auto-sync calendars on load, then refresh events. Non-blocking; failures
  // are ignored (the last successful sync's events are already shown).
  useEffect(() => {
    syncCalendars()
      .then(() => fetchEvents())
      .then(setEvents)
      .catch(() => {});
  }, []);
```

- [ ] **Step 4: Render SettingsPage in main**

In `frontend/src/App.tsx`, in the `main` conditional chain, add a branch before the final `) : (` that renders `GanttChart` (i.e., after the `import` branch closes at line 194, insert):

```tsx
        ) : page === "settings" ? (
          <SettingsPage
            onEventsChanged={() => {
              fetchEvents().then(setEvents).catch(() => {});
            }}
          />
```

So the chain reads `… ) : page === "import" ? ( <ImportPage … /> ) : page === "settings" ? ( <SettingsPage … /> ) : ( <GanttChart … /> )`.

- [ ] **Step 5: Type-check + lint + build**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS — compiles, lints, and builds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): add Settings page + auto-sync calendars on load"
```

---

## Task 12: End-to-end verification (Playwright)

**Files:** none (verification only).

**Interfaces:**
- Consumes: the full running stack (backend on `:8080`, frontend dev server on `:5173`).

- [ ] **Step 1: Start the stack**

Run (two terminals, or background):
```bash
cd backend && go run ./cmd/server
cd frontend && npm run dev
```
Expected: backend logs "Server starting on :8080"; Vite serves `localhost:5173`.

- [ ] **Step 2: Seed a member matching the real feed**

Using the Members panel (or API), create a member whose email is one present in the example feed, e.g. `pansa.h@lmwn.com`. (The example feed's SUMMARYs are real member emails — see the spec's data findings.)

- [ ] **Step 3: Add the calendar source via the Settings page (Playwright MCP)**

Navigate to `http://localhost:5173`, click **Settings**, **Add calendar**, fill:
- Name: `POS On-call`
- Type: `oncall`
- URL: `https://calendar.google.com/calendar/u/0?cid=Y19iY2FhZWU1OGY1OTQ5NjZiNjUxNDhkZjg5OWU3MGYyOTE5MDhiOTc5YzY5NDFiNmI4ZmFmNDI1ZmYxYTE2Njg3QGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20`

Click **Save**, then **Sync now**. Take a screenshot.
Expected: a result summary like `N added · 0 updated · 0 removed · M skipped` (skipped = events for non-member emails).

- [ ] **Step 4: Verify events on the timeline**

Navigate to **Timeline**. Confirm on-call events appear on `pansa.h@lmwn.com`'s row in the synced date ranges. Screenshot.
Expected: oncall-styled events render on the matched member's row.

- [ ] **Step 5: Verify idempotent re-sync**

Return to **Settings**, click **Sync now** again. Screenshot.
Expected: summary shows `0 added · 0 updated · 0 removed` (plus skips) — confirming the upsert/prune is idempotent on an unchanged feed.

- [ ] **Step 6: Verify delete prunes events**

Delete the calendar source (Trash button). Navigate to **Timeline**.
Expected: the previously-synced on-call events are gone from the member's row.

- [ ] **Step 7: Confirm auto-on-load**

Re-add the source and Sync. Reload the page (`browser_navigate` to the same URL). Without clicking Sync, navigate to Timeline.
Expected: synced events are present (auto-on-load sync ran on mount).

- [ ] **Step 8: Final backend test sweep + commit (if any fixes were needed)**

Run: `cd backend && go test ./... && cd ../frontend && npm run build`
Expected: all green. Commit any verification-driven fixes with a clear message.

---

## Self-Review Notes (planner)

- **Spec coverage:** Settings page (Tasks 10–11), multiple sources (Tasks 2, 10), email-from-title matching (Task 6), per-source event type (Tasks 2, 6, 10), scope always personal (Task 6), idempotent upsert/prune by `(source_id, external_uid)` (Task 3), manual + auto-on-load sync (Tasks 10–11), public iCal read-only fetch (Tasks 4, 7), tz-aware + all-day-exclusive dates and RRULE-skip (Task 5), skip unknown members (Task 6), delete-prunes-events (Tasks 3, 8), back-compat CSV migration (Task 1). All covered.
- **Refinement discovered during planning (title rule):** the store's `GetEvents` normalizes titles to canonical labels for `leave`/`oncall`/`holiday` types. So a synced event's title is the canonical type label for those types and the **source name only for `other`-type** calendars. `BuildEvents` sets the title via the same `CanonicalTitle` rule so re-syncs stay stable (no false "updated" churn). This is a small, consistent deviation from "title = source name" and is called out in the verification (oncall events show "Oncall"). No user-facing surprise since the app already shows canonical labels for typed events.
- **Type consistency:** `ReplaceSyncedEvents` (4-return signature), `BuildEvents` (3-return), `SyncResult`/`SyncSourceResult` JSON shapes, and the TS mirrors are consistent across Tasks 3, 6, 8, 9.
