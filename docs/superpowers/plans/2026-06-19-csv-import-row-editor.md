# Per-Row CSV Import Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CSV import a two-step flow — upload a `title,start_date,end_date` CSV, review the parsed rows in an editable table where each row's kind (event/deadline) and per-row fields are set, then batch-create everything.

**Architecture:** A new `importer.ParseRows` parses the CSV into raw `Row`s (title + dates only). A preview endpoint (`POST /api/import/preview`) returns those rows + per-line parse errors; a commit endpoint (`POST /api/import`, JSON) validates finalized events/deadlines and batch-imports them through the unchanged store. The frontend `ImportPanel` becomes a per-row editor; one shared color applies to all deadline rows.

**Tech Stack:** Go + Gin + `encoding/csv` (backend); React 19 + TypeScript + Vite + Tailwind v4 (frontend).

## Global Constraints

- Go module path is `timeline-planner`; run backend commands from `backend/`.
- Frontend is strict TypeScript — **no `any`.** Run frontend commands from `frontend/`. There is **no frontend unit-test runner** — verification is `npm run build` (tsc) + `npm run lint` + Playwright MCP.
- Persistence is CSV via `internal/store`. **Do NOT modify `internal/store` or `store/import.go`** — `ImportEvents`/`ImportDeadlines` and the dedup keys are reused unchanged.
- **Kind is per-row** (event/deadline); one file can mix both; default kind = event.
- Imported events use the CSV `title` as-is (no canonical-title substitution); type is per-row (`leave`/`oncall`/`holiday`/`other`, default `other`).
- **One color for all deadline rows** (shared picker, default `red`); palette: `red, orange, amber, emerald, blue, violet`; invalid/blank → `red`.
- CSV columns matched by header name (case-insensitive, trimmed, order-independent; extras ignored): **required** `title`, `start_date`; **optional** `end_date` (used by event rows; ignored by deadline rows).
- Title/dates are read-only in the editor.
- `ImportResult` JSON shape stays `{imported_events, imported_deadlines, skipped_duplicates, errors}`; commit returns `errors: []`.

---

### Task 1: Backend — `ParseRows` + preview/commit endpoints + routes

**Files:**
- Rewrite: `backend/internal/importer/importer.go`
- Rewrite: `backend/internal/importer/importer_test.go`
- Rewrite: `backend/internal/handler/import.go`
- Rewrite: `backend/internal/handler/import_test.go`
- Modify: `backend/cmd/server/main.go` (import routes)

**Interfaces:**
- Produces (importer):
  ```go
  type Row struct { Title string `json:"title"`; StartDate string `json:"start_date"`; EndDate string `json:"end_date"` }
  func ParseRows(r io.Reader) ([]Row, []RowError, error)
  ```
  `RowError{Row int; Reason string}` is unchanged. The old `Parse` and the event/deadline helpers are removed.
- Produces (handler): `Preview` (`POST /api/import/preview`, multipart `file` → `{rows, errors}`) and `Commit` (`POST /api/import`, JSON `{events:[model.Event…], deadlines:[model.Deadline…]}` → `{imported_events, imported_deadlines, skipped_duplicates, errors}`). Events/deadlines arrive without IDs; the store assigns them.

- [ ] **Step 1: Write the new importer tests**

Replace the entire contents of `backend/internal/importer/importer_test.go` with:

