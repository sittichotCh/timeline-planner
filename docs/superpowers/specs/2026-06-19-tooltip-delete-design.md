# Delete From Event & Deadline Tooltips — Design

- **Date:** 2026-06-19
- **Status:** Approved (design)
- **Branch:** `feat/tooltip-delete`

## 1. Goal

Let a user delete an event or a deadline directly from its Gantt tooltip,
without opening the Events/Deadlines side panel. Add a **Delete** button at the
bottom of each tooltip; deadlines (which have no tooltip today) gain one.

## 2. Decisions (locked during brainstorming)

1. **Both events and deadlines** get a tooltip Delete button. Deadlines get a
   **new hover tooltip** (title, date, color) to host it, mirroring events.
2. **Delete is immediate** — one click deletes, no confirmation. Matches the
   existing Events/Deadlines panel Delete buttons.
3. **Button placement:** a small destructive **Delete** button (trash icon +
   "Delete") at the **bottom** of the tooltip (not a corner ✕).
4. **Frontend-only.** The backend `DELETE /api/events/:id` and
   `DELETE /api/deadlines/:id` already exist (used by the panels) — no backend
   change.

## 3. Current behavior (context)

- **Event tooltip** (`EventTooltip`) shows on hover for personal bars
  (`PersonalEventBars` → `GanttChart` manages `hoveredEvent` + renders the
  tooltip in a body portal) and for team caps (`GanttTeamEventStrip` manages its
  own `hovered` + renders its own `EventTooltip` portal). Both portals bridge
  hover: `onMouseEnter` cancels a ~150ms hide timeout, `onMouseLeave` reschedules
  it — so the mouse can move into the tooltip and a button is clickable.
- **Deadlines** have **no tooltip**: `DeadlineMarker` renders a line + dot + a
  draggable colored label only.
- **Delete APIs:** `deleteEvent(id: string): Promise<void>` (`api/events.ts`),
  `deleteDeadline(id: string): Promise<void>` (`api/deadlines.ts`).
- **App state owners:** `App` holds `events`/`deadlines`; `handleEventUpdate`/
  `handleDeadlineUpdate` optimistically update state, call the update API, and on
  failure refetch the whole list (`fetchEvents`/`fetchDeadlines` → setState).
- `GanttChart` props today: `onEventUpdate`, `onDeadlineUpdate` (no delete).

## 4. Design

### 4.1 `EventTooltip` (modify)

- Add optional prop `onDelete?: () => void`.
- When `onDelete` is set, render a **Delete** button at the bottom of the card
  (full-width, destructive style, trash icon + "Delete"). When absent, the
  tooltip looks exactly as today (so other/legacy usages are unaffected).
- The button calls `onDelete` on click.

### 4.2 `DeadlineTooltip` (new component)

- New file `frontend/src/components/gantt/DeadlineTooltip.tsx`.
- Props: `deadline: Deadline`, `position: { x: number; y: number }`,
  `onDelete?: () => void`.
- Renders a card matching `EventTooltip`'s look: a colored dot/chip for the
  deadline color, the title, the date, and (when `onDelete` is set) the same
  bottom **Delete** button.

### 4.3 `DeadlineMarker` (modify) — self-contained hover tooltip

- Add prop `onDelete?: (deadline: Deadline) => void`.
- Add local hover state and render a `DeadlineTooltip` in a body portal, mirroring
  `GanttTeamEventStrip`'s pattern: the label's `onMouseEnter` opens the tooltip
  (record cursor position from `getBoundingClientRect`); `onMouseLeave` schedules
  a ~150ms hide; the portal's `onMouseEnter`/`onMouseLeave` bridge the gap. Do
  **not** open the tooltip while dragging (`if (dragging) return`), consistent
  with the existing drag handling.
- The portal `DeadlineTooltip` receives `onDelete={() => { onDelete?.(deadline);
  setHovered(false); }}` so the tooltip closes immediately on delete.

