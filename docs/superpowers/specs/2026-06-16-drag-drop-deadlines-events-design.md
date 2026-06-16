# Drag-to-reschedule for Deadlines & Events on the Gantt Timeline

**Date:** 2026-06-16
**Status:** Approved (design)

## Summary

Let users reschedule deadlines and calendar events directly on the Gantt
timeline by dragging them horizontally, mirroring the existing task-bar drag.
The shared drag mechanics are extracted into one hook so tasks, deadlines, and
events all use the same implementation.

## Goals

- Drag a **deadline** marker left/right to change its `date`.
- Drag a **calendar event** (personal or team) left/right to shift its whole
  date range; duration is unchanged (move-only, no resize).
- Persist changes via the existing PUT endpoints; optimistic UI with refetch on
  failure.
- Eliminate duplicated drag logic by extracting a shared hook, and refactor the
  existing `TaskBar` onto it.

## Non-goals

- Resizing events by their edges (move-only this iteration).
- Vertical drag (reassigning an event's members or a task's owner).
- Reordering items in the Events / Deadlines side panels.
- Any backend, data-model, or CSV-format changes.

## Behavior

- Grab the draggable element and move horizontally. The drop snaps to whole
  days: `daysMoved = Math.round(offsetPx / columnWidth)`.
- While dragging, a floating date pill follows the cursor showing the prospective
  new date and the day delta (e.g. `+3d`), exactly like the task-bar pill.
- **Deadline:** new `date = shift(date, daysMoved)`.
- **Event (personal & team):** new `start_date` and `end_date` each shifted by
  `daysMoved` (range preserved).
- No clamping to the visible range (consistent with task dragging).
- A click with zero movement is a no-op; hover tooltips continue to work. While
  dragging, the element's hover tooltip is suppressed.

## Architecture

### Shared, reusable pieces (new)

- **`useDayDrag({ columnWidth, onCommit })`** — a hook that owns the
  `mousedown` → window `mousemove`/`mouseup` lifecycle and day-snapping. Returns
  `{ dragging, dragOffset, daysMoved, dragPos, onMouseDown }`. It carries over the
  subtlety already solved in `TaskBar`: compute the final offset from the
  `mouseup` event position rather than from possibly-stale React state, so the
  drop never lands a day off. `onCommit(daysMoved)` is called on drop only when
  `daysMoved !== 0`.
- **`<DragDatePill cursor date delta />`** — the floating indicator rendered via
  a portal, lifted out of `TaskBar` so every draggable shows an identical pill.

### Draggable components

- **`DeadlineMarker`** (new) — extracted from the inline deadline JSX in
  `GanttChart`. The label pill is the drag handle (`pointer-events-auto`; the
  marker wrapper stays `pointer-events-none` so it doesn't block task hovers).
  `onCommit → onDeadlineUpdate({ ...dl, date: shifted })`.
- **`PersonalEventBars`** (new) — replaces the current per-box `flatMap` in
  `GanttChart`. Renders all of one event's per-member-row boxes and shares a
  single `useDayDrag`, so every box for that event moves together while dragging.
  `onCommit → onEventUpdate({ ...ev, start_date, end_date shifted })`.
- **`GanttTeamEventStrip`** — each cap becomes draggable via `useDayDrag`.
  `onCommit → onEventUpdate(...)`. The faint full-height band
  (`GanttMergedEventRow`) is decoration: only the cap and pill move during the
  drag; the band re-renders to the new position on drop from updated state.
- **`TaskBar`** — refactored to consume `useDayDrag` + `DragDatePill`, removing
  its inline drag code so there is a single shared pattern.

## Data flow

Mirrors the existing `onTaskUpdate` path.

- `App.tsx` gains `handleEventUpdate` and `handleDeadlineUpdate`:
  optimistically update local state (`setEvents` / `setDeadlines`), persist via
  the existing `updateEvent` / `updateDeadline` API functions, and refetch on
  failure (same shape as `handleTaskUpdate`).
- New props `onEventUpdate` / `onDeadlineUpdate` thread from
  `App` → `GanttChart` → (`DeadlineMarker`, `PersonalEventBars`,
  `GanttTeamEventStrip`). Added to `GanttChartProps`.

No type changes: `CalendarEvent.start_date/end_date`, `Deadline.date`, and the
`PUT /events/:id` and `PUT /deadlines/:id` endpoints already exist.

## Date math

A single pure helper shifts an ISO date string by N days, reusing the existing
`parseDate` / `addDays` / `formatDate` in `@/lib/dates`. Used by all three
`onCommit` handlers.

## Error handling

- Persist failure: revert is handled by the optimistic-then-refetch pattern (on
  error, refetch the resource so the UI reflects the server's truth).
- Drag is cancelled cleanly if the mouse is released with zero movement
  (treated as a click / no-op).

## Testing

The frontend has no unit-test runner (only `build` and `lint` scripts); UI is
verified in a real browser via the Playwright MCP, per CLAUDE.md. We follow that
established approach rather than introducing a test framework for this feature.

- `npm run build` (strict TypeScript, no `any`) — also type-checks the new
  `shiftISODate` helper and all new props/components.
- `npm run lint`.
- Playwright MCP: drag a deadline, a personal event, and a team cap; assert the
  live date pill appears and the post-drop persisted dates (via the
  Events/Deadlines panels or a network request) change by the expected number of
  days.

## Files touched

- New: `useDayDrag` hook, `DragDatePill`, `DeadlineMarker`, `PersonalEventBars`,
  date-shift helper (+ its test).
- Edited: `GanttChart.tsx` (render new components, accept + thread new props),
  `GanttTeamEventStrip.tsx` (draggable caps), `TaskBar.tsx` (consume the hook),
  `App.tsx` (new handlers + props), `GanttChartProps` interface.
