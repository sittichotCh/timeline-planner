# "Counts as a Working Day" Event Flag — Design

- **Date:** 2026-06-18
- **Status:** Approved (design)
- **Branch:** `feat/working-day-events`

## 1. Goal

Today every event (any type) reduces a member's working days: its dates are
added to a per-member skip set, so task bars are pushed/split around them. This
feature lets a user mark an **individual** event as "counts as a working day."
Tasks then schedule straight **through** its dates, and the event still renders
on the Gantt — as a distinct **diagonal-hatch** band (present, but not consuming
capacity).

## 2. Decisions (locked during brainstorming)

1. **Per-event boolean flag** (not per-type). Default **OFF** = blocks, exactly
   as today. Applies to both personal and team events.
2. **When ON:** the event's dates are NOT added to `skipDays` (tasks flow
   through); the event still renders, as a **diagonal-hatch** variant of its
   type color.
3. **CSV import:** add an optional `counts_as_working_day` column (event rows)
   so imports can set the flag.

## 3. Current behavior (context)

- `frontend/src/lib/dates.ts` — `computeWorkingSegments` / `getWorkingDays` skip
  weekends and any date present in a `skipDays: Set<string>`.
- `frontend/src/components/gantt/GanttChart.tsx` — `skipDaysMap` adds **every**
  date of **every** event (a member's personal events + all team events) to that
  member's skip set. No per-type or per-event distinction exists.
- Events render via `PersonalEventBars.tsx` (personal overlay) and
  `GanttMergedEventRow.tsx` + `GanttTeamEventStrip.tsx` (team background band +
  top strip).
- All working-day logic is frontend-only; the backend just stores events in
  `events.csv`.

## 4. Data model

- **`model.Event` (Go):** add `CountsAsWorkingDay bool` with
  `json:"counts_as_working_day"`.
- **`CalendarEvent` (TS):** add `counts_as_working_day: boolean`.
- **`events.csv`:** append a trailing column. New header:
  `id, member_emails, scope, type, title, start_date, end_date, counts_as_working_day`.
- **Serialization:** `"true"` / `"false"`.
- **Parsing (back-compatible):** a row that has the 8th column parses it
  (`"true"`/`"1"` → true, else false); a row missing it (existing 7-column
  files) → `false`. The existing `len(row) < 7` skip guard stays. **Migration is
  lazy:** old files keep working (read as `false`); the new column is written on
  the next save (the store already rewrites `events.csv` on normalization, and
  every create/update writes the new header + column).

## 5. Backend

- **`store/events.go`:** `eventsHeader` gains `counts_as_working_day`;
  `parseEventRow` reads index 7 when `len(row) >= 8` (else `false`);
  `eventToRow` appends the bool as `"true"`/`"false"`.
- **`handler/events.go`:** **no change required** — `ShouldBindJSON` populates
  the new struct field automatically, and Create/Update already persist the whole
  `Event`. The zero value (`false`) is the correct default.
- No new routes; GET responses include the field automatically via the struct
  tag.

## 6. Scheduling behavior (the core change — small)

In `GanttChart.tsx`, where `skipDaysMap` is built, **skip (continue) any event
whose `counts_as_working_day` is `true`** — do not add its dates to the member's
skip set. Nothing else changes; task bars flow through those dates via the
existing `computeWorkingSegments`. Weekends remain always non-working.

## 7. Gantt rendering — diagonal hatch

- A working-day event renders as a **diagonal-hatch** band in its existing type
  color (leave=orange / oncall=red / holiday=amber / other=gray), instead of the
  solid band. Blocking events are unchanged.
- A small **shared helper** produces the hatch background
  (`repeating-linear-gradient` in the type color) so the gradient isn't
  duplicated across renderers.
- Apply in:
  - `PersonalEventBars.tsx` (personal overlay bars).
  - `GanttMergedEventRow.tsx` (team background band).
  - `GanttTeamEventStrip.tsx` (top strip cap) — apply the same hatch background
    behind the cap label (via the shared helper) so the strip matches the band;
    keep its label text and type color.

## 8. EventPanel UI

- Add a **"Counts as a working day"** checkbox to the add/edit event form,
  default unchecked, with the hint *"Tasks still schedule through these dates."*
- `EventFormData` gains `counts_as_working_day`; create/update payloads include
  it; editing pre-fills it from the event.
- In the events list, show a small hatched indicator/badge on events that have
  the flag on.

## 9. CSV import

- **Importer (`importer/importer.go`):** add an optional `counts_as_working_day`
  column, matched by header name like every other column (order-independent),
  **event rows only** (deadline rows ignore it). Parse case-insensitively:
  `true` / `1` / `yes` → `true`; blank or anything else → `false`. The produced
  `model.Event` carries the flag.
- **Persistence:** `store.ImportEvents` is unchanged — it assigns IDs and writes
  via `eventToRow`, which now includes the column.
- **Dedup identity is unchanged:** `counts_as_working_day` is a property of an
  event, not part of its identity — like `color` is for deadlines. The event
  dedup key stays `scope + type + title + start + end + sorted members`.
  Consequence (consistent with the existing append + skip-duplicates rule):
  re-importing an otherwise-identical event with the flag flipped is skipped as a
  duplicate, not updated.
- **Sample template:** update the "Download sample CSV" content in
  `ImportPanel.tsx` to include the `counts_as_working_day` column with an
  example value.

## 10. Testing

- **Backend (TDD):**
  - `store`: round-trip an event with `counts_as_working_day` true and false;
    back-compat — a hand-written 7-column `events.csv` row parses as `false`;
    the written header includes the new column.
  - `importer`: a row with `counts_as_working_day=true` → flag true; blank →
    false; `yes`/`1` accepted; header-order independent; deadline rows ignore the
    column.
- **Frontend:** verified in a real browser with Playwright — a working-day event
  lets a task bar flow through (continuous), while a normal event still splits
  it; the hatch band renders; the EventPanel checkbox round-trips (set → reload →
  still set). Plus `npm run build` (tsc) + `npm run lint`. (No frontend
  unit-test runner exists.)

## 11. Anticipated file changes

**Backend**
- `backend/internal/model/event.go` — add field.
- `backend/internal/store/events.go` — header, parse, serialize.
- `backend/internal/importer/importer.go` — parse the new column for event rows.
- (`handler/events.go` — no change expected.)

**Frontend**
- `frontend/src/types/index.ts` — add field.
- `frontend/src/components/gantt/GanttChart.tsx` — skip working-day events in
  `skipDaysMap`.
- `frontend/src/components/gantt/PersonalEventBars.tsx` — hatch.
- `frontend/src/components/gantt/GanttMergedEventRow.tsx` — hatch.
- `frontend/src/components/gantt/GanttTeamEventStrip.tsx` — indicator.
- a shared hatch-background helper (small util/const).
- `frontend/src/components/EventPanel.tsx` — checkbox + list indicator.
- `frontend/src/components/ImportPanel.tsx` — sample-CSV template.
- (`frontend/src/api/events.ts` — no change; the field rides along on
  `CalendarEvent`.)

## 12. Non-goals / out of scope

- No change to the workload total (`memberWorkloads` stays a naive effort sum).
- Weekends remain always non-working — the flag only removes the event's own
  blocking, never weekend logic.
- Per-event only — no per-type defaults.
- Import stays append + skip-duplicates; the flag is not part of dedup identity,
  so no upsert/update via re-import.
