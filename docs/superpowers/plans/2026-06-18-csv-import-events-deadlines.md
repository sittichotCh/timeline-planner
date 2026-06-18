# CSV Import for Events & Deadlines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user bulk-import events and deadlines from a single CSV file whose `event_type` column (`event`/`deadline`) selects the kind of each row.

**Architecture:** A new pure `importer` package parses + validates the unified CSV into normalized `model.Event`/`model.Deadline` values; new `store` methods append non-duplicate items (assigning IDs); a new `POST /api/import` handler wires upload → parse → persist → summary. The frontend adds an `ImportPanel` slide-over (header nav entry) that uploads the file and shows a result summary, then refreshes the calendar data.

**Tech Stack:** Go 1.x + Gin (backend, `encoding/csv`), React 19 + TypeScript + Vite + Tailwind (frontend), `@base-ui` UI primitives.

## Global Constraints

- Go module path is `timeline-planner`; backend imports are `timeline-planner/internal/...`. Run backend commands from `backend/`.
- Frontend uses **strict TypeScript — no `any`**. Run frontend commands from `frontend/`.
- Persistence is **CSV files** under `DATA_DIR`, accessed only through `internal/store` (single `sync.RWMutex`; read-modify-write CRUD).
- **Jira stays read-only** — this feature never touches Jira.
- Events reference members by **email**; member emails are pipe (`|`) delimited inside one CSV cell.
- Import mode is **append + skip duplicates**; bad rows are **best-effort + reported** (per the spec `docs/superpowers/specs/2026-06-18-csv-import-events-deadlines-design.md`).
- The frontend has no unit-test runner; frontend verification = `npm run build` (tsc) + `npm run lint` + Playwright MCP.

---

### Task 1: Share event-type normalization in the `model` package

Move the private `migrateEventType` / `canonicalTitle` helpers out of `store/events.go` into `model` as exported functions, so the importer and the store apply identical normalization (no drift). Behavior is unchanged.

**Files:**
- Modify: `backend/internal/model/event.go` (add two functions after the structs)
- Test: `backend/internal/model/event_test.go` (create)
- Modify: `backend/internal/store/events.go` (delete private helpers lines 42-67; update call sites lines 105, 109, 139, 151)

**Interfaces:**
- Produces:
  - `model.NormalizeEventType(t EventType) EventType` — maps `vacation`→`leave`, `busy`→`oncall`, `weekend`→`other`; returns the input unchanged otherwise.
  - `model.CanonicalTitle(t EventType) (string, bool)` — returns `("Leave"|"Oncall"|"Holiday", true)` for those types, `("", false)` for `other`/unknown.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/model/event_test.go`:

```go
package model

import "testing"

