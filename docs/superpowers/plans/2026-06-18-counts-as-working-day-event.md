# "Counts as a Working Day" Event Flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-event `counts_as_working_day` flag so a marked event no longer blocks task scheduling (tasks flow through its dates) and renders on the Gantt as a diagonal-hatch band.

**Architecture:** A boolean field rides on the existing `Event` model (Go) / `CalendarEvent` (TS) and persists as a new trailing `events.csv` column (back-compatible). The only behavioral change is in `GanttChart.tsx`'s `skipDaysMap`, which now skips events that count as working days. A shared hatch helper restyles those events in the three event renderers. The CSV importer gains an optional column.

**Tech Stack:** Go + Gin + `encoding/csv` (backend); React 19 + TypeScript + Vite + Tailwind v4 (frontend).

## Global Constraints

- Go module path is `timeline-planner`; run backend commands from `backend/`.
- Frontend uses **strict TypeScript — no `any`.** Run frontend commands from `frontend/`. There is **no frontend unit-test runner** — frontend verification is `npm run build` (tsc) + `npm run lint` + Playwright MCP.
- Persistence is **CSV files** via `internal/store` (single `sync.RWMutex`, read-modify-write CRUD).
- **Jira stays read-only.** Members are keyed by email; member emails are pipe (`|`) delimited in one CSV cell.
- New field JSON/CSV name is exactly **`counts_as_working_day`**, type boolean, **default `false`** (preserves today's behavior: all events block).
- Semantics: when `true`, the event's dates are NOT added to a member's `skipDays`, so task bars flow through; the event still renders, as a **diagonal-hatch** variant of its type color. Weekends remain always non-working.
- Import dedup identity is unchanged — the flag is NOT part of an event's dedup key (`store/import.go` is not modified).

---

### Task 1: Backend — `Event` field + `events.csv` persistence (back-compatible)

**Files:**
- Modify: `backend/internal/model/event.go` (add field)
- Modify: `backend/internal/store/events.go` (header, `parseEventRow`, `eventToRow`, `strconv` import)
- Test: `backend/internal/store/events_workingday_test.go` (create)

**Interfaces:**
- Produces: `model.Event.CountsAsWorkingDay bool` (`json:"counts_as_working_day"`). The store round-trips it as a trailing `events.csv` column `counts_as_working_day` (`"true"`/`"false"`); rows missing the column parse as `false`.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/store/events_workingday_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/store/`
Expected: FAIL — build error `unknown field 'CountsAsWorkingDay' in struct literal of type model.Event`.

- [ ] **Step 3: Add the model field**

In `backend/internal/model/event.go`, change the `Event` struct:

```go
type Event struct {
	ID           string     `json:"id"`
	MemberEmails []string   `json:"member_emails"`
	Scope        EventScope `json:"scope"`
	Type         EventType  `json:"type"`
	Title        string     `json:"title"`
	StartDate    string     `json:"start_date"`
	EndDate      string     `json:"end_date"`
}
```
to:
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
}
```

- [ ] **Step 4: Persist the field in the store**

In `backend/internal/store/events.go`:

Add `"strconv"` to the import block:
```go
import (
	"crypto/rand"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"timeline-planner/internal/model"
)
```

Change the header:
```go
var eventsHeader = []string{"id", "member_emails", "scope", "type", "title", "start_date", "end_date"}
```
to:
```go
var eventsHeader = []string{"id", "member_emails", "scope", "type", "title", "start_date", "end_date", "counts_as_working_day"}
```

Change `parseEventRow`:
```go
func parseEventRow(row []string) model.Event {
	return model.Event{
		ID:           row[0],
		MemberEmails: parseEmails(row[1]),
		Scope:        model.EventScope(row[2]),
		Type:         model.EventType(row[3]),
		Title:        row[4],
		StartDate:    row[5],
		EndDate:      row[6],
	}
}
```
to:
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
	return e
}
```

Change `eventToRow`:
```go
func eventToRow(e model.Event) []string {
	return []string{e.ID, joinEmails(e.MemberEmails), string(e.Scope), string(e.Type), e.Title, e.StartDate, e.EndDate}
}
```
to:
```go
func eventToRow(e model.Event) []string {
	return []string{e.ID, joinEmails(e.MemberEmails), string(e.Scope), string(e.Type), e.Title, e.StartDate, e.EndDate, strconv.FormatBool(e.CountsAsWorkingDay)}
}
```

(The `GetEvents` `len(row) < 7` guard is unchanged — legacy rows still load, and `parseEventRow` defaults the flag to `false` when the 8th column is absent.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./internal/store/`
Expected: PASS — `ok  	timeline-planner/internal/store`.

