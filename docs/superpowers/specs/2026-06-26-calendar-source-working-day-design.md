# Design: Per-calendar "Counts as working day" setting

**Date:** 2026-06-26
**Status:** Approved

## Problem

Synced Google Calendar events derive their `counts_as_working_day` flag
automatically from the calendar's event type (`gcal/sync.go`):

- `leave`, `holiday` → not a working day
- `oncall`, `other` → working day

This is hardcoded and not always correct for a given team. For example, an
on-call calendar may not actually consume a working day, or an `other`-typed
calendar should not. Manual events already expose a free "Counts as a working
day" checkbox; synced calendars have no equivalent control.

## Goal

Replace the type-based derivation with an explicit per-calendar toggle that the
user sets in Settings. The toggle defaults **off** for every calendar (new and
existing). Event type continues to drive the title and hatch color; only the
working-day flag becomes user-controlled.

## Non-goals

- Per-event override of the working-day flag (synced events stay locked; the
  setting is per calendar source).
- Changing how the title or hatch color are derived from type.
- Any change to manual-event behavior.

## Data model

`model.CalendarSource` gains one field:

```go
CountsAsWorkingDay bool `json:"counts_as_working_day"`
```

The zero value (`false`) is the chosen default, so no special-casing is needed
for new sources or for existing CSV rows that predate the column.

## Backend changes

### `store/calendar_sources.go`
- Extend `calendarSourcesHeader` to 6 columns, appending `counts_as_working_day`.
- `parseCalendarSourceRow`: read column index 5 behind a `len(row) >= 6` guard;
  parse with a case-insensitive `"true"` check (mirroring `parseEventRow` in
  `events.go`). A missing column reads as `false`.
- `calendarSourceToRow`: append `strconv.FormatBool(src.CountsAsWorkingDay)`.
- Keep the existing `len(row) < 4` skip guard in `GetCalendarSources` unchanged.
- Lazy migration: existing rows are rewritten with the new column the next time
  the sources file is saved (create / update / sync stamp). No eager rewrite.

### `gcal/sync.go`
- `BuildEvents` sets `CountsAsWorkingDay: src.CountsAsWorkingDay` directly.
- Delete the now-unused `countsAsWorkingDay(model.EventType) bool` helper.
- `titleFor` and the type-based title/color logic are unchanged.

### `handler/calendar_sources.go`
- No change. `Create` and `Update` already bind the full `model.CalendarSource`
  via `ShouldBindJSON`, so the new field flows through automatically.

## Frontend changes

### `types/index.ts`
- `CalendarSource` gains `counts_as_working_day: boolean`.

### `api/calendarSources.ts`
- Include `counts_as_working_day` in the create and update request payloads.

### `components/SettingsPage.tsx`
- `DraftRow` gains `counts_as_working_day: boolean`.
- `toDraft` maps the field from the fetched source.
- `addRow` defaults `counts_as_working_day: false`.
- Add a checkbox labelled "Counts as a working day" to each source row,
  styled consistently with the manual-event checkbox in `EventPanel.tsx`.
- `saveRow` sends `counts_as_working_day` in both the create and update calls.

## Behavior and side effects

- **First sync after this ships:** existing synced events flip to
  `counts_as_working_day = false` unless the user has ticked the calendar on.
  The store's `sameSyncedEvent` already compares the flag, so affected events
  are reported as "updated" and rewritten. No manual data migration is needed.
  This is the accepted behavior change for previously-`oncall`/`other`
  calendars.
- A calendar with the toggle **on** → its events render with the working-day
  hatch band and show the "working day" badge in the Events sidebar.
- A calendar with the toggle **off** → its events render with the red
  non-working band and show no "working day" badge.
- Title and hatch color still come from the event type.

## Testing

- **Store:** round-trip a source with `counts_as_working_day = true` through
  write/read; verify a legacy 5-column row parses with the flag defaulting to
  `false`.
- **`gcal` sync:** `BuildEvents` propagates `src.CountsAsWorkingDay` to every
  produced event for both `true` and `false`; remove the obsolete
  `countsAsWorkingDay` helper test.
- **Frontend:** `npm run build` + `npm run lint` clean. Playwright: toggle the
  checkbox on a source, sync, and confirm the band on the Gantt switches between
  the working-day hatch and the non-working red band.