func TestNormalizeEventType(t *testing.T) {
	cases := map[EventType]EventType{
		"vacation":   EventLeave,
		"busy":       EventOncall,
		"weekend":    EventOther,
		EventLeave:   EventLeave,
		EventOncall:  EventOncall,
		EventHoliday: EventHoliday,
		EventOther:   EventOther,
		"unknown":    "unknown",
	}
	for in, want := range cases {
		if got := NormalizeEventType(in); got != want {
			t.Errorf("NormalizeEventType(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCanonicalTitle(t *testing.T) {
	if title, ok := CanonicalTitle(EventLeave); !ok || title != "Leave" {
		t.Errorf("CanonicalTitle(leave) = %q, %v; want \"Leave\", true", title, ok)
	}
	if title, ok := CanonicalTitle(EventHoliday); !ok || title != "Holiday" {
		t.Errorf("CanonicalTitle(holiday) = %q, %v; want \"Holiday\", true", title, ok)
	}
	if title, ok := CanonicalTitle(EventOther); ok || title != "" {
		t.Errorf("CanonicalTitle(other) = %q, %v; want \"\", false", title, ok)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/model/`
Expected: FAIL — build error `undefined: NormalizeEventType` and `undefined: CanonicalTitle`.

- [ ] **Step 3: Add the functions to `model/event.go`**

Append to `backend/internal/model/event.go` (after the `Event` struct):

```go

// NormalizeEventType maps legacy type values to the current set
// (leave, oncall, holiday, other). Unknown values are returned unchanged.
func NormalizeEventType(t EventType) EventType {
	switch t {
	case "vacation":
		return EventLeave
	case "busy":
		return EventOncall
	case "weekend":
		return EventOther
	}
	return t
}

// CanonicalTitle returns the fixed display title for non-"other" types.
// The bool is false for EventOther or an unknown type, in which case the
// caller keeps its own title.
func CanonicalTitle(t EventType) (string, bool) {
	switch t {
	case EventLeave:
		return "Leave", true
	case EventOncall:
		return "Oncall", true
	case EventHoliday:
		return "Holiday", true
	}
	return "", false
}
```

- [ ] **Step 4: Run model test to verify it passes**

Run: `cd backend && go test ./internal/model/`
Expected: PASS — `ok  	timeline-planner/internal/model`.

- [ ] **Step 5: Update `store/events.go` to use the model helpers and delete the private copies**

In `backend/internal/store/events.go`, delete the two private functions (currently lines 42-67):

```go
// migrateEventType maps legacy type values to the current set
// (leave, oncall, holiday, other).
func migrateEventType(t model.EventType) model.EventType {
	switch t {
	case "vacation":
		return model.EventLeave
	case "busy":
		return model.EventOncall
	case "weekend":
		return model.EventOther
	}
	return t
}

// canonicalTitle returns the fixed display title for non-"other" types.
func canonicalTitle(t model.EventType) (string, bool) {
	switch t {
	case model.EventLeave:
		return "Leave", true
	case model.EventOncall:
		return "Oncall", true
	case model.EventHoliday:
		return "Holiday", true
	}
	return "", false
}
```

Then update the four call sites:

In `GetEvents` change:
```go
		if migrated := migrateEventType(e.Type); migrated != e.Type {
```
to:
```go
		if migrated := model.NormalizeEventType(e.Type); migrated != e.Type {
```

And change:
```go
		if title, ok := canonicalTitle(e.Type); ok && e.Title != title {
```
to:
```go
		if title, ok := model.CanonicalTitle(e.Type); ok && e.Title != title {
```

In `CreateEvent` change:
```go
	if title, ok := canonicalTitle(e.Type); ok {
```
to:
```go
	if title, ok := model.CanonicalTitle(e.Type); ok {
```

In `UpdateEvent` change:
```go
	if title, ok := canonicalTitle(e.Type); ok {
```
to:
```go
	if title, ok := model.CanonicalTitle(e.Type); ok {
```

- [ ] **Step 6: Build and run the full backend test suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS — everything compiles; `ok` for `internal/model` and `cmd/server`, no failures. (`internal/store` has no tests yet, reported as `no test files` — that is fine.)

- [ ] **Step 7: Commit**

```bash
git add backend/internal/model/event.go backend/internal/model/event_test.go backend/internal/store/events.go
git commit -m "refactor: move event type normalization into model package"
```

---

### Task 2: `importer` package — parse & validate the unified CSV

A pure package that turns a CSV reader into valid events, valid deadlines, and per-row errors. No persistence, no IDs, no dedup.

**Files:**
- Create: `backend/internal/importer/importer.go`
- Test: `backend/internal/importer/importer_test.go`

**Interfaces:**
- Consumes: `model.Event`, `model.Deadline`, `model.NormalizeEventType`, `model.CanonicalTitle` (Task 1).
- Produces:
  - `importer.RowError` struct: `{ Row int json:"row"; Reason string json:"reason" }` (Row = 1-based CSV line; header is line 1).
  - `importer.Parse(r io.Reader) ([]model.Event, []model.Deadline, []RowError, error)` — events/deadlines are normalized and **have no ID**; the `error` is non-nil only for a structurally unusable file (unreadable, empty, or missing the `event_type` header).

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/importer/importer_test.go`:

```go
package importer

import (
	"strings"
	"testing"

	"timeline-planner/internal/model"
)

func TestParseValidEventAndDeadline(t *testing.T) {
	csv := `event_type,title,start_date,end_date,member_emails,scope,type,color
event,Regression,2026-05-25,2026-05-29,a@co.com|b@co.com,personal,other,
deadline,Release 1%,2026-08-03,,,,,blue
`
	events, deadlines, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("unexpected row errors: %v", rowErrs)
	}
	if len(events) != 1 || len(deadlines) != 1 {
		t.Fatalf("got %d events, %d deadlines; want 1,1", len(events), len(deadlines))
	}
	e := events[0]
	if e.Title != "Regression" || e.Type != model.EventOther || e.Scope != model.ScopePersonal {
		t.Errorf("unexpected event: %+v", e)
	}
	if len(e.MemberEmails) != 2 {
		t.Errorf("expected 2 emails, got %v", e.MemberEmails)
	}
	if e.ID != "" {
		t.Errorf("importer must not assign IDs, got %q", e.ID)
	}
	d := deadlines[0]
	if d.Title != "Release 1%" || d.Date != "2026-08-03" || d.Color != "blue" {
		t.Errorf("unexpected deadline: %+v", d)
	}
}

func TestParseHeaderOrderIndependentAndExtraColumns(t *testing.T) {
	csv := `note,type,event_type,title,end_date,start_date,scope
ignored,holiday,event,whatever,2026-06-01,2026-06-01,team
`
	events, _, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("unexpected row errors: %v", rowErrs)
	}
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	e := events[0]
	if e.Type != model.EventHoliday {
		t.Errorf("want holiday, got %q", e.Type)
	}
	if e.Title != "Holiday" { // canonicalized
		t.Errorf("want canonical title Holiday, got %q", e.Title)
	}
	if e.Scope != model.ScopeTeam {
		t.Errorf("want team scope, got %q", e.Scope)
	}
}

func TestParseEventDefaults(t *testing.T) {
	// blank scope -> personal; blank type -> other (needs title + members)
	csv := `event_type,title,start_date,end_date,member_emails,scope,type
event,My Task,2026-06-01,2026-06-02,a@co.com,,
`
	events, _, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("row errs: %v", rowErrs)
	}
	if len(events) != 1 {
		t.Fatalf("want 1, got %d", len(events))
	}
	if events[0].Scope != model.ScopePersonal {
		t.Errorf("want personal scope")
	}
	if events[0].Type != model.EventOther {
		t.Errorf("want other type")
	}
}

func TestParseSkipsBlankCommaOnlyRows(t *testing.T) {
	csv := "event_type,title,start_date,end_date,member_emails,scope,type\n" +
		",,,,,,\n" +
		"event,X,2026-06-01,2026-06-02,a@co.com,personal,other\n"
	events, _, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("blank row must not be an error: %v", rowErrs)
	}
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
}

func TestParseRowErrors(t *testing.T) {
	cases := []struct {
		name string
		row  string
		want string
	}{
		{"unknown event_type", "task,X,2026-06-01,2026-06-02,a@co.com,personal,other", "unknown event_type"},
		{"bad start date", "event,X,2026-13-40,2026-06-02,a@co.com,personal,other", "invalid start_date"},
		{"bad end date", "event,X,2026-06-01,nope,a@co.com,personal,other", "invalid end_date"},
		{"end before start", "event,X,2026-06-05,2026-06-01,a@co.com,personal,other", "end_date is before start_date"},
		{"other needs title", "event,,2026-06-01,2026-06-02,a@co.com,personal,other", "title is required"},
		{"personal needs members", "event,X,2026-06-01,2026-06-02,,personal,other", "member_emails is required"},
		{"bad scope", "event,X,2026-06-01,2026-06-02,a@co.com,nope,other", "invalid scope"},
		{"bad type", "event,X,2026-06-01,2026-06-02,a@co.com,personal,bogus", "unknown type"},
		{"deadline needs title", "deadline,,2026-08-03,,,,", "title is required"},
		{"deadline bad date", "deadline,Ship,nope,,,,", "invalid start_date"},
	}
	header := "event_type,title,start_date,end_date,member_emails,scope,type\n"
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			events, deadlines, rowErrs, err := Parse(strings.NewReader(header + tc.row + "\n"))
			if err != nil {
				t.Fatalf("unexpected fatal err: %v", err)
			}
			if len(events) != 0 || len(deadlines) != 0 {
				t.Fatalf("expected no valid items, got %d events %d deadlines", len(events), len(deadlines))
			}
			if len(rowErrs) != 1 {
				t.Fatalf("expected 1 row error, got %d: %v", len(rowErrs), rowErrs)
			}
			if rowErrs[0].Row != 2 {
				t.Errorf("expected error on line 2, got %d", rowErrs[0].Row)
			}
			if !strings.Contains(rowErrs[0].Reason, tc.want) {
				t.Errorf("reason %q does not contain %q", rowErrs[0].Reason, tc.want)
			}
		})
	}
}

func TestParseFatalErrors(t *testing.T) {
	if _, _, _, err := Parse(strings.NewReader("")); err == nil {
		t.Error("expected error for empty file")
	}
	if _, _, _, err := Parse(strings.NewReader("title,date\nX,2026-01-01\n")); err == nil {
		t.Error("expected error for missing event_type header")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/importer/`
Expected: FAIL — build error `undefined: Parse` (package has no implementation yet).

- [ ] **Step 3: Write the implementation**

Create `backend/internal/importer/importer.go`:

```go
// Package importer parses a unified CSV of events and deadlines into model
// values, applying per-row validation and defaults. It performs no
// persistence and no duplicate detection (those are the store's job).
package importer

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
	"time"

	"timeline-planner/internal/model"
)

// RowError describes a single row that failed validation. Row is the 1-based
// CSV line number (the header is line 1, so the first data row is line 2).
type RowError struct {
	Row    int    `json:"row"`
	Reason string `json:"reason"`
}

const dateLayout = "2006-01-02"

var deadlineColors = map[string]bool{
	"red": true, "orange": true, "amber": true,
	"emerald": true, "blue": true, "violet": true,
}

// Parse reads a unified events/deadlines CSV from r. It returns the valid
// events and deadlines (normalized, without IDs) plus a RowError for every
// invalid row. A non-nil error is returned only for a structurally unusable
// file: unreadable, empty, or missing the required "event_type" header.
func Parse(r io.Reader) ([]model.Event, []model.Deadline, []RowError, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1 // allow ragged rows; we index by header name
	records, err := reader.ReadAll()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("could not parse CSV: %w", err)
	}
	if len(records) == 0 {
		return nil, nil, nil, fmt.Errorf("file is empty")
	}

	col := map[string]int{}
	for i, name := range records[0] {
		col[strings.ToLower(strings.TrimSpace(name))] = i
	}
	if _, ok := col["event_type"]; !ok {
		return nil, nil, nil, fmt.Errorf("missing required column: event_type")
	}

	get := func(row []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}

	events := []model.Event{}
	deadlines := []model.Deadline{}
	rowErrors := []RowError{}

	for i := 1; i < len(records); i++ {
		row := records[i]
		line := i + 1 // 1-based; header is line 1

		if isBlankRow(row) {
			continue
		}

		switch strings.ToLower(get(row, "event_type")) {
		case "event":
			e, reason := parseEvent(row, get)
			if reason != "" {
				rowErrors = append(rowErrors, RowError{Row: line, Reason: reason})
				continue
			}
			events = append(events, e)
		case "deadline":
			d, reason := parseDeadline(row, get)
			if reason != "" {
				rowErrors = append(rowErrors, RowError{Row: line, Reason: reason})
				continue
			}
			deadlines = append(deadlines, d)
		default:
			rowErrors = append(rowErrors, RowError{
				Row:    line,
				Reason: fmt.Sprintf("unknown event_type %q (expected \"event\" or \"deadline\")", get(row, "event_type")),
			})
		}
	}

	return events, deadlines, rowErrors, nil
}

type getter func(row []string, name string) string

func parseEvent(row []string, get getter) (model.Event, string) {
	start := get(row, "start_date")
	end := get(row, "end_date")
	if !validDate(start) {
		return model.Event{}, "invalid start_date: expected YYYY-MM-DD"
	}
	if !validDate(end) {
		return model.Event{}, "invalid end_date: expected YYYY-MM-DD"
	}
	if end < start { // safe: both are validated YYYY-MM-DD
		return model.Event{}, "end_date is before start_date"
	}

	scope := model.EventScope(strings.ToLower(get(row, "scope")))
	switch scope {
	case "":
		scope = model.ScopePersonal
	case model.ScopePersonal, model.ScopeTeam:
		// ok
	default:
		return model.Event{}, fmt.Sprintf("invalid scope %q (expected \"personal\" or \"team\")", get(row, "scope"))
	}

	rawType := model.EventType(strings.ToLower(get(row, "type")))
	if rawType == "" {
		rawType = model.EventOther
	}
	etype := model.NormalizeEventType(rawType)
	if !validEventType(etype) {
		return model.Event{}, fmt.Sprintf("unknown type %q", get(row, "type"))
	}

	title := get(row, "title")
	if canonical, ok := model.CanonicalTitle(etype); ok {
		title = canonical
	} else if title == "" {
		return model.Event{}, "title is required for type \"other\""
	}

	emails := parseEmails(get(row, "member_emails"))
	if scope == model.ScopePersonal && len(emails) == 0 {
		return model.Event{}, "member_emails is required for personal events"
	}

	return model.Event{
		MemberEmails: emails,
		Scope:        scope,
		Type:         etype,
		Title:        title,
		StartDate:    start,
		EndDate:      end,
	}, ""
}

func parseDeadline(row []string, get getter) (model.Deadline, string) {
	date := get(row, "start_date")
	if !validDate(date) {
		return model.Deadline{}, "invalid start_date: expected YYYY-MM-DD"
	}
	title := get(row, "title")
	if title == "" {
		return model.Deadline{}, "title is required"
	}
	color := strings.ToLower(get(row, "color"))
	if !deadlineColors[color] {
		color = "red"
	}
	return model.Deadline{Title: title, Date: date, Color: color}, ""
}

func validDate(s string) bool {
	if s == "" {
		return false
	}
	_, err := time.Parse(dateLayout, s)
	return err == nil
}

func validEventType(t model.EventType) bool {
	switch t {
	case model.EventLeave, model.EventOncall, model.EventHoliday, model.EventOther:
		return true
	}
	return false
}

func isBlankRow(row []string) bool {
	for _, c := range row {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

// parseEmails splits a pipe-delimited cell into trimmed, non-empty emails.
// Kept local to the importer to avoid coupling to the store's unexported copy.
func parseEmails(raw string) []string {
	if raw == "" {
		return []string{}
	}
	parts := strings.Split(raw, "|")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/importer/`
Expected: PASS — `ok  	timeline-planner/internal/importer`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/importer/
git commit -m "feat: add importer package for unified events/deadlines CSV"
```

---

### Task 3: Store import methods with duplicate detection

Add batch append+dedup methods for events and deadlines.

**Files:**
- Create: `backend/internal/store/import.go`
- Test: `backend/internal/store/import_test.go`

**Interfaces:**
- Consumes: `model.Event`, `model.Deadline`; existing store methods `GetEvents`, `writeEvents`, `GetDeadlines`, `writeDeadlines`, `genID`.
- Produces:
  - `(*Store) ImportEvents(candidates []model.Event) (added int, skipped int, err error)`
  - `(*Store) ImportDeadlines(candidates []model.Deadline) (added int, skipped int, err error)`
  - Skips any candidate whose content matches an existing item or an earlier accepted candidate in the same batch; accepted items get a fresh `genID()`. Writes the file once, only when `added > 0`.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/store/import_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/store/`
Expected: FAIL — build error `s.ImportEvents undefined` / `s.ImportDeadlines undefined`.

- [ ] **Step 3: Write the implementation**

Create `backend/internal/store/import.go`:

```go
package store

import (
	"sort"
	"strings"

	"timeline-planner/internal/model"
)

const keySep = "\x1f" // unit separator: safe delimiter for composite keys

// eventKey is the content identity of an event for duplicate detection.
// Member emails are sorted so ordering does not affect identity.
func eventKey(e model.Event) string {
	emails := append([]string(nil), e.MemberEmails...)
	sort.Strings(emails)
	return strings.Join([]string{
		string(e.Scope),
		string(e.Type),
		e.Title,
		e.StartDate,
		e.EndDate,
		strings.Join(emails, "|"),
	}, keySep)
}

// deadlineKey is the content identity of a deadline (color is cosmetic and
// excluded).
func deadlineKey(d model.Deadline) string {
	return d.Title + keySep + d.Date
}

// ImportEvents appends candidates that are not duplicates of an existing event
// or of an earlier accepted candidate in the same batch. Accepted events get a
// fresh ID. Returns how many were added and how many were skipped.
func (s *Store) ImportEvents(candidates []model.Event) (added int, skipped int, err error) {
	existing, err := s.GetEvents()
	if err != nil {
		return 0, 0, err
	}
	seen := make(map[string]bool, len(existing)+len(candidates))
	for _, e := range existing {
		seen[eventKey(e)] = true
	}
	result := existing
	for _, c := range candidates {
		k := eventKey(c)
		if seen[k] {
			skipped++
			continue
		}
		seen[k] = true
		c.ID = genID()
		result = append(result, c)
		added++
	}
	if added > 0 {
		if err := s.writeEvents(result); err != nil {
			return 0, 0, err
		}
	}
	return added, skipped, nil
}

// ImportDeadlines mirrors ImportEvents for deadlines.
func (s *Store) ImportDeadlines(candidates []model.Deadline) (added int, skipped int, err error) {
	existing, err := s.GetDeadlines()
	if err != nil {
		return 0, 0, err
	}
	seen := make(map[string]bool, len(existing)+len(candidates))
	for _, d := range existing {
		seen[deadlineKey(d)] = true
	}
	result := existing
	for _, c := range candidates {
		k := deadlineKey(c)
		if seen[k] {
			skipped++
			continue
		}
		seen[k] = true
		c.ID = genID()
		result = append(result, c)
		added++
	}
	if added > 0 {
		if err := s.writeDeadlines(result); err != nil {
			return 0, 0, err
		}
	}
	return added, skipped, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/store/`
Expected: PASS — `ok  	timeline-planner/internal/store`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/import.go backend/internal/store/import_test.go
git commit -m "feat: add store ImportEvents/ImportDeadlines with dedup"
```

---

### Task 4: `POST /api/import` handler and route

Glue layer: read the uploaded file, parse, persist, return a summary.

**Files:**
- Create: `backend/internal/handler/import.go`
- Test: `backend/internal/handler/import_test.go`
- Modify: `backend/cmd/server/main.go` (register the route inside the `/api` group)

**Interfaces:**
- Consumes: `importer.Parse`, `importer.RowError` (Task 2); `store.ImportEvents`, `store.ImportDeadlines` (Task 3).
- Produces:
  - `handler.NewImport(s *store.Store) *Import`
  - `(*Import) Upload(c *gin.Context)` for `POST /api/import` — `multipart/form-data`, field `file`.
  - JSON response shape: `{ imported_events, imported_deadlines, skipped_duplicates, errors: [{row, reason}] }`. HTTP 200 best-effort; HTTP 400 for missing/unusable file or missing `event_type` header.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/handler/import_test.go`:

```go
package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

func multipartCSV(t *testing.T, content string) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	fw, err := w.CreateFormFile("file", "import.csv")
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := fw.Write([]byte(content)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return body, w.FormDataContentType()
}

func TestImportUploadHappyPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s, err := store.New(t.TempDir())
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	r := gin.New()
	r.POST("/api/import", NewImport(s).Upload)

	csv := "event_type,title,start_date,end_date,member_emails,scope,type,color\n" +
		"event,Regression,2026-05-25,2026-05-29,a@co.com,personal,other,\n" +
		"deadline,Release,2026-08-03,,,,,blue\n" +
		"task,Bad,2026-01-01,2026-01-02,a@co.com,personal,other,\n"
	body, contentType := multipartCSV(t, csv)

	req := httptest.NewRequest(http.MethodPost, "/api/import", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp importResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.ImportedEvents != 1 || resp.ImportedDeadlines != 1 {
		t.Errorf("imported events=%d deadlines=%d; want 1,1", resp.ImportedEvents, resp.ImportedDeadlines)
	}
	if len(resp.Errors) != 1 || resp.Errors[0].Row != 4 {
		t.Errorf("expected 1 error on row 4, got %+v", resp.Errors)
	}
}

func TestImportUploadMissingFile(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s, _ := store.New(t.TempDir())
	r := gin.New()
	r.POST("/api/import", NewImport(s).Upload)

	req := httptest.NewRequest(http.MethodPost, "/api/import", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/handler/`
Expected: FAIL — build error `undefined: NewImport` and `undefined: importResponse`.

- [ ] **Step 3: Write the handler**

Create `backend/internal/handler/import.go`:

```go
package handler

import (
	"net/http"

	"timeline-planner/internal/importer"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type Import struct {
	store *store.Store
}

func NewImport(s *store.Store) *Import {
	return &Import{store: s}
}

type importResponse struct {
	ImportedEvents    int                 `json:"imported_events"`
	ImportedDeadlines int                 `json:"imported_deadlines"`
	SkippedDuplicates int                 `json:"skipped_duplicates"`
	Errors            []importer.RowError `json:"errors"`
}

// Upload handles POST /api/import: a multipart form with a "file" field
// containing the unified events/deadlines CSV.
func (h *Import) Upload(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a CSV file is required (form field \"file\")"})
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not open uploaded file"})
		return
	}
	defer f.Close()

	events, deadlines, rowErrors, err := importer.Parse(f)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	addedEvents, skippedEvents, err := h.store.ImportEvents(events)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	addedDeadlines, skippedDeadlines, err := h.store.ImportDeadlines(deadlines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if rowErrors == nil {
		rowErrors = []importer.RowError{}
	}
	c.JSON(http.StatusOK, importResponse{
		ImportedEvents:    addedEvents,
		ImportedDeadlines: addedDeadlines,
		SkippedDuplicates: skippedEvents + skippedDeadlines,
		Errors:            rowErrors,
	})
}
```

- [ ] **Step 4: Run handler tests to verify they pass**

Run: `cd backend && go test ./internal/handler/`
Expected: PASS — `ok  	timeline-planner/internal/handler`.

- [ ] **Step 5: Register the route in `main.go`**

In `backend/cmd/server/main.go`, find the deadlines group (lines 68-75) and insert the import route immediately after its closing brace, still inside the `api` group:

```go
		deadlines := api.Group("/deadlines")
		{
			h := handler.NewDeadlines(yamlStore)
			deadlines.GET("", h.List)
			deadlines.POST("", h.Create)
			deadlines.PUT("/:id", h.Update)
			deadlines.DELETE("/:id", h.Delete)
		}

		api.POST("/import", handler.NewImport(yamlStore).Upload)
```

- [ ] **Step 6: Build and run the full backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS — all packages compile; `ok` for `internal/model`, `internal/importer`, `internal/store`, `internal/handler`, `cmd/server`.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/handler/import.go backend/internal/handler/import_test.go backend/cmd/server/main.go
git commit -m "feat: add POST /api/import endpoint"
```

---

### Task 5: Frontend import API client and types

**Files:**
- Modify: `frontend/src/types/index.ts` (append two interfaces)
- Create: `frontend/src/api/import.ts`

**Interfaces:**
- Produces:
  - `ImportRowError { row: number; reason: string }`
  - `ImportResult { imported_events: number; imported_deadlines: number; skipped_duplicates: number; errors: ImportRowError[] }`
  - `importCsv(file: File): Promise<ImportResult>`

- [ ] **Step 1: Add the types**

Append to `frontend/src/types/index.ts`:

```ts

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportResult {
  imported_events: number;
  imported_deadlines: number;
  skipped_duplicates: number;
  errors: ImportRowError[];
}
```

- [ ] **Step 2: Add the API client**

Create `frontend/src/api/import.ts`:

```ts
import type { ImportResult } from "@/types";

export async function importCsv(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/import", { method: "POST", body: form });
  if (!res.ok) {
    let message = "Failed to import CSV";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // response had no JSON body; keep the default message
    }
    throw new Error(message);
  }
  return (await res.json()) as ImportResult;
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npm run build`
Expected: PASS — `tsc` reports no errors and Vite builds. (No runtime wiring yet; this only proves the new module type-checks.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/import.ts
git commit -m "feat: add import API client and types (frontend)"
```

---

### Task 6: `ImportPanel` component

A slide-over panel: download-sample button, file picker, import button, and a result summary.

**Files:**
- Create: `frontend/src/components/ImportPanel.tsx`

**Interfaces:**
- Consumes: `importCsv` (Task 5), `ImportResult`; `Sheet*` from `@/components/ui/sheet`, `Button` from `@/components/ui/button`; lucide icons.
- Produces: `ImportPanel` component with props `{ onImported: () => void; onClose: () => void }`. Calls `onImported()` after an import that added at least one item.

- [ ] **Step 1: Write the component**

Create `frontend/src/components/ImportPanel.tsx`:

```tsx
import { useRef, useState } from "react";
import type { ImportResult } from "@/types";
import { importCsv } from "@/api/import";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Upload, FileDown, FileText } from "lucide-react";

interface ImportPanelProps {
  onImported: () => void;
  onClose: () => void;
}

const SAMPLE_CSV =
  "event_type,title,start_date,end_date,member_emails,scope,type,color\n" +
  "event,Regression,2026-05-25,2026-05-29,alice@co.com|bob@co.com,personal,other,\n" +
  "event,,2026-06-01,2026-06-01,,team,holiday,\n" +
  "deadline,Release 1%,2026-08-03,,,,,red\n";

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportPanel({ onImported, onClose }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await importCsv(file);
      setResult(res);
      if (res.imported_events + res.imported_deadlines > 0) {
        onImported();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" style={{ maxWidth: 420 }}>
        <SheetHeader>
          <SheetTitle>Import CSV</SheetTitle>
          <SheetDescription>
            Bulk-add events and deadlines from one CSV file.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-3">
          <div className="text-[12px] text-muted-foreground leading-relaxed">
            Each row needs an <code className="text-foreground">event_type</code> of{" "}
            <code className="text-foreground">event</code> or{" "}
            <code className="text-foreground">deadline</code>. Columns are matched by
            header name, so order doesn&rsquo;t matter.
          </div>

          <Button variant="outline" size="sm" onClick={downloadSample} className="w-full">
            <FileDown />
            Download sample CSV
          </Button>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => inputRef.current?.click()}
          >
            <FileText />
            {file ? file.name : "Choose CSV file…"}
          </Button>

          {error && (
            <div className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="bg-emerald-500/10 text-emerald-700 text-[12px] px-3 py-2 rounded-lg">
                Imported {result.imported_events} event{result.imported_events === 1 ? "" : "s"},{" "}
                {result.imported_deadlines} deadline{result.imported_deadlines === 1 ? "" : "s"}
                {result.skipped_duplicates > 0
                  ? ` · ${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? "" : "s"} skipped`
                  : ""}
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped
                  </p>
                  {result.errors.map((e) => (
                    <div
                      key={e.row}
                      className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg"
                    >
                      Line {e.row}: {e.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button onClick={handleImport} disabled={!file || busy} className="w-full">
            <Upload />
            {busy ? "Importing…" : "Import"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no `tsc` errors, no ESLint errors. (Component is not yet mounted; this only proves it compiles and lints.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ImportPanel.tsx
git commit -m "feat: add ImportPanel component"
```

---

### Task 7: Wire `ImportPanel` into `App` and verify end-to-end

**Files:**
- Modify: `frontend/src/App.tsx` (import + icon, `SlidePanel` union, `panelItems`, render block)

**Interfaces:**
- Consumes: `ImportPanel` (Task 6); existing `fetchEvents`, `fetchDeadlines` (already imported in `App.tsx`).

- [ ] **Step 1: Add the imports**

In `frontend/src/App.tsx`, after the existing panel import line:
```ts
import { DeadlinePanel } from "@/components/DeadlinePanel";
```
add:
```ts
import { ImportPanel } from "@/components/ImportPanel";
```

Change the lucide import line:
```ts
import { Users, CalendarDays, ClipboardCheck, RefreshCw, Flag, GanttChartSquare } from "lucide-react";
```
to:
```ts
import { Users, CalendarDays, ClipboardCheck, RefreshCw, Flag, GanttChartSquare, Upload } from "lucide-react";
```

- [ ] **Step 2: Extend the panel union and nav items**

Change:
```ts
type SlidePanel = "members" | "events" | "deadlines" | null;
```
to:
```ts
type SlidePanel = "members" | "events" | "deadlines" | "import" | null;
```

Change:
```ts
const panelItems: { key: "members" | "events" | "deadlines"; label: string; icon: typeof Users }[] = [
  { key: "members", label: "Members", icon: Users },
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "deadlines", label: "Deadlines", icon: Flag },
];
```
to:
```ts
const panelItems: { key: "members" | "events" | "deadlines" | "import"; label: string; icon: typeof Users }[] = [
  { key: "members", label: "Members", icon: Users },
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "deadlines", label: "Deadlines", icon: Flag },
  { key: "import", label: "Import", icon: Upload },
];
```

- [ ] **Step 3: Render the panel**

After the existing deadlines panel block:
```tsx
      {panel === "deadlines" && (
        <DeadlinePanel
          deadlines={deadlines}
          onDeadlinesChange={setDeadlines}
          onClose={() => setPanel(null)}
        />
      )}
```
add:
```tsx
      {panel === "import" && (
        <ImportPanel
          onImported={() => {
            Promise.all([fetchEvents(), fetchDeadlines()])
              .then(([e, d]) => {
                setEvents(e);
                setDeadlines(d);
              })
              .catch(() => {});
          }}
          onClose={() => setPanel(null)}
        />
      )}
```

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no `tsc` errors, no ESLint errors.

- [ ] **Step 5: Create a verification fixture**

Create `F:\workspace\timeline-planner\tmp\import-verify.csv` with one valid event, one valid deadline, and one bad row:

```
event_type,title,start_date,end_date,member_emails,scope,type,color
event,Playwright Check,2026-06-20,2026-06-22,verify@co.com,personal,other,
deadline,Verify Release,2026-06-25,,,,,violet
event,Broken,2026-13-99,2026-06-22,verify@co.com,personal,other,
```

- [ ] **Step 6: Start both servers**

Backend (terminal 1): `cd backend && go run ./cmd/server`
Frontend (terminal 2): `cd frontend && npm run dev`
Expected: backend logs `Server starting on :8080`; Vite serves `http://localhost:5173`.

- [ ] **Step 7: Verify in the browser with Playwright MCP**

Using the Playwright MCP tools:
1. `browser_navigate` to `http://localhost:5173`.
2. `browser_snapshot`; confirm an **Import** button is present in the header nav.
3. `browser_click` the **Import** button; confirm the "Import CSV" sheet opens (title + "Choose CSV file…" + disabled "Import" button).
4. `browser_click` the **Choose CSV file…** button, then `browser_file_upload` with path `F:\workspace\timeline-planner\tmp\import-verify.csv` (the hidden `<input type="file">` opens a file chooser when the button is clicked).
5. Confirm the button now shows `import-verify.csv` and the **Import** button is enabled; `browser_click` **Import**.
6. `browser_snapshot` / `browser_take_screenshot`; confirm the green summary reads **"Imported 1 event, 1 deadline"** and one skipped row reads **"Line 4: invalid start_date: expected YYYY-MM-DD"**.
7. `browser_click` the sheet close (X), open the **Events** panel, and confirm **"Playwright Check"** now appears; open the **Deadlines** panel and confirm **"Verify Release"** appears (proves `onImported` refreshed App state).

Expected: all confirmations hold. If any fails, fix before continuing.

- [ ] **Step 8: Re-import to verify duplicate skipping**

With the same file, repeat the Import flow once more (steps 3-6).
Expected: green summary now reads **"Imported 0 events, 0 deadlines · 1 duplicate skipped"** and still **"Line 4: invalid start_date…"**. (The valid event + deadline already exist, so both are skipped; the bad row still errors.)

- [ ] **Step 9: Clean up the fixture**

```bash
rm F:/workspace/timeline-planner/tmp/import-verify.csv
```

- [ ] **Step 10: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wire CSV import panel into App"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §3 unified format, header-by-name matching | Task 2 (Parse header map) |
| §4 event validation/defaults | Task 2 `parseEvent` |
| §4 deadline validation/defaults | Task 2 `parseDeadline` |
| §4 error line numbers | Task 2 (`line := i + 1`), test asserts row 2 / row 4 |
| §5 append + dedup (event & deadline keys, within-batch) | Task 3 |
| §6 route `POST /api/import` (multipart) | Task 4 |
| §6 importer package (pure) | Task 2 |
| §6 store import methods | Task 3 |
| §6 handler glue + response shape + 200/400 | Task 4 |
| §6 shared-normalization refactor | Task 1 |
| §7 header nav Import entry + Sheet panel | Tasks 6, 7 |
| §7 download sample CSV | Task 6 `downloadSample` |
| §7 results display (success + skipped rows) | Task 6 |
| §7 refresh events+deadlines on success | Task 7 `onImported` |
| §7 api client + types, strict TS | Task 5 |
| §8 backend unit tests | Tasks 1-4 |
| §8 frontend Playwright verification | Task 7 |

No gaps found.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to"; every code step contains complete code and every command lists expected output.

**3. Type consistency:** `Parse` signature `([]model.Event, []model.Deadline, []RowError, error)` is identical in Task 2's definition, Task 4's call, and all tests. `ImportEvents`/`ImportDeadlines` return `(added, skipped int, err error)` consistently across Task 3 and Task 4. `importResponse` JSON keys (`imported_events`, `imported_deadlines`, `skipped_duplicates`, `errors`) match the frontend `ImportResult` fields (Task 5) and the Playwright assertions (Task 7). `ImportPanel` props `{ onImported, onClose }` match between Task 6 and Task 7. `RowError`/`ImportRowError` both expose `row`+`reason`.