- [ ] **Step 6: Build the whole backend**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS — all packages compile and pass.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/model/event.go backend/internal/store/events.go backend/internal/store/events_workingday_test.go
git commit -m "feat: persist counts_as_working_day on events (back-compatible CSV)"
```

---

### Task 2: Backend — CSV importer support for `counts_as_working_day`

**Files:**
- Modify: `backend/internal/importer/importer.go` (`parseEvent` reads the column)
- Test: `backend/internal/importer/importer_test.go` (add cases)

**Interfaces:**
- Consumes: `model.Event.CountsAsWorkingDay` (Task 1).
- Produces: event rows with a `counts_as_working_day` cell of `true`/`1`/`yes` (case-insensitive) set the flag; blank/anything else → `false`. Deadline rows ignore the column. The event dedup key in `store/import.go` is intentionally NOT changed.

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/importer/importer_test.go`:

```go
func TestParseEventCountsAsWorkingDay(t *testing.T) {
	csv := "event_type,title,start_date,end_date,member_emails,scope,type,counts_as_working_day\n" +
		"event,A,2026-06-01,2026-06-02,a@co.com,personal,other,true\n" +
		"event,B,2026-06-03,2026-06-04,a@co.com,personal,other,YES\n" +
		"event,C,2026-06-05,2026-06-06,a@co.com,personal,other,1\n" +
		"event,D,2026-06-07,2026-06-08,a@co.com,personal,other,false\n" +
		"event,E,2026-06-09,2026-06-10,a@co.com,personal,other,\n"
	events, _, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("unexpected row errors: %v", rowErrs)
	}
	if len(events) != 5 {
		t.Fatalf("want 5 events, got %d", len(events))
	}
	want := map[string]bool{"A": true, "B": true, "C": true, "D": false, "E": false}
	for _, e := range events {
		if e.CountsAsWorkingDay != want[e.Title] {
			t.Errorf("event %s: CountsAsWorkingDay=%v, want %v", e.Title, e.CountsAsWorkingDay, want[e.Title])
		}
	}
}

func TestParseDeadlineIgnoresCountsAsWorkingDay(t *testing.T) {
	csv := "event_type,title,start_date,counts_as_working_day\n" +
		"deadline,Ship,2026-08-03,true\n"
	_, deadlines, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("unexpected row errors: %v", rowErrs)
	}
	if len(deadlines) != 1 {
		t.Fatalf("want 1 deadline, got %d", len(deadlines))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/importer/ -run TestParseEventCountsAsWorkingDay`