```go
package importer

import (
	"strings"
	"testing"
)

func TestParseRowsValid(t *testing.T) {
	csv := "title,start_date,end_date\n" +
		"Regression,2026-05-25,2026-05-29\n" +
		"Release,2026-08-03,\n" // blank end_date allowed
	rows, rowErrs, err := ParseRows(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("unexpected row errors: %v", rowErrs)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d", len(rows))
	}
	if rows[0] != (Row{Title: "Regression", StartDate: "2026-05-25", EndDate: "2026-05-29"}) {
		t.Errorf("row0 unexpected: %+v", rows[0])
	}
	if rows[1].EndDate != "" {
		t.Errorf("row1 end_date should be blank, got %q", rows[1].EndDate)
	}
}

func TestParseRowsHeaderOrderAndExtraColumns(t *testing.T) {
	csv := "note,end_date,title,start_date\n" +
		"ignored,2026-06-02,Demo,2026-06-01\n"
	rows, rowErrs, err := ParseRows(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("row errs: %v", rowErrs)
	}
	if len(rows) != 1 || rows[0].Title != "Demo" || rows[0].StartDate != "2026-06-01" || rows[0].EndDate != "2026-06-02" {
		t.Fatalf("unexpected: %+v", rows)
	}
}

func TestParseRowsNoEndDateColumn(t *testing.T) {
	csv := "title,start_date\n" +
		"Ship,2026-08-03\n"
	rows, rowErrs, err := ParseRows(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("row errs: %v", rowErrs)
	}
	if len(rows) != 1 || rows[0].EndDate != "" {
		t.Fatalf("unexpected: %+v", rows)
	}
}

func TestParseRowsSkipsBlankRows(t *testing.T) {
	csv := "title,start_date,end_date\n" +
		",,\n" +
		"X,2026-06-01,2026-06-02\n"
	rows, rowErrs, err := ParseRows(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("blank row must not error: %v", rowErrs)
	}
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
}

func TestParseRowsRowErrors(t *testing.T) {
	cases := []struct {
		name string
		row  string
		want string
	}{
		{"missing title", ",2026-06-01,2026-06-02", "title is required"},
		{"bad start", "X,2026-13-40,2026-06-02", "invalid start_date"},
		{"bad end when present", "X,2026-06-01,nope", "invalid end_date"},
	}
	header := "title,start_date,end_date\n"
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows, rowErrs, err := ParseRows(strings.NewReader(header + tc.row + "\n"))
			if err != nil {
				t.Fatalf("unexpected fatal err: %v", err)
			}
			if len(rows) != 0 {
				t.Fatalf("expected no valid rows, got %d", len(rows))
			}
			if len(rowErrs) != 1 || rowErrs[0].Row != 2 {
				t.Fatalf("expected 1 error on line 2, got %+v", rowErrs)
			}
			if !strings.Contains(rowErrs[0].Reason, tc.want) {
				t.Errorf("reason %q does not contain %q", rowErrs[0].Reason, tc.want)
			}
		})
	}
}

func TestParseRowsFatalErrors(t *testing.T) {
	if _, _, err := ParseRows(strings.NewReader("")); err == nil {
		t.Error("expected error for empty file")
	}
	if _, _, err := ParseRows(strings.NewReader("title\nX\n")); err == nil {
		t.Error("expected error for missing start_date header")
	}
	if _, _, err := ParseRows(strings.NewReader("start_date,end_date\n2026-01-01,2026-01-02\n")); err == nil {
		t.Error("expected error for missing title header")
	}
}
```

- [ ] **Step 2: Run importer tests to verify they fail**

Run: `cd backend && go test ./internal/importer/`
Expected: FAIL — build error `undefined: ParseRows` / `undefined: Row`.

- [ ] **Step 3: Rewrite the importer**

Replace the entire contents of `backend/internal/importer/importer.go` with:

```go
// Package importer parses a CSV of raw import rows (title and dates) into Row
// values for the per-row import editor. It performs no persistence, no kind
// assignment, and no duplicate detection (those are the caller's / store's job).
package importer

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
	"time"
)

// RowError describes a single row that failed validation. Row is the 1-based
// CSV line number (the header is line 1, so the first data row is line 2).
type RowError struct {
	Row    int    `json:"row"`
	Reason string `json:"reason"`
}

// Row is one CSV data row: the raw fields the user supplies. The kind and every
// other attribute are chosen later, per row, in the import editor.
type Row struct {
	Title     string `json:"title"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

const dateLayout = "2006-01-02"

// ParseRows reads a CSV with columns title, start_date and optional end_date.
// It returns the valid rows plus a RowError for every rejected row. A non-nil
// error is returned only for a structurally unusable file: unreadable, empty,
// or missing the required "title" or "start_date" header.
func ParseRows(r io.Reader) ([]Row, []RowError, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1 // allow ragged rows; we index by header name
	records, err := reader.ReadAll()
	if err != nil {
		return nil, nil, fmt.Errorf("could not parse CSV: %w", err)
	}
	if len(records) == 0 {
		return nil, nil, fmt.Errorf("file is empty")
	}

	col := map[string]int{}
	for i, name := range records[0] {
		col[strings.ToLower(strings.TrimSpace(name))] = i
	}
	for _, name := range []string{"title", "start_date"} {
		if _, ok := col[name]; !ok {
			return nil, nil, fmt.Errorf("missing required column: %s", name)
		}
	}

	get := func(row []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}

	rows := []Row{}
	rowErrors := []RowError{}
	for i := 1; i < len(records); i++ {
		rec := records[i]
		line := i + 1 // 1-based; header is line 1
		if isBlankRow(rec) {
			continue
		}

		title := get(rec, "title")
		if title == "" {
			rowErrors = append(rowErrors, RowError{Row: line, Reason: "title is required"})
			continue
		}
		start := get(rec, "start_date")
		if !validDate(start) {
			rowErrors = append(rowErrors, RowError{Row: line, Reason: "invalid start_date: expected YYYY-MM-DD"})
			continue
		}
		end := get(rec, "end_date")
		if end != "" && !validDate(end) {
			rowErrors = append(rowErrors, RowError{Row: line, Reason: "invalid end_date: expected YYYY-MM-DD"})
			continue
		}

		rows = append(rows, Row{Title: title, StartDate: start, EndDate: end})
	}
	return rows, rowErrors, nil
}