### 4.4 `GanttTeamEventStrip` (modify)

- Add prop `onEventDelete?: (event: CalendarEvent) => void`.
- Pass `onDelete` into its `EventTooltip`: it already reconstructs a
  `CalendarEvent` from the hovered `TeamEvent` (id = `key`, scope `team`, …) for
  the tooltip — reuse that object: `onDelete={() => { onEventDelete?.(<that
  event>); setHovered(null); }}`. Clearing `hovered` prevents a tooltip dangling
  on the just-removed item.

### 4.5 `GanttChart` (modify)

- Add props `onEventDelete?: (event: CalendarEvent) => void` and
  `onDeadlineDelete?: (deadline: Deadline) => void`.
- Personal event tooltip portal: pass
  `onDelete={() => { onEventDelete?.(hoveredEvent); setHoveredEvent(null); }}`.
- Pass `onDeadlineDelete` down to each `DeadlineMarker` as its `onDelete`.
- Pass `onEventDelete` down to `GanttTeamEventStrip`.

### 4.6 `App` (modify)

- Add `handleEventDelete(event)` and `handleDeadlineDelete(deadline)`,
  mirroring the update handlers:
  - Optimistically remove the item from state (`setEvents(prev =>
    prev.filter(e => e.id !== id))`, same for deadlines).
  - `await deleteEvent(id)` / `await deleteDeadline(id)`; on failure, refetch the
    whole list and setState (`fetchEvents`/`fetchDeadlines`), restoring the item
    if the server still has it.
- Pass `onEventDelete={handleEventDelete}` and
  `onDeadlineDelete={handleDeadlineDelete}` into `GanttChart`.
- Import `deleteEvent`/`deleteDeadline` (and ensure `fetchEvents`/`fetchDeadlines`
  are imported — they already are).

## 5. Data flow

hover → tooltip (already wired) → **Delete** click → `onDelete` →
`GanttChart`/`strip`/`marker` clears its hover state and calls
`onEventDelete`/`onDeadlineDelete` → `App` removes from state (item disappears
from the chart) + calls the DELETE API → on failure, refetch reconciles.

## 6. Error handling

- API failure: the optimistic removal is reconciled by a full refetch (mirrors
  the update handlers), so a failed delete reappears. No new error UI.
- After delete, the owning component clears its hover state so no tooltip refers
  to a removed item.

## 7. Testing

- No frontend unit-test runner. Verify with `npm run build` (tsc) + `npm run
  lint`, then Playwright (isolated `DATA_DIR`):
  - Seed a member, a personal event, a team event, and a deadline.
  - Hover the personal event → tooltip shows a **Delete** button → click →
    the bar disappears from the chart and the event is gone from
    `GET /api/events`.
  - Hover the team cap → tooltip → Delete → team band/cap gone.
  - Hover the deadline label → new tooltip appears with title/date → Delete →
    the deadline marker disappears and is gone from `GET /api/deadlines`.

## 8. Anticipated file changes (frontend only)

- `frontend/src/components/gantt/EventTooltip.tsx` — `onDelete` + Delete button.
- `frontend/src/components/gantt/DeadlineTooltip.tsx` — **new**.
- `frontend/src/components/gantt/DeadlineMarker.tsx` — hover tooltip + `onDelete`.
- `frontend/src/components/gantt/GanttTeamEventStrip.tsx` — `onEventDelete` +
  pass `onDelete` to its `EventTooltip`.
- `frontend/src/components/gantt/GanttChart.tsx` — `onEventDelete`/
  `onDeadlineDelete` props + wiring to the tooltips/markers/strip.
- `frontend/src/App.tsx` — `handleEventDelete`/`handleDeadlineDelete` + pass to
  `GanttChart` + import the delete APIs.

## 9. Non-goals / out of scope

- No confirmation step (immediate delete, by decision).
- No backend changes (DELETE routes already exist).
- No delete affordances outside the tooltips; the panels keep their own Delete.
- No bulk delete, no undo toast.