Expected: FAIL — events A/B/C report `CountsAsWorkingDay=false, want true` (the parser doesn't read the column yet).

- [ ] **Step 3: Read the column in `parseEvent`**

In `backend/internal/importer/importer.go`, in `parseEvent`, change the trailing return block:
```go
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
```
to:
```go
	emails := parseEmails(get(row, "member_emails"))
	if scope == model.ScopePersonal && len(emails) == 0 {
		return model.Event{}, "member_emails is required for personal events"
	}

	cwd := strings.ToLower(get(row, "counts_as_working_day"))
	countsWorking := cwd == "true" || cwd == "1" || cwd == "yes"

	return model.Event{
		MemberEmails:       emails,
		Scope:              scope,
		Type:               etype,
		Title:              title,
		StartDate:          start,
		EndDate:            end,
		CountsAsWorkingDay: countsWorking,
	}, ""
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/importer/`
Expected: PASS — `ok  	timeline-planner/internal/importer`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/importer/importer.go backend/internal/importer/importer_test.go
git commit -m "feat: import counts_as_working_day column for event rows"
```

---

### Task 3: Frontend — type field + scheduling change (skipDaysMap) + team-event plumbing

**Files:**
- Modify: `frontend/src/types/index.ts` (`CalendarEvent` field)
- Modify: `frontend/src/components/gantt/GanttChart.tsx` (`TeamEvent` interface, `splitEvents`, `skipDaysMap`)

**Interfaces:**
- Consumes: backend JSON `counts_as_working_day` (Tasks 1–2).
- Produces: `CalendarEvent.counts_as_working_day: boolean`; GanttChart's local `TeamEvent` carries the flag; `skipDaysMap` excludes events whose flag is `true`. Later tasks (4) rely on `TeamEvent.counts_as_working_day` being present on the `team` array passed to the renderers.

- [ ] **Step 1: Add the type field**

In `frontend/src/types/index.ts`, change:
```ts
export interface CalendarEvent {
  id: string;
  member_emails: string[];
  scope: EventScope;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}
```
to:
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
}
```

- [ ] **Step 2: Carry the flag onto team events**

In `frontend/src/components/gantt/GanttChart.tsx`, change the `TeamEvent` interface:
```ts
interface TeamEvent {
  key: string;
  type: CalendarEvent["type"];
  title: string;
  start_date: string;
  end_date: string;
}
```
to:
```ts
interface TeamEvent {
  key: string;
  type: CalendarEvent["type"];
  title: string;
  start_date: string;
  end_date: string;
  counts_as_working_day: boolean;
}
```

And in `splitEvents`, change the team push:
```ts
      team.push({ key: ev.id, type: ev.type, title: ev.title, start_date: ev.start_date, end_date: ev.end_date });
```
to:
```ts
      team.push({ key: ev.id, type: ev.type, title: ev.title, start_date: ev.start_date, end_date: ev.end_date, counts_as_working_day: ev.counts_as_working_day });
```

- [ ] **Step 3: Skip working-day events in `skipDaysMap`**

In the same file, change the `skipDaysMap` loop:
```ts
      const memberEvents = [...personal.filter((e) => e.member_emails.includes(member.email)), ...team];
      for (const event of memberEvents) {
        const start = parseDate(event.start_date);
        const end = parseDate(event.end_date);
        const days = diffDays(end, start) + 1;
        for (let d = 0; d < days; d++) {
          const date = new Date(start);
          date.setDate(date.getDate() + d);
          set.add(formatDate(date));
        }
      }
```
to:
```ts
      const memberEvents = [...personal.filter((e) => e.member_emails.includes(member.email)), ...team];
      for (const event of memberEvents) {
        // Events flagged "counts as a working day" do not reduce capacity —
        // tasks schedule straight through their dates.
        if (event.counts_as_working_day) continue;
        const start = parseDate(event.start_date);
        const end = parseDate(event.end_date);
        const days = diffDays(end, start) + 1;
        for (let d = 0; d < days; d++) {
          const date = new Date(start);
          date.setDate(date.getDate() + d);
          set.add(formatDate(date));
        }
      }
```

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no tsc errors, no ESLint errors. (Behavior is verified in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/components/gantt/GanttChart.tsx
git commit -m "feat: working-day events no longer block task scheduling"
```

---

### Task 4: Frontend — diagonal-hatch rendering (shared helper + 3 renderers)

**Files:**
- Create: `frontend/src/lib/eventHatch.ts`
- Modify: `frontend/src/components/gantt/PersonalEventBars.tsx`
- Modify: `frontend/src/components/gantt/GanttMergedEventRow.tsx`
- Modify: `frontend/src/components/gantt/GanttTeamEventStrip.tsx`

**Interfaces:**
- Consumes: `CalendarEvent.counts_as_working_day` and `TeamEvent.counts_as_working_day` (Task 3).
- Produces: `hatchBackground(type: string): string` — a `repeating-linear-gradient` for a working-day event in its type color. Used by all three renderers.

- [ ] **Step 1: Create the shared hatch helper**

Create `frontend/src/lib/eventHatch.ts`:

```ts
// Diagonal-hatch background for an event that "counts as a working day": the
// event is shown but does NOT block task scheduling, so it is drawn as a
// see-through hatch rather than a solid band. Keyed by event type so it keeps
// the type's colour.
const HATCH_STRIPE: Record<string, string> = {
  leave: "rgba(249, 115, 22, 0.55)",
  oncall: "rgba(239, 68, 68, 0.55)",
  holiday: "rgba(245, 158, 11, 0.55)",
  other: "rgba(107, 114, 128, 0.55)",
};

export function hatchBackground(type: string): string {
  const stripe = HATCH_STRIPE[type] ?? HATCH_STRIPE.other;
  return `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 4px, transparent 4px, transparent 9px)`;
}
```

- [ ] **Step 2: Hatch personal working-day events**

In `frontend/src/components/gantt/PersonalEventBars.tsx`, add the import after the existing imports:
```ts
import { hatchBackground } from "@/lib/eventHatch";
```

Change the rendered bar block:
```tsx
        return (
          <div
            key={`${event.id}-${email}`}
            className={`absolute z-[3] flex items-center justify-center overflow-hidden cursor-grab select-none ${dragging ? "opacity-90 cursor-grabbing z-20" : ""}`}
            style={{
              left: clippedLeft,
              width: clippedWidth,
              top: range.top,
              height: range.height,
              backgroundColor: "rgba(186, 0, 0, 0.15)",
              border: "1px solid rgba(186, 0, 0, 0.4)",
            }}
            onMouseDown={onMouseDown}
            onMouseEnter={(e) => {
              if (dragging) return;
              const rect = e.currentTarget.getBoundingClientRect();
              onShowTooltip(event, rect.left, rect.bottom);
            }}
            onMouseLeave={() => {
              if (dragging) return;
              onHideTooltip();
            }}
          >
            <span className="text-[10px] font-medium text-red-900/60 truncate px-1 pointer-events-none">
              {event.title}
            </span>
          </div>
        );
```
to:
```tsx
        const working = event.counts_as_working_day;
        const fillStyle = working
          ? { backgroundImage: hatchBackground(event.type), border: "1px dashed rgba(107, 114, 128, 0.6)" }
          : { backgroundColor: "rgba(186, 0, 0, 0.15)", border: "1px solid rgba(186, 0, 0, 0.4)" };
        return (
          <div
            key={`${event.id}-${email}`}
            className={`absolute z-[3] flex items-center justify-center overflow-hidden cursor-grab select-none ${dragging ? "opacity-90 cursor-grabbing z-20" : ""}`}
            style={{
              left: clippedLeft,
              width: clippedWidth,
              top: range.top,
              height: range.height,
              ...fillStyle,
            }}
            onMouseDown={onMouseDown}
            onMouseEnter={(e) => {
              if (dragging) return;
              const rect = e.currentTarget.getBoundingClientRect();
              onShowTooltip(event, rect.left, rect.bottom);
            }}
            onMouseLeave={() => {
              if (dragging) return;
              onHideTooltip();
            }}
          >
            <span className={`text-[10px] font-medium truncate px-1 pointer-events-none ${working ? "text-foreground/70" : "text-red-900/60"}`}>
              {event.title}
            </span>
          </div>
        );
```

- [ ] **Step 3: Hatch team background bands**

In `frontend/src/components/gantt/GanttMergedEventRow.tsx`, add the import:
```ts
import { hatchBackground } from "@/lib/eventHatch";
```

Change the `MergedEvent` interface to add the flag:
```ts
interface MergedEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}
```
to:
```ts
interface MergedEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
  counts_as_working_day: boolean;
}
```

Replace the `eventBandStyles` constant:
```ts
const eventBandStyles: Record<string, string> = {
  leave: "bg-orange-200/40 border-orange-500/70",
  oncall: "bg-red-200/40 border-red-500/70",
  holiday: "bg-amber-200/40 border-amber-500/70",
  other: "bg-gray-200/40 border-gray-500/70",
};
```
with split fill/border maps:
```ts
const bandFill: Record<string, string> = {
  leave: "bg-orange-200/40",
  oncall: "bg-red-200/40",
  holiday: "bg-amber-200/40",
  other: "bg-gray-200/40",
};