func validDate(s string) bool {
	if s == "" {
		return false
	}
	_, err := time.Parse(dateLayout, s)
	return err == nil
}

func isBlankRow(row []string) bool {
	for _, c := range row {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}
```

- [ ] **Step 4: Run importer tests to verify they pass**

Run: `cd backend && go test ./internal/importer/`
Expected: PASS — `ok  	timeline-planner/internal/importer`.
(Note: `go build ./...` still fails here — the handler and `main.go` reference the removed `importer.Parse`/`Upload`. The next steps fix them.)

- [ ] **Step 5: Write the new handler tests**

Replace the entire contents of `backend/internal/handler/import_test.go` with:

```go
package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

func newImportRouter(t *testing.T) (*gin.Engine, *store.Store) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s, err := store.New(t.TempDir())
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	r := gin.New()
	imp := NewImport(s)
	r.POST("/api/import/preview", imp.Preview)
	r.POST("/api/import", imp.Commit)
	return r, s
}

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

func postJSON(t *testing.T, r *gin.Engine, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestPreviewHappyPath(t *testing.T) {
	r, _ := newImportRouter(t)
	csv := "title,start_date,end_date\n" +
		"Regression,2026-05-25,2026-05-29\n" +
		"Bad,2026-13-99,2026-05-30\n" // bad start -> error on line 3
	body, ct := multipartCSV(t, csv)
	req := httptest.NewRequest(http.MethodPost, "/api/import/preview", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp previewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Rows) != 1 || resp.Rows[0].Title != "Regression" {
		t.Errorf("rows unexpected: %+v", resp.Rows)
	}
	if len(resp.Errors) != 1 || resp.Errors[0].Row != 3 {
		t.Errorf("expected 1 error on row 3, got %+v", resp.Errors)
	}
}

func TestPreviewMissingFile400(t *testing.T) {
	r, _ := newImportRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/import/preview", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}

func TestPreviewMissingHeader400(t *testing.T) {
	r, _ := newImportRouter(t)
	body, ct := multipartCSV(t, "title\nX\n") // no start_date column
	req := httptest.NewRequest(http.MethodPost, "/api/import/preview", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}

func TestCommitMixedHappyPath(t *testing.T) {
	r, s := newImportRouter(t)
	body := `{
		"events":[{"member_emails":["a@co.com"],"scope":"personal","type":"other","title":"Regression","start_date":"2026-05-25","end_date":"2026-05-29","counts_as_working_day":true}],
		"deadlines":[{"title":"Release","date":"2026-08-03","color":"violet"}]
	}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp commitResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.ImportedEvents != 1 || resp.ImportedDeadlines != 1 {
		t.Errorf("imported events=%d deadlines=%d; want 1,1", resp.ImportedEvents, resp.ImportedDeadlines)
	}
	events, _ := s.GetEvents()
	if len(events) != 1 || events[0].Type != "other" || !events[0].CountsAsWorkingDay || len(events[0].MemberEmails) != 1 {
		t.Errorf("event not stored as posted: %+v", events)
	}
	deadlines, _ := s.GetDeadlines()
	if len(deadlines) != 1 || deadlines[0].Color != "violet" {
		t.Errorf("deadline not stored as posted: %+v", deadlines)
	}
}

func TestCommitTeamScopeEmptiesMembers(t *testing.T) {
	r, s := newImportRouter(t)
	body := `{"events":[{"member_emails":["a@co.com"],"scope":"team","type":"holiday","title":"Offsite","start_date":"2026-06-01","end_date":"2026-06-01","counts_as_working_day":false}],"deadlines":[]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	events, _ := s.GetEvents()
	if len(events) != 1 || events[0].Scope != "team" || len(events[0].MemberEmails) != 0 {
		t.Errorf("team event should have no members: %+v", events)
	}
}

func TestCommitPersonalNoMembers400(t *testing.T) {
	r, _ := newImportRouter(t)
	body := `{"events":[{"member_emails":[],"scope":"personal","type":"other","title":"X","start_date":"2026-06-01","end_date":"2026-06-02","counts_as_working_day":false}],"deadlines":[]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400 (body %s)", rec.Code, rec.Body.String())
	}
}

func TestCommitInvalidType400(t *testing.T) {
	r, _ := newImportRouter(t)
	body := `{"events":[{"member_emails":["a@co.com"],"scope":"personal","type":"bogus","title":"X","start_date":"2026-06-01","end_date":"2026-06-02","counts_as_working_day":false}],"deadlines":[]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}

func TestCommitEndBeforeStart400(t *testing.T) {
	r, _ := newImportRouter(t)
	body := `{"events":[{"member_emails":["a@co.com"],"scope":"personal","type":"other","title":"X","start_date":"2026-06-05","end_date":"2026-06-01","counts_as_working_day":false}],"deadlines":[]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}

func TestCommitDeadlineColorCoerced(t *testing.T) {
	r, s := newImportRouter(t)
	body := `{"events":[],"deadlines":[{"title":"Ship","date":"2026-08-03","color":"chartreuse"}]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	deadlines, _ := s.GetDeadlines()
	if len(deadlines) != 1 || deadlines[0].Color != "red" {
		t.Errorf("invalid color should coerce to red: %+v", deadlines)
	}
}
```

- [ ] **Step 6: Run handler tests to verify they fail**

Run: `cd backend && go test ./internal/handler/`
Expected: FAIL — build error (the package still defines `Upload` calling the removed `importer.Parse`, and the tests reference `Preview`/`Commit`/`previewResponse`/`commitResponse` that don't exist yet).

- [ ] **Step 7: Rewrite the handler**

Replace the entire contents of `backend/internal/handler/import.go` with:

```go
package handler

import (
	"net/http"
	"strings"
	"time"

	"timeline-planner/internal/importer"
	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type Import struct {
	store *store.Store
}

func NewImport(s *store.Store) *Import {
	return &Import{store: s}
}

type previewResponse struct {
	Rows   []importer.Row      `json:"rows"`
	Errors []importer.RowError `json:"errors"`
}

// Preview handles POST /api/import/preview: a multipart form with field "file".
// It parses the CSV into raw rows (title + dates) for the per-row editor.
func (h *Import) Preview(c *gin.Context) {
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

	rows, rowErrors, err := importer.ParseRows(f)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if rows == nil {
		rows = []importer.Row{}
	}
	if rowErrors == nil {
		rowErrors = []importer.RowError{}
	}
	c.JSON(http.StatusOK, previewResponse{Rows: rows, Errors: rowErrors})
}

type commitRequest struct {
	Events    []model.Event    `json:"events"`
	Deadlines []model.Deadline `json:"deadlines"`
}

type commitResponse struct {
	ImportedEvents    int                 `json:"imported_events"`
	ImportedDeadlines int                 `json:"imported_deadlines"`
	SkippedDuplicates int                 `json:"skipped_duplicates"`
	Errors            []importer.RowError `json:"errors"`
}

const dateLayout = "2006-01-02"

var deadlineColors = map[string]bool{
	"red": true, "orange": true, "amber": true,
	"emerald": true, "blue": true, "violet": true,
}

// Commit handles POST /api/import: a JSON body of finalized events and
// deadlines (no IDs). It validates each item, then batch-imports via the store.
func (h *Import) Commit(c *gin.Context) {
	var req commitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	for i := range req.Events {
		if msg := validateEvent(&req.Events[i]); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
	}
	for i := range req.Deadlines {
		if msg := validateDeadline(&req.Deadlines[i]); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
	}

	addedEvents, skippedEvents, err := h.store.ImportEvents(req.Events)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	addedDeadlines, skippedDeadlines, err := h.store.ImportDeadlines(req.Deadlines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, commitResponse{
		ImportedEvents:    addedEvents,
		ImportedDeadlines: addedDeadlines,
		SkippedDuplicates: skippedEvents + skippedDeadlines,
		Errors:            []importer.RowError{},
	})
}

// validateEvent checks and normalizes one event; returns "" if valid, else a
// human-readable reason. Team scope forces an empty member list.
func validateEvent(e *model.Event) string {
	if e.Title == "" {
		return "event title is required"
	}
	if !validDate(e.StartDate) {
		return "event has an invalid start_date"
	}
	if !validDate(e.EndDate) {
		return "event has an invalid end_date"
	}
	if e.EndDate < e.StartDate { // safe: both are validated YYYY-MM-DD
		return "event end_date is before start_date"
	}
	switch e.Scope {
	case model.ScopePersonal:
		if len(e.MemberEmails) == 0 {
			return "personal event requires at least one member"
		}
	case model.ScopeTeam:
		e.MemberEmails = []string{}
	default:
		return "event scope must be \"personal\" or \"team\""
	}
	switch e.Type {
	case model.EventLeave, model.EventOncall, model.EventHoliday, model.EventOther:
		// ok
	default:
		return "event type must be leave, oncall, holiday, or other"
	}
	return ""
}

// validateDeadline checks and normalizes one deadline; returns "" if valid.
// A blank or unknown color is coerced to "red".
func validateDeadline(d *model.Deadline) string {
	if d.Title == "" {
		return "deadline title is required"
	}
	if !validDate(d.Date) {
		return "deadline has an invalid date"
	}
	if !deadlineColors[strings.ToLower(strings.TrimSpace(d.Color))] {
		d.Color = "red"
	}
	return ""
}

func validDate(s string) bool {
	if s == "" {
		return false
	}
	_, err := time.Parse(dateLayout, s)
	return err == nil
}
```

- [ ] **Step 8: Wire the routes**

In `backend/cmd/server/main.go`, change:
```go
		api.POST("/import", handler.NewImport(yamlStore).Upload)
```
to:
```go
		imp := handler.NewImport(yamlStore)
		api.POST("/import/preview", imp.Preview)
		api.POST("/import", imp.Commit)
```

- [ ] **Step 9: Run handler tests to verify they pass**

Run: `cd backend && go test ./internal/handler/`
Expected: PASS — `ok  	timeline-planner/internal/handler`.

- [ ] **Step 10: Build and test the whole backend**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS — all packages compile and pass.

- [ ] **Step 11: Commit**

```bash
git add backend/internal/importer/importer.go backend/internal/importer/importer_test.go backend/internal/handler/import.go backend/internal/handler/import_test.go backend/cmd/server/main.go
git commit -m "feat: CSV import preview + commit endpoints for the per-row editor"
```

---

### Task 2: Frontend — preview/commit API + per-row editor + wiring

**Files:**
- Rewrite: `frontend/src/api/import.ts`
- Rewrite: `frontend/src/components/ImportPanel.tsx`
- Modify: `frontend/src/App.tsx` (pass `members`)

**Interfaces:**
- Consumes: the Task 1 endpoints (`/api/import/preview` multipart; `/api/import` JSON `{events, deadlines}`); `CalendarEvent`, `Deadline`, `EventScope`, `EventType`, `Member`, `ImportResult`, `ImportRowError` from `@/types`.
- Produces:
  ```ts
  // @/api/import
  export interface ImportRow { title: string; start_date: string; end_date: string }
  export interface ImportPreview { rows: ImportRow[]; errors: ImportRowError[] }
  export interface ImportCommit { events: Omit<CalendarEvent,"id">[]; deadlines: Omit<Deadline,"id">[] }
  export function previewCsv(file: File): Promise<ImportPreview>;
  export function commitImport(payload: ImportCommit): Promise<ImportResult>;
  ```
  `ImportPanel` gains a `members: Member[]` prop.

- [ ] **Step 1: Rewrite the API wrapper**

Replace the entire contents of `frontend/src/api/import.ts` with:

```ts
import type { CalendarEvent, Deadline, ImportResult, ImportRowError } from "@/types";

export interface ImportRow {
  title: string;
  start_date: string;
  end_date: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  errors: ImportRowError[];
}

export interface ImportCommit {
  events: Omit<CalendarEvent, "id">[];
  deadlines: Omit<Deadline, "id">[];
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // response had no JSON body; keep the fallback
  }
  return fallback;
}

export async function previewCsv(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/import/preview", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Failed to read CSV"));
  }
  return (await res.json()) as ImportPreview;
}

export async function commitImport(payload: ImportCommit): Promise<ImportResult> {
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Failed to import"));
  }
  return (await res.json()) as ImportResult;
}
```

- [ ] **Step 2: Rebuild the ImportPanel**

Replace the entire contents of `frontend/src/components/ImportPanel.tsx` with:

```tsx
import { useRef, useState } from "react";
import type {
  CalendarEvent,
  Deadline,
  EventScope,
  EventType,
  ImportResult,
  ImportRowError,
  Member,
} from "@/types";
import { previewCsv, commitImport, type ImportRow } from "@/api/import";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileDown, FileText, User, Users } from "lucide-react";

interface ImportPanelProps {
  members: Member[];
  onImported: () => void;
  onClose: () => void;
}

type RowKind = "event" | "deadline";

interface RowConfig {
  kind: RowKind;
  scope: EventScope;
  member_emails: string[];
  type: EventType;
  counts_as_working_day: boolean;
}

interface EditRow {
  data: ImportRow;
  cfg: RowConfig;
}

const eventTypes: { value: EventType; label: string }[] = [
  { value: "leave", label: "Leave" },
  { value: "oncall", label: "Oncall" },
  { value: "holiday", label: "Holiday" },
  { value: "other", label: "Other" },
];

const colorOptions = [
  { value: "red", className: "bg-red-500" },
  { value: "orange", className: "bg-orange-500" },
  { value: "amber", className: "bg-amber-500" },
  { value: "emerald", className: "bg-emerald-500" },
  { value: "blue", className: "bg-blue-500" },
  { value: "violet", className: "bg-violet-500" },
];

const SAMPLE_CSV =
  "title,start_date,end_date\n" +
  "Regression,2026-05-25,2026-05-29\n" +
  "Release 1%,2026-08-03,\n";

function defaultConfig(): RowConfig {
  return {
    kind: "event",
    scope: "personal",
    member_emails: [],
    type: "other",
    counts_as_working_day: false,
  };
}

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// A row is importable iff it is a deadline, or an event with a valid end date
// (>= start) and either team scope or at least one member selected.
function rowValid(row: EditRow): boolean {
  if (row.cfg.kind === "deadline") return true;
  if (!row.data.end_date || row.data.end_date < row.data.start_date) return false;
  return row.cfg.scope === "team" || row.cfg.member_emails.length > 0;
}

function rowHint(row: EditRow): string | null {
  if (row.cfg.kind === "deadline") return null;
  if (!row.data.end_date) return "Needs an end date to be an event — set this row to Deadline.";
  if (row.data.end_date < row.data.start_date) return "End date is before start date.";
  if (row.cfg.scope === "personal" && row.cfg.member_emails.length === 0)
    return "Select at least one member.";
  return null;
}

export function ImportPanel({ members, onImported, onClose }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ImportRowError[]>([]);
  const [deadlineColor, setDeadlineColor] = useState("red");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(f: File | null) {
    setFile(f);
    setRows([]);
    setParseErrors([]);
    setResult(null);
    setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const preview = await previewCsv(f);
      setRows(preview.rows.map((data) => ({ data, cfg: defaultConfig() })));
      setParseErrors(preview.errors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read CSV");
    } finally {
      setBusy(false);
    }
  }

  function updateRow(i: number, patch: Partial<RowConfig>) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, cfg: { ...r.cfg, ...patch } } : r)),
    );
  }

  function toggleRowMember(i: number, email: string) {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        const has = r.cfg.member_emails.includes(email);
        const member_emails = has
          ? r.cfg.member_emails.filter((e) => e !== email)
          : [...r.cfg.member_emails, email];
        return { ...r, cfg: { ...r.cfg, member_emails } };
      }),
    );
  }

  const hasDeadlineRows = rows.some((r) => r.cfg.kind === "deadline");
  const allValid = rows.length > 0 && rows.every(rowValid);
  const canImport = allValid && !busy;

  async function handleImport() {
    if (!canImport) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const events: Omit<CalendarEvent, "id">[] = [];
    const deadlines: Omit<Deadline, "id">[] = [];
    for (const r of rows) {
      if (r.cfg.kind === "deadline") {
        deadlines.push({ title: r.data.title, date: r.data.start_date, color: deadlineColor });
      } else {
        events.push({
          member_emails: r.cfg.scope === "team" ? [] : r.cfg.member_emails,
          scope: r.cfg.scope,
          type: r.cfg.type,
          title: r.data.title,
          start_date: r.data.start_date,
          end_date: r.data.end_date,
          counts_as_working_day: r.cfg.counts_as_working_day,
        });
      }
    }
    try {
      const res = await commitImport({ events, deadlines });
      setResult(res);
      if (res.imported_events + res.imported_deadlines > 0) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" style={{ maxWidth: 560 }}>
        <SheetHeader>
          <SheetTitle>Import CSV</SheetTitle>
          <SheetDescription>
            Upload a CSV (columns: title, start_date, end_date), then set up each row below.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadSample} className="flex-1">
              <FileDown />
              Sample CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 justify-start"
              onClick={() => inputRef.current?.click()}
            >
              <FileText />
              {file ? file.name : "Choose CSV file…"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {hasDeadlineRows && (
            <div className="rounded-lg border p-2.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Deadline color (all deadline rows)
              </Label>
              <div className="flex gap-2 mt-1.5">
                {colorOptions.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setDeadlineColor(c.value)}
                    className={`w-6 h-6 rounded-full ${c.className} transition-all ${deadlineColor === c.value ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-60 hover:opacity-100"}`}
                  />
                ))}
              </div>
            </div>
          )}

          {rows.map((r, i) => {
            const hint = rowHint(r);
            return (
              <div key={i} className="rounded-xl border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium break-words">{r.data.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.data.start_date}{r.data.end_date ? ` → ${r.data.end_date}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-1 p-0.5 bg-muted rounded-lg shrink-0">
                    <button
                      type="button"
                      className={`text-[12px] font-medium px-2 py-1 rounded-md transition-colors ${r.cfg.kind === "event" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => updateRow(i, { kind: "event" })}
                    >
                      Event
                    </button>
                    <button
                      type="button"
                      className={`text-[12px] font-medium px-2 py-1 rounded-md transition-colors ${r.cfg.kind === "deadline" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => updateRow(i, { kind: "deadline" })}
                    >
                      Deadline
                    </button>
                  </div>
                </div>

                {r.cfg.kind === "event" ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
                        <button
                          type="button"
                          className={`flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-md transition-colors ${r.cfg.scope === "personal" ? "bg-orange-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => updateRow(i, { scope: "personal" })}
                        >
                          <User className="w-3 h-3" />
                          Personal
                        </button>
                        <button
                          type="button"
                          className={`flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-md transition-colors ${r.cfg.scope === "team" ? "bg-blue-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => updateRow(i, { scope: "team" })}
                        >
                          <Users className="w-3 h-3" />
                          Team
                        </button>
                      </div>
                      <Select value={r.cfg.type} onValueChange={(val) => updateRow(i, { type: val as EventType })}>
                        <SelectTrigger className="h-7 text-[12px] w-28">
                          <SelectValue>
                            {(value) => eventTypes.find((t) => t.value === value)?.label ?? String(value ?? "")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {eventTypes.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-indigo-600"
                          checked={r.cfg.counts_as_working_day}
                          onChange={(e) => updateRow(i, { counts_as_working_day: e.target.checked })}
                        />
                        working day
                      </label>
                    </div>

                    {r.cfg.scope === "personal" && (
                      <div className="flex flex-wrap gap-1.5">
                        {members.map((m) => {
                          const selected = r.cfg.member_emails.includes(m.email);
                          return (
                            <button
                              key={m.email}
                              type="button"
                              onClick={() => toggleRowMember(i, m.email)}
                              className={`text-[12px] font-medium px-2.5 py-1 rounded-full border transition-colors ${selected ? "bg-orange-500 text-white border-orange-500" : "bg-background text-muted-foreground border-border hover:border-orange-300 hover:text-foreground"}`}
                            >
                              {m.name}
                            </button>
                          );
                        })}
                        {members.length === 0 && (
                          <span className="text-[11px] text-muted-foreground">No members — add members first.</span>
                        )}
                      </div>
                    )}

                    {hint && <p className="text-[11px] text-destructive">{hint}</p>}
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Deadline on {r.data.start_date}; end date ignored. Color set above.
                  </p>
                )}
              </div>
            );
          })}

          {parseErrors.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {parseErrors.length} row{parseErrors.length === 1 ? "" : "s"} skipped
              </p>
              {parseErrors.map((e) => (
                <div key={e.row} className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">
                  Line {e.row}: {e.reason}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-emerald-500/10 text-emerald-700 text-[12px] px-3 py-2 rounded-lg">
              Imported {result.imported_events} event{result.imported_events === 1 ? "" : "s"},{" "}
              {result.imported_deadlines} deadline{result.imported_deadlines === 1 ? "" : "s"}
              {result.skipped_duplicates > 0
                ? ` · ${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? "" : "s"} skipped`
                : ""}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button onClick={handleImport} disabled={!canImport} className="w-full">
            <Upload />
            {busy ? "Working…" : rows.length > 0 ? `Import ${rows.length} row${rows.length === 1 ? "" : "s"}` : "Import"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Pass `members` to `ImportPanel`**

In `frontend/src/App.tsx`, change:
```tsx
      {panel === "import" && (
        <ImportPanel
          onImported={() => {
```
to:
```tsx
      {panel === "import" && (
        <ImportPanel
          members={members}
          onImported={() => {
```

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no tsc errors, no ESLint errors. (Behavior is verified in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/import.ts frontend/src/components/ImportPanel.tsx frontend/src/App.tsx
git commit -m "feat: per-row CSV import editor (preview, edit, commit)"
```

---

### Task 3: End-to-end verification (controller-run)

No code unless a defect is found. Verify the whole feature in a real browser and confirm both suites are green. (The controller runs this; if a defect appears, dispatch a fix and re-verify.)

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS — all packages.

- [ ] **Step 2: Frontend build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no errors.

- [ ] **Step 3: Start both servers (isolated data dir)**

Backend (background, isolated temp `DATA_DIR` so real data is untouched):
`DATA_DIR="$(mktemp -d)" PORT=8080 go -C backend run ./cmd/server`
Frontend (background): `npm --prefix frontend run dev`
Expected: backend logs `Server starting on :8080` with `POST /api/import/preview` and `POST /api/import` in the route list; Vite serves `http://localhost:5173`.

- [ ] **Step 4: Seed two members**

Via the running UI or `curl`, add two members (e.g. Priya, Sam) so per-row member selection is meaningful. Start from the empty temp dir for crisp assertions.

- [ ] **Step 5: Verify the per-row editor with Playwright MCP**

Prepare a mixed CSV, e.g.:
```
title,start_date,end_date
Regression,2026-06-22,2026-06-26
Release 1%,2026-07-15,
Bad Row,2026-06-30,2026-06-25
```
Then, using the Playwright MCP:
1. `browser_navigate` to `http://localhost:5173`; open the **Import** panel.
2. Choose the CSV file. Confirm two editable rows appear (Regression, Release 1%) and a "1 row skipped — Line 4: end_date is before start_date" notice. (`Bad Row` has end < start.)
3. Confirm **Import is disabled** initially (row 1 defaults to a personal event with no member).
4. Row 1 (Regression): keep Event, Personal, select **Priya**, set type to a non-default value, tick **working day**.
5. Row 2 (Release 1%): switch kind to **Deadline**. Confirm a **Deadline color** picker appears; pick a non-default color. (Its end date is blank — as an event it would be invalid; as a deadline it's fine.)
6. Confirm **Import is now enabled**; click it.
7. Confirm the success summary (`Imported 1 event, 1 deadline`), then verify in the Events panel that Regression has the CSV title, Priya, the chosen type, and the "working day" badge; and that the Release deadline marker renders in the chosen color on the Gantt.

- [ ] **Step 6: Verify a team row needs no member**

Re-open Import, upload a one-row CSV, switch the row to Event → **Team**; confirm Import enables with no member selected and the created event has team scope.

- [ ] **Step 7: Stop the verification servers**

Stop the two background servers (kill the listeners on ports 8080 and 5173) and remove the temp data dir.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §2.1 kind per-row, mix allowed, default event | Task 2 (`RowConfig.kind`, per-row toggle, `defaultConfig`) |
| §2.2 per-row scope/members/type/working-day | Task 2 (row card controls) |
| §2.3 one shared deadline color | Task 2 (single `deadlineColor` picker) |
| §2.4 title/dates read-only | Task 2 (rendered, not editable) |
| §2.5 title used as-is, no canonical substitution | Task 1 commit stores posted title; Task 2 sends CSV title |
| §4 CSV columns (title/start required, end optional) | Task 1 `ParseRows` (`TestParseRowsNoEndDateColumn`, fatal-header tests) |
| §5.1 preview endpoint | Task 1 `Preview` + tests |
| §5.2 commit endpoint (JSON, errors:[]) | Task 1 `Commit` + tests |
| §6.1 `ParseRows` replaces `Parse` | Task 1 Step 3 |
| §6.2 handler Preview/Commit + validation | Task 1 Steps 5–7 |
| §6.3 routes | Task 1 Step 8 |
| §6.4 store unchanged | No task touches `internal/store` |
| §7 validation (preview/commit/frontend) | Task 1 (`ParseRows`, `validateEvent`/`validateDeadline`, 400 tests); Task 2 (`rowValid`/`rowHint`, disabled button) |
| §8.1 api previewCsv/commitImport + types | Task 2 Step 1 |
| §8.2 ImportPanel per-row editor | Task 2 Step 2 |
| §8.3 App passes members | Task 2 Step 3 |
| §9 backend tests + FE build/lint + Playwright | Tasks 1 & 3 |
| §11 replaces old format; store untouched; old Parse removed | Task 1 (importer rewrite) |
| §12 non-goals (no title/date edit, one color, no bulk, default event, store unchanged) | Honored across Tasks 1–2 |

No gaps.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step shows complete file contents or exact before/after; every command lists expected output. Frontend gates on `npm run build` + `npm run lint` (no unit runner exists, per Global Constraints); behavior is verified in Task 3.

**3. Type consistency:** `ParseRows`/`Row`/`RowError` (Task 1) are referenced identically by the Task 1 handler and tests. `previewResponse{Rows []importer.Row, Errors []importer.RowError}` and `commitResponse{...}` are defined in `handler/import.go` (Task 1 Step 7) and used by the Task 1 tests (Step 5). The JSON contract — preview returns `{rows, errors}`; commit accepts `{events, deadlines}` and returns `{imported_events, imported_deadlines, skipped_duplicates, errors}` — matches `previewCsv`/`commitImport` in `@/api/import` (Task 2 Step 1). `ImportRow`/`ImportPreview`/`ImportCommit` are defined in `@/api/import` and consumed by `ImportPanel` (Task 2 Step 2). `CalendarEvent`/`Deadline`/`EventScope`/`EventType`/`Member`/`ImportResult`/`ImportRowError` come from `@/types` (already present on master). `validDate`/`dateLayout`/`deadlineColors`/`validateEvent`/`validateDeadline` are newly defined in `handler/import.go` (no prior declaration in the handler package — verified).
