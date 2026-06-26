# Per-calendar "Counts as working day" Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Google Calendar source an explicit "Counts as working day" toggle (default off) that drives the synced events' working-day flag, replacing the hardcoded type-based derivation.

**Architecture:** Add a `CountsAsWorkingDay bool` field to `model.CalendarSource`, persist it as an appended CSV column (backward-compatible, default false), use it directly in `gcal.BuildEvents`, and expose a checkbox per source row in the Settings page.

**Tech Stack:** Go (Gin) backend with CSV-file persistence; React 19 + TypeScript (strict) + Tailwind v4 frontend.

## Global Constraints

- Frontend is strict TypeScript — **no `any`**. Verify with `npm run build` (its project-reference tsconfig enables `noUncheckedIndexedAccess`), not just `tsc --noEmit`.
- Data files are CSV. New columns are **appended** and read behind a length guard so older files keep working (lazy migration: rewritten on next save).
- Event *type* still drives title and hatch color. Only the working-day flag becomes user-controlled.
- Default for the new flag is `false` everywhere (new sources and legacy rows).
- Run backend tests with `go test ./...` from `backend/`.

---

### Task 1: Backend — model field + store CSV column

**Files:**
- Modify: `backend/internal/model/calendar_source.go`
- Modify: `backend/internal/store/calendar_sources.go`
- Test: `backend/internal/store/calendar_sources_test.go`

**Interfaces:**
- Consumes: nothing new.
- Produces: `model.CalendarSource.CountsAsWorkingDay bool` (json `counts_as_working_day`), persisted as the 6th CSV column. `parseCalendarSourceRow([]string) model.CalendarSource` defaults the flag to `false` for rows with fewer than 6 columns.

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/store/calendar_sources_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/store/ -run 'CalendarSourceWorkingDay|ParseCalendarSourceRowLegacy' -v`
Expected: FAIL — compile error (`CountsAsWorkingDay` unknown field) or assertion failure.

- [ ] **Step 3: Add the model field**

In `backend/internal/model/calendar_source.go`, add the field to the struct (after `EventType`):

```go
type CalendarSource struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	URL                string    `json:"url"`
	EventType          EventType `json:"event_type"`
	CountsAsWorkingDay bool      `json:"counts_as_working_day"`
	LastSyncedAt       string    `json:"last_synced_at"`
}
```

- [ ] **Step 4: Append the CSV column in the store**

In `backend/internal/store/calendar_sources.go`:

Update the imports to add `strconv` and `strings`:

```go
import (
	"fmt"
	"strconv"
	"strings"

	"timeline-planner/internal/model"
)
```

Append the column to the header (keep `last_synced_at` at index 4 for backward compatibility):

```go
var calendarSourcesHeader = []string{"id", "name", "url", "event_type", "last_synced_at", "counts_as_working_day"}
```

Read the new column behind a length guard in `parseCalendarSourceRow`:

```go
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
	if len(row) >= 6 {
		src.CountsAsWorkingDay = strings.EqualFold(strings.TrimSpace(row[5]), "true")
	}
	return src
}
```

Write the new column in `calendarSourceToRow`:

```go
func calendarSourceToRow(src model.CalendarSource) []string {
	return []string{src.ID, src.Name, src.URL, string(src.EventType), src.LastSyncedAt, strconv.FormatBool(src.CountsAsWorkingDay)}
}
```

Leave the `len(row) < 4` skip guard in `GetCalendarSources` unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && go test ./internal/store/ -v`
Expected: PASS — including the existing `TestCalendarSourceCRUD` and the two new tests.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/model/calendar_source.go backend/internal/store/calendar_sources.go backend/internal/store/calendar_sources_test.go
git commit -m "feat(store): add counts_as_working_day to calendar sources"
```

---

### Task 2: Backend — sync propagates the source flag

**Files:**
- Modify: `backend/internal/gcal/sync.go`
- Test: `backend/internal/gcal/sync_test.go`

**Interfaces:**
- Consumes: `model.CalendarSource.CountsAsWorkingDay` (Task 1).
- Produces: `BuildEvents` sets each event's `CountsAsWorkingDay` to `src.CountsAsWorkingDay`. The `countsAsWorkingDay(model.EventType) bool` helper is removed.

- [ ] **Step 1: Update the existing tests to assert the new behavior**

In `backend/internal/gcal/sync_test.go`:

Change the `src` line in `TestBuildEventsMatchesAndSkips` (was `EventType: model.EventOncall`) to set the flag explicitly:

```go
	src := model.CalendarSource{ID: "src1", Name: "POS On-call", URL: "x", EventType: model.EventOncall, CountsAsWorkingDay: true}