const bandBorder: Record<string, string> = {
  leave: "border-orange-500/70",
  oncall: "border-red-500/70",
  holiday: "border-amber-500/70",
  other: "border-gray-500/70",
};
```

Change the map body:
```tsx
        if (left + width < 0 || left > totalWidth) return null;
        const style = eventBandStyles[event.type] ?? eventBandStyles.other;
        return (
          <div
            key={event.key}
            className={`absolute top-0 border-2 border-dashed ${style}`}
            style={{
              left: Math.max(0, left),
              width: Math.min(left + width, totalWidth) - Math.max(0, left),
              height: totalHeight,
            }}
          />
        );
```
to:
```tsx
        if (left + width < 0 || left > totalWidth) return null;
        const border = bandBorder[event.type] ?? bandBorder.other;
        const working = event.counts_as_working_day;
        const fill = working ? "" : (bandFill[event.type] ?? bandFill.other);
        return (
          <div
            key={event.key}
            className={`absolute top-0 border-2 border-dashed ${border} ${fill}`}
            style={{
              left: Math.max(0, left),
              width: Math.min(left + width, totalWidth) - Math.max(0, left),
              height: totalHeight,
              ...(working ? { backgroundImage: hatchBackground(event.type) } : {}),
            }}
          />
        );
```

- [ ] **Step 4: Hatch the team strip caps**

In `frontend/src/components/gantt/GanttTeamEventStrip.tsx`, add the import:
```ts
import { hatchBackground } from "@/lib/eventHatch";
```

Change the `TeamEvent` interface to add the flag:
```ts
interface TeamEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}
```
to:
```ts
interface TeamEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
  counts_as_working_day: boolean;
}
```

Replace the `capStyles` constant:
```ts
const capStyles: Record<string, string> = {
  leave: "bg-orange-100 text-orange-700 border-orange-500/70",
  oncall: "bg-red-100 text-red-700 border-red-500/70",
  holiday: "bg-amber-100 text-amber-700 border-amber-500/70",
  other: "bg-gray-100 text-gray-600 border-gray-500/70",
};
```
with split base/fill maps:
```ts
const capBase: Record<string, string> = {
  leave: "text-orange-700 border-orange-500/70",
  oncall: "text-red-700 border-red-500/70",
  holiday: "text-amber-700 border-amber-500/70",
  other: "text-gray-600 border-gray-500/70",
};

