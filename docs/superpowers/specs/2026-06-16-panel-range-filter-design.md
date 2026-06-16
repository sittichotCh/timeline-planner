# Filter Events & Deadlines side panels to the timeline's date range

**Date:** 2026-06-16
**Status:** Approved (design)

## Summary

The Events and Deadlines side panels currently list every item regardless of
the Gantt timeline's visible window. This change filters each panel's rendered
list to the timeline's current `From`/`To` range: an item is shown only if it
overlaps that range, and out-of-range items are hard-hidden from the list.

The Gantt chart itself already clips events and deadlines to the visible range
(`PersonalEventBars`, `GanttTeamEventStrip`/`GanttMergedEventRow`,
`DeadlineMarker`). This brings the side panels in line with that behavior.

## Goals

- Events panel shows only events that **overlap** the timeline's `From`/`To`
  range.
- Deadlines panel shows only deadlines whose `date` falls **within** the range.
- Out-of-range items are completely hidden from the list (hard-hide).
- The active range and the visible/total counts are surfaced so hidden items
  are not mysterious.

## Non-goals

- No change to the Gantt chart rendering (already clips correctly).
- No change to how the range is set or persisted (`GanttChart` keeps ownership
  of the `From`/`To` inputs and continues persisting them).
- No backend, data-model, or CSV-format changes.
- No "show dimmed / collapsed outside-range section" — out-of-range is hidden.

## Approach (B: panels read the persisted range)

The `From`/`To` range is local state inside `GanttChart`, persisted to
`localStorage` under the `gantt-settings` key. Rather than lift that state into
`App` and make `GanttChart` a controlled component, the panels read the already-
persisted range through a small shared helper.

This is safe because the range `<input>`s live in the `GanttChart` top bar,
which sits behind each panel's modal overlay (Radix `Sheet`). The range
therefore **cannot change while a panel is open**, so reading it once when the
panel mounts is always current. Each panel is conditionally rendered in `App`
(`panel === "events" && <EventPanel/>`), so it remounts — and re-reads the
range — every time it is opened.

`GanttChart` remains the single writer of the range; the panels are read-only
consumers of the same persisted value.

## Architecture

### New: `@/lib/ganttSettings.ts`

Extract the storage key and range defaults that currently live inline in
`GanttChart` into a shared module so there is exactly one definition of each:

- `STORAGE_KEY = "gantt-settings"`
- `currentMonthStart()` / `nextMonthEnd()` — the existing default range bounds.
- `loadGanttRange(): { rangeStart: string; rangeEnd: string }` — reads
  `gantt-settings` from `localStorage` and resolves `rangeStart`/`rangeEnd`,
  falling back to `currentMonthStart()` / `nextMonthEnd()` exactly as
  `GanttChart` does today. Returns ISO `YYYY-MM-DD` strings.

`GanttChart` is updated to import `STORAGE_KEY`, `currentMonthStart`, and
`nextMonthEnd` from this module instead of its local copies. Its `loadSettings`
/ `saveSettings` (which also handle `zoom`) stay in `GanttChart`, keyed off the
shared `STORAGE_KEY`. This is a pure refactor with no behavior change.

### Filtering logic

Dates are ISO `YYYY-MM-DD`, so lexicographic string comparison is chronological.

- **Event overlaps range:** `event.start_date <= rangeEnd && event.end_date >= rangeStart`
- **Deadline in range:** `rangeStart <= deadline.date && deadline.date <= rangeEnd`

Bounds are inclusive on both ends, matching the chart (`generateDateRange`
includes both `From` and `To`).

### Panel changes

Both `EventPanel` and `DeadlinePanel`:

1. Read the active range once on mount via `loadGanttRange()` (lazy `useState`
   initializer, so it is captured at open-time and stable for the panel's life).
2. Derive a `visible` list (filtered by the predicate above) used **only for
   rendering**. All create/update/delete operations continue to run against the
   full `events` / `deadlines` array passed from `App`, so hidden items are
   never lost or corrupted.
3. Header subtitle shows the active window and counts, e.g.
   `3 of 7 · Jun 1 → Jul 31` (visible-of-total, then the range). When nothing is
   hidden, it can read simply as the count + range.
4. Empty state distinguishes two cases:
   - No items exist at all → existing "No events yet" / "No deadlines yet".
   - Items exist but none overlap the range → "No events in the current range.
     Adjust the timeline's From / To to see more." (and the deadline equivalent).

`DeadlinePanel` keeps its existing sort-by-date and past/future styling; the
filter is applied before the sort.

## Data flow

`App` is unchanged. Each panel self-sources the range from `loadGanttRange()`
and filters its own list. `GanttChart` continues to own and persist the range.

```
GanttChart (writes range) ──► localStorage["gantt-settings"]
                                      ▲
                                      │ loadGanttRange() (read on mount)
                          EventPanel / DeadlinePanel (filter rendered list)
```

## Error handling

`loadGanttRange()` reuses the existing defensive `JSON.parse` pattern (try/catch
returning defaults) so a missing or corrupt `gantt-settings` value yields the
default range rather than throwing. No new failure modes.

## Edge cases

- **Fresh user, never set a range:** `gantt-settings` has no `rangeStart`/
  `rangeEnd`; `loadGanttRange()` returns the same defaults `GanttChart` uses, so
  the panel and chart agree.
- **Adding an item outside the current range:** it will not appear in the list
  after creation (consistent with hard-hide). The "N of M" count and empty-state
  copy make it discoverable that the range is hiding items; widening `From`/`To`
  reveals it. No special handling beyond the count/empty-state messaging.

## Testing

The frontend has no unit-test runner (only `build` and `lint`); UI is verified
in a real browser via the Playwright MCP, per CLAUDE.md.

- `npm run build` (strict TypeScript, no `any`) — type-checks the new helper and
  panel changes.
- `npm run lint`.
- Playwright MCP: set a narrow `From`/`To`, open the Events panel and confirm
  only overlapping events show with correct counts; repeat for Deadlines; widen
  the range and confirm previously-hidden items reappear; verify the
  filtered-empty state copy.

## Files touched

- **New:** `frontend/src/lib/ganttSettings.ts` (`loadGanttRange` + shared
  `STORAGE_KEY` / `currentMonthStart` / `nextMonthEnd`).
- **Edited:** `frontend/src/components/gantt/GanttChart.tsx` (import shared
  helpers), `frontend/src/components/EventPanel.tsx` (filter + header/empty
  state), `frontend/src/components/DeadlinePanel.tsx` (filter + header/empty
  state).