```

Change its working-day assertion block (currently the `if e.Type != model.EventOncall || !e.CountsAsWorkingDay {` block) to:

```go
	if e.Type != model.EventOncall || !e.CountsAsWorkingDay {
		t.Errorf("working day should follow the source flag (true here): %+v", e)
	}
```

In `TestBuildEventsOtherTypeUsesSourceName`, the `src` keeps the default (`CountsAsWorkingDay` omitted = false). Replace its working-day assertion block (currently `if e.CountsAsWorkingDay != true {`) with:

```go
		if e.CountsAsWorkingDay {
			t.Errorf("working day should follow the source flag (false here), got true")
		}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/gcal/ -run TestBuildEvents -v`
Expected: FAIL — `TestBuildEventsMatchesAndSkips` (src now sets the flag but `BuildEvents` still derives from type, which also happens to be true, so this may pass) and `TestBuildEventsOtherTypeUsesSourceName` FAILS because `BuildEvents` still derives `other` → true while the test now expects false.

- [ ] **Step 3: Use the source flag and remove the helper**

In `backend/internal/gcal/sync.go`, delete the `countsAsWorkingDay` helper entirely (the comment block and function on the lines:

```go
// countsAsWorkingDay derives the working-day flag from an event type: leave and
// holiday do not count; oncall and anything else do.
func countsAsWorkingDay(t model.EventType) bool {
	return t != model.EventLeave && t != model.EventHoliday
}
```

).

In `BuildEvents`, remove the local `cwd := countsAsWorkingDay(src.EventType)` line and set the event field directly:

```go
	out = append(out, model.Event{
		MemberEmails:       []string{email},
		Scope:              model.ScopePersonal,
		Type:               src.EventType,
		Title:              title,
		StartDate:          r.StartDate,
		EndDate:            r.EndDate,
		CountsAsWorkingDay: src.CountsAsWorkingDay,
		Source:             model.SourceGoogle,
		SourceID:           src.ID,
		ExternalUID:        r.UID,
	})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/gcal/ -v`
Expected: PASS — both BuildEvents tests now reflect the source flag.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go test ./...`
Expected: PASS — all packages, confirming nothing else referenced the removed helper.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/gcal/sync.go backend/internal/gcal/sync_test.go
git commit -m "feat(gcal): working-day flag follows the calendar source setting"
```

---

### Task 3: Frontend — type + Settings checkbox

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/SettingsPage.tsx`
- Verify (no edit expected): `frontend/src/api/calendarSources.ts`

**Interfaces:**
- Consumes: backend `counts_as_working_day` field on `CalendarSource` JSON (Tasks 1-2).
- Produces: `CalendarSource.counts_as_working_day: boolean` in the TS types; a checkbox in each Settings source row that round-trips the field through create/update.

- [ ] **Step 1: Add the field to the TS type**

In `frontend/src/types/index.ts`, add `counts_as_working_day` to `CalendarSource` (between `event_type` and `last_synced_at`):

```ts
export interface CalendarSource {
  id: string;
  name: string;
  url: string;
  event_type: EventType;
  counts_as_working_day: boolean;
  last_synced_at?: string;
}
```

- [ ] **Step 2: Thread the field through `SettingsPage.tsx`**

In `frontend/src/components/SettingsPage.tsx`:

Add the field to `DraftRow` (after `event_type`):

```ts
interface DraftRow {
  id?: string;
  _clientId?: string;   // stable client-side key for unsaved rows
  name: string;
  url: string;
  event_type: EventType;
  counts_as_working_day: boolean;
  last_synced_at?: string;
}
```

Map it in `toDraft`:

```ts
function toDraft(src: CalendarSource): DraftRow {
  return {
    id: src.id,
    name: src.name,
    url: src.url,
    event_type: src.event_type,
    counts_as_working_day: src.counts_as_working_day,
    last_synced_at: src.last_synced_at,
  };
}
```

Default it to `false` in `addRow`:

```ts
  function addRow() {
    setRows((prev) => [
      ...prev,
      { _clientId: `new-${clientIdSeq.current++}`, name: "", url: "", event_type: "oncall", counts_as_working_day: false },
    ]);
  }
```

Include it in both `saveRow` payloads. The update branch:

```ts
        const saved = await updateCalendarSource(row.id, {
          id: row.id,
          name: row.name,
          url: row.url,
          event_type: row.event_type,
          counts_as_working_day: row.counts_as_working_day,
          last_synced_at: row.last_synced_at,
        });
```

The create branch:

```ts
        const saved = await createCalendarSource({
          name: row.name,
          url: row.url,
          event_type: row.event_type,
          counts_as_working_day: row.counts_as_working_day,
        });
```

Add the checkbox to the row, between the Calendar URL block and the footer `<div className="flex items-center justify-between">`:

```tsx
            <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-indigo-600"
                checked={row.counts_as_working_day}
                onChange={(e) => updateRow(i, { counts_as_working_day: e.target.checked })}
              />
              <span className="font-medium">Counts as a working day</span>
            </label>
```

- [ ] **Step 3: Confirm the API wrapper needs no change**

Read `frontend/src/api/calendarSources.ts`. `createCalendarSource` takes `Omit<CalendarSource, "id" | "last_synced_at">` and `updateCalendarSource` takes `CalendarSource`; both `JSON.stringify` the whole object, so the new field forwards automatically. No edit expected — the type change makes the create call require the field, which Step 2 supplies.

- [ ] **Step 4: Build and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no TS errors (the required `counts_as_working_day` is supplied everywhere a `CalendarSource` is constructed), no lint errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/components/SettingsPage.tsx
git commit -m "feat(frontend): per-calendar working-day toggle in Settings"
```

---

## Final integration verification (controller, after all tasks)

- `cd backend && go test ./...` — all green.
- `cd frontend && npm run build && npm run lint` — clean.
- Playwright against an isolated stack: in Settings, tick "Counts as a working day" on a source, Save, Sync now; confirm that source's events on the Gantt switch from the red non-working band to the working-day hatch band and show the "working day" badge in the Events sidebar; untick + re-sync flips them back.

## Self-Review

- **Spec coverage:** model field → Task 1; CSV column + lazy migration → Task 1; `BuildEvents` uses flag + helper removed → Task 2; TS type → Task 3; SettingsPage checkbox + payloads → Task 3; API wrapper (no change) → Task 3 Step 3; behavior/side-effects covered by final Playwright check.
- **Placeholders:** none — every step shows concrete code/commands.
- **Type consistency:** `CountsAsWorkingDay` (Go) / `counts_as_working_day` (json/TS) used consistently; CSV column appended at index 5 with `last_synced_at` kept at index 4 across header/parse/write.