const capFill: Record<string, string> = {
  leave: "bg-orange-100",
  oncall: "bg-red-100",
  holiday: "bg-amber-100",
  other: "bg-gray-100",
};
```

In `TeamEventCap`, change:
```tsx
  const top = height - (item.lane + 1) * LANE_HEIGHT - item.lane * LANE_GAP;
  const style = capStyles[item.ev.type] ?? capStyles.other;

  return (
    <>
      <div
        className={`absolute flex items-center border-2 border-b-0 border-dashed text-[10px] font-medium px-1.5 overflow-hidden whitespace-nowrap cursor-grab select-none ${dragging ? "cursor-grabbing z-20 opacity-90" : ""} ${style}`}
        style={{ left: clippedLeft, width: clippedWidth, top, height: LANE_HEIGHT }}
```
to:
```tsx
  const top = height - (item.lane + 1) * LANE_HEIGHT - item.lane * LANE_GAP;
  const working = item.ev.counts_as_working_day;
  const base = capBase[item.ev.type] ?? capBase.other;
  const fill = working ? "" : (capFill[item.ev.type] ?? capFill.other);

  return (
    <>
      <div
        className={`absolute flex items-center border-2 border-b-0 border-dashed text-[10px] font-medium px-1.5 overflow-hidden whitespace-nowrap cursor-grab select-none ${dragging ? "cursor-grabbing z-20 opacity-90" : ""} ${base} ${fill}`}
        style={{ left: clippedLeft, width: clippedWidth, top, height: LANE_HEIGHT, ...(working ? { backgroundImage: hatchBackground(item.ev.type) } : {}) }}
```

- [ ] **Step 5: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no tsc errors, no ESLint errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/eventHatch.ts frontend/src/components/gantt/PersonalEventBars.tsx frontend/src/components/gantt/GanttMergedEventRow.tsx frontend/src/components/gantt/GanttTeamEventStrip.tsx
git commit -m "feat: render working-day events with a diagonal hatch"
```

---

### Task 5: Frontend — EventPanel toggle + list badge + import sample template

**Files:**
- Modify: `frontend/src/components/EventPanel.tsx` (form field, checkbox, payload, list badge)
- Modify: `frontend/src/components/ImportPanel.tsx` (`SAMPLE_CSV`)

**Interfaces:**
- Consumes: `CalendarEvent.counts_as_working_day` (Task 3); `createEvent`/`updateEvent` pass the whole `CalendarEvent` (no API change).
- Produces: users can set the flag when adding/editing an event and see which events have it; the downloadable sample CSV advertises the column.

- [ ] **Step 1: Add the flag to the form model**

In `frontend/src/components/EventPanel.tsx`, change `EventFormData`:
```ts
interface EventFormData {
  scope: EventScope;
  member_emails: string[];
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}
```
to:
```ts
interface EventFormData {
  scope: EventScope;
  member_emails: string[];
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
  counts_as_working_day: boolean;
}
```

Change `emptyForm`:
```ts
const emptyForm: EventFormData = {
  scope: "personal",
  member_emails: [],
  type: "leave",
  title: "",
  start_date: "",
  end_date: "",
};
```
to:
```ts
const emptyForm: EventFormData = {
  scope: "personal",
  member_emails: [],
  type: "leave",
  title: "",
  start_date: "",
  end_date: "",
  counts_as_working_day: false,
};
```

- [ ] **Step 2: Pre-fill on edit and include in the payload**

Change `startEdit`'s `setForm`:
```ts
    setForm({
      scope: event.scope,
      member_emails: [...event.member_emails],
      type: event.type,
      title: event.title,
      start_date: event.start_date,
      end_date: event.end_date,
    });
```
to:
```ts
    setForm({
      scope: event.scope,
      member_emails: [...event.member_emails],
      type: event.type,
      title: event.title,
      start_date: event.start_date,
      end_date: event.end_date,
      counts_as_working_day: event.counts_as_working_day,
    });
```

Change the `payload` in `handleSubmit`:
```ts
      const payload: CalendarEvent = {
        id: editing ?? "",
        scope: form.scope,
        member_emails: form.scope === "team" ? [] : form.member_emails,
        type: form.type,
        title: titleForType(form.type, form.title),
        start_date: form.start_date,
        end_date: form.end_date,
      };
```
to:
```ts
      const payload: CalendarEvent = {
        id: editing ?? "",
        scope: form.scope,
        member_emails: form.scope === "team" ? [] : form.member_emails,
        type: form.type,
        title: titleForType(form.type, form.title),
        start_date: form.start_date,
        end_date: form.end_date,
        counts_as_working_day: form.counts_as_working_day,
      };
```

- [ ] **Step 3: Add the checkbox to the form**

In the form, the dates grid is immediately followed by the submit buttons:
```tsx
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Start</Label>
                <Input type="date" className="h-8 !text-[12px] mt-1" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">End</Label>
                <Input type="date" className="h-8 !text-[12px] mt-1" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
```
Insert the checkbox block between the dates grid's closing `</div>` and the `<div className="flex gap-2 pt-1">`:
```tsx
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Start</Label>
                <Input type="date" className="h-8 !text-[12px] mt-1" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">End</Label>
                <Input type="date" className="h-8 !text-[12px] mt-1" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-indigo-600"
                  checked={form.counts_as_working_day}
                  onChange={(e) => setForm({ ...form, counts_as_working_day: e.target.checked })}
                />
                <span className="font-medium">Counts as a working day</span>
              </label>
              <p className="text-[11px] text-muted-foreground mt-0.5">Tasks still schedule through these dates.</p>
            </div>
            <div className="flex gap-2 pt-1">
```

- [ ] **Step 4: Badge working-day events in the list**

In the event list row, the scope badge is followed by the close of its flex container:
```tsx
                      <Badge variant={event.scope === "team" ? "default" : "secondary"} className="text-[10px] flex-shrink-0">
                        {event.scope === "team" ? "Team" : "Personal"}
                      </Badge>
                    </div>
```
Insert a conditional badge right after the scope `Badge`:
```tsx
                      <Badge variant={event.scope === "team" ? "default" : "secondary"} className="text-[10px] flex-shrink-0">
                        {event.scope === "team" ? "Team" : "Personal"}
                      </Badge>
                      {event.counts_as_working_day && (
                        <Badge variant="secondary" className="text-[10px] flex-shrink-0">working day</Badge>
                      )}
                    </div>
```

- [ ] **Step 5: Advertise the column in the import sample**

In `frontend/src/components/ImportPanel.tsx`, change `SAMPLE_CSV`:
```ts
const SAMPLE_CSV =
  "event_type,title,start_date,end_date,member_emails,scope,type,color\n" +
  "event,Regression,2026-05-25,2026-05-29,alice@co.com|bob@co.com,personal,other,\n" +
  "event,,2026-06-01,2026-06-01,,team,holiday,\n" +
  "deadline,Release 1%,2026-08-03,,,,,red\n";
```
to:
```ts
const SAMPLE_CSV =
  "event_type,title,start_date,end_date,member_emails,scope,type,color,counts_as_working_day\n" +
  "event,Regression,2026-05-25,2026-05-29,alice@co.com|bob@co.com,personal,other,,false\n" +
  "event,On-call,2026-06-01,2026-06-05,carol@co.com,personal,oncall,,true\n" +
  "deadline,Release 1%,2026-08-03,,,,,red,\n";
```

- [ ] **Step 6: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no tsc errors, no ESLint errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/EventPanel.tsx frontend/src/components/ImportPanel.tsx
git commit -m "feat: EventPanel working-day toggle + import sample column"
```

---

### Task 6: End-to-end verification (controller-run)

No code unless a defect is found. Verify the whole feature in a real browser and confirm both suites are green. (The controller runs this; if a defect appears, dispatch a fix and re-verify.)

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS — all packages.

- [ ] **Step 2: Frontend build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no errors.

- [ ] **Step 3: Start both servers (isolated data dir)**

Backend (terminal 1, background, isolated temp `DATA_DIR` so real data is untouched):
`cd backend && DATA_DIR="$(mktemp -d)" go run ./cmd/server`
Frontend (terminal 2, background): `cd frontend && npm run dev`
Expected: backend logs `Server starting on :8080` (and `POST /api/import` in the route list); Vite serves `http://localhost:5173`.

- [ ] **Step 4: Seed data for a visible test**

Via the running UI (or `curl`): add a **member**, a **task** assigned to them with `effort` ≥ 5 and a start date, and a **personal event** for that member overlapping the task's span. Use the Members / Tasks / Events panels. (Starting from the empty temp dir keeps the assertion crisp.)

- [ ] **Step 5: Verify blocking → working-day toggle with Playwright MCP**

Using the Playwright MCP:
1. `browser_navigate` to `http://localhost:5173`.
2. With the event's **"Counts as a working day"** OFF, `browser_take_screenshot` of the timeline — the task bar should **split** around the event dates (current behavior).
3. Open the **Events** panel, edit the event, tick **"Counts as a working day"**, save.
4. `browser_take_screenshot` again — the task bar should now run **continuously through** the event dates, and the event should render as a **diagonal-hatch** band (not solid). Confirm the Events list shows the **"working day"** badge on that event.
5. Reopen the event editor and confirm the checkbox is still **ticked** (round-trip through the backend).

Expected: all confirmations hold. If the bar does not flow through, or the hatch/badge is missing, or the checkbox doesn't persist, fix before continuing.

- [ ] **Step 6: Verify import column**

Create a small CSV with an `event,...,counts_as_working_day` row set to `true`, import it via the Import panel, then confirm in the Events panel that the imported event shows the **"working day"** badge.

- [ ] **Step 7: Stop the verification servers**

Stop the two background servers (e.g. kill the listeners on ports 8080 and 5173) and remove the temp data dir.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §2/§4 per-event boolean, default false, JSON/CSV `counts_as_working_day` | Task 1 |
| §4 events.csv column + back-compat parse | Task 1 (parseEventRow `len>=8`, back-compat test) |
| §5 store serialize; handler no change | Task 1 (eventToRow); handler untouched by design |
| §6 scheduling: skip working-day events in skipDaysMap | Task 3 Step 3 |
| §7 hatch helper + 3 renderers (personal, team band, team strip) | Task 4 |
| §8 EventPanel checkbox + list indicator | Task 5 Steps 1–4 |
| §9 importer optional column; dedup identity unchanged | Task 2 (parse); store/import.go intentionally untouched |
| §9 sample template | Task 5 Step 5 |
| §10 backend tests (round-trip, back-compat, importer) | Tasks 1–2 |
| §10 frontend Playwright + build/lint | Tasks 3–6 |
| §12 non-goals (no workload change, weekends, per-event only, no upsert) | Honored — no task touches workload/weekend logic or import dedup |

No gaps.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to". Every code step shows complete before/after code; every command lists expected output. Frontend tasks gate on `npm run build` + `npm run lint` (no unit runner exists, per Global Constraints); behavior is verified in Task 6.

**3. Type consistency:** The field is named `counts_as_working_day` everywhere — Go `CountsAsWorkingDay` (`json:"counts_as_working_day"`, Tasks 1–2), TS `counts_as_working_day` on `CalendarEvent` (Task 3), GanttChart `TeamEvent`, `GanttMergedEventRow` `MergedEvent`, and `GanttTeamEventStrip` `TeamEvent` (all Task 3/4), `EventFormData` (Task 5), and the CSV column header (Task 1) + importer header match (Task 2). `hatchBackground(type: string): string` is defined in Task 4 Step 1 and called identically in all three renderers.
