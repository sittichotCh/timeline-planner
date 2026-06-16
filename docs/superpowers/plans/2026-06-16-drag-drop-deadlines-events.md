# Drag-to-reschedule Deadlines & Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag deadlines and calendar events horizontally on the Gantt timeline to change their dates, reusing one shared drag hook that `TaskBar` is also refactored onto.

**Architecture:** Extract the existing inline `TaskBar` drag mechanics into a `useDayDrag` hook and a `DragDatePill` component. Build three draggable components on top of it (`DeadlineMarker`, `PersonalEventBars`, and a `TeamEventCap` inside `GanttTeamEventStrip`). Thread `onEventUpdate` / `onDeadlineUpdate` callbacks from `App` → `GanttChart` → those components, persisting via the existing PUT endpoints with the same optimistic-then-refetch pattern as `onTaskUpdate`.

**Tech Stack:** React 19 + TypeScript (strict, no `any`), Tailwind v4, Vite. No backend changes. Verification via `npm run build`, `npm run lint`, and the Playwright MCP (the repo has no FE unit-test runner).

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/dates.ts` (modify) | Add `shiftISODate(iso, days)` pure helper. |
| `frontend/src/components/gantt/useDayDrag.ts` (create) | Hook owning the mousedown→window move/up lifecycle + day snapping. |
| `frontend/src/components/gantt/DragDatePill.tsx` (create) | Floating date+delta pill (portal) shown while dragging. |
| `frontend/src/components/gantt/DeadlineMarker.tsx` (create) | One deadline's line+dot+label; label is the drag handle. |
| `frontend/src/components/gantt/PersonalEventBars.tsx` (create) | One personal event's per-member-row boxes, dragged as a group. |
| `frontend/src/components/gantt/TaskBar.tsx` (modify) | Refactor onto `useDayDrag` + `DragDatePill`. |
| `frontend/src/components/gantt/GanttTeamEventStrip.tsx` (modify) | Add a draggable `TeamEventCap` subcomponent + `onEventUpdate` prop. |
| `frontend/src/components/gantt/GanttChart.tsx` (modify) | Accept + thread `onEventUpdate`/`onDeadlineUpdate`; render the new components. |
| `frontend/src/App.tsx` (modify) | Add `handleEventUpdate`/`handleDeadlineUpdate`; pass the new props. |

**Branch:** all work happens on the existing `feat/drag-drop-deadlines-events` branch.

> **Note on the working tree:** `EventPanel.tsx` and `DeadlinePanel.tsx` have unrelated uncommitted changes (the earlier full-title work). Do NOT `git add -A`. Every commit step below stages **only** the exact files it names.

---

## Task 1: `shiftISODate` date helper

**Files:**
- Modify: `frontend/src/lib/dates.ts`

- [ ] **Step 1: Add the helper**

Append to `frontend/src/lib/dates.ts` (it already exports `addDays`, `parseDate`, `formatDate`):

```ts
/**
 * Shift an ISO date string (YYYY-MM-DD) by a whole number of days, returning a
 * new ISO date string. Round-trips through local-midnight Dates so it matches
 * the rest of the timeline's date math (see formatDate's note on timezones).
 */
export function shiftISODate(iso: string, days: number): string {
  return formatDate(addDays(parseDate(iso), days));
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npm run build`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/dates.ts
git commit -m "feat: add shiftISODate date helper"
```

---

## Task 2: `useDayDrag` hook

This lifts the exact drag logic currently inline in `TaskBar` (including the "use the mouseup event's position, not stale state" fix) into a reusable hook.

**Files:**
- Create: `frontend/src/components/gantt/useDayDrag.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/components/gantt/useDayDrag.ts`:

```ts
import { useCallback, useEffect, useState } from "react";

export interface DayDrag {
  /** True while a drag is in progress. */
  dragging: boolean;
  /** Horizontal pixels moved since drag start (0 when not dragging). */
  dragOffset: number;
  /** dragOffset snapped to whole day columns. */
  daysMoved: number;
  /** Current cursor position, for positioning a floating indicator. */
  dragPos: { x: number; y: number };
  /** Attach to the draggable element's onMouseDown. */
  onMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Horizontal day-snapped drag. On release, if the cursor moved a non-zero
 * number of day-columns, `onCommit(daysMoved)` fires; otherwise `onClick` fires
 * (a plain click). Listeners live on window so the drag keeps tracking even if
 * the cursor leaves the element.
 */
export function useDayDrag(
  columnWidth: number,
  onCommit: (daysMoved: number) => void,
  onClick?: () => void,
): DayDrag {
  const [startX, setStartX] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });

  const handleMove = useCallback(
    (e: MouseEvent) => {
      if (startX === null) return;
      setDragOffset(e.clientX - startX);
      setDragPos({ x: e.clientX, y: e.clientY });
    },
    [startX],
  );

  const handleUp = useCallback(
    (e: MouseEvent) => {
      if (startX === null) return;
      // Read the final offset from the release event, not from dragOffset state:
      // mouseup can fire before React re-renders the last mousemove, which would
      // otherwise drop a day off.
      const finalOffset = e.clientX - startX;
      const daysMoved = Math.round(finalOffset / columnWidth);
      if (daysMoved !== 0) onCommit(daysMoved);
      else onClick?.();
      setStartX(null);
      setDragOffset(0);
    },
    [startX, columnWidth, onCommit, onClick],
  );

  useEffect(() => {
    if (startX === null) return;
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [startX, handleMove, handleUp]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setStartX(e.clientX);
    setDragOffset(0);
    setDragPos({ x: e.clientX, y: e.clientY });
  }, []);

  return {
    dragging: startX !== null,
    dragOffset,
    daysMoved: Math.round(dragOffset / columnWidth),
    dragPos,
    onMouseDown,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npm run build`
Expected: PASS. (The hook is unused so far; this only confirms it compiles.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/gantt/useDayDrag.ts
git commit -m "feat: add useDayDrag hook"
```

---

## Task 3: `DragDatePill` component

**Files:**
- Create: `frontend/src/components/gantt/DragDatePill.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/gantt/DragDatePill.tsx` (markup/classes copied verbatim from the current `TaskBar` drag indicator so it looks identical):

```tsx
import { createPortal } from "react-dom";

interface DragDatePillProps {
  /** Cursor position to anchor the pill to. */
  cursor: { x: number; y: number };
  /** The prospective date to display. */
  date: Date;
  /** Day delta, for the "+3d" / "no change" suffix. */
  daysMoved: number;
}

/** Floating indicator shown while dragging a timeline item. */
export function DragDatePill({ cursor, date, daysMoved }: DragDatePillProps) {
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const deltaLabel = daysMoved === 0 ? "no change" : `${daysMoved > 0 ? "+" : ""}${daysMoved}d`;
  return createPortal(
    <div
      className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full rounded-md bg-indigo-600 text-white shadow-lg px-2 py-1 flex items-center gap-1.5 whitespace-nowrap"
      style={{ left: cursor.x, top: cursor.y - 14 }}
    >
      <span className="text-[11px] font-semibold">{dateLabel}</span>
      <span className="text-[10px] font-medium text-indigo-200">{deltaLabel}</span>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/gantt/DragDatePill.tsx
git commit -m "feat: add DragDatePill drag indicator"
```

---

## Task 4: Refactor `TaskBar` onto the shared hook

Behavior must be unchanged: drag moves `start_date` by whole days; a zero-move click opens the task; the bar follows the cursor; the indigo pill shows the prospective date.

**Files:**
- Modify: `frontend/src/components/gantt/TaskBar.tsx`

- [ ] **Step 1: Update imports**

In `frontend/src/components/gantt/TaskBar.tsx`, change the dates import line and add the two new imports. Replace:

```tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { TaskSetting, Deadline } from "@/types";
import { parseDate, diffDays, formatDate, addDays, computeWorkingSegments, getWorkingDays } from "@/lib/dates";
import { TaskTooltip } from "./TaskTooltip";
```

with:

```tsx
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { TaskSetting, Deadline } from "@/types";
import { parseDate, diffDays, addDays, shiftISODate, computeWorkingSegments, getWorkingDays } from "@/lib/dates";
import { TaskTooltip } from "./TaskTooltip";
import { useDayDrag } from "./useDayDrag";
import { DragDatePill } from "./DragDatePill";
```

- [ ] **Step 2: Replace the drag state + handlers with the hook**

Replace this block (the `dragging`/`dragOffset`/`dragPos` state, `handleMouseMove`, `handleMouseUp`, and the `useEffect` that wires window listeners — currently lines ~36–80):

```tsx
  const [dragging, setDragging] = useState<{ startX: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      setDragOffset(e.clientX - dragging.startX);
      setDragPos({ x: e.clientX, y: e.clientY });
    },
    [dragging],
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      // Compute the offset from the actual release position rather than from
      // dragOffset state: the mouseup can fire before React re-renders after
      // the final mousemove, leaving the state (and this closure) one move
      // stale — which made the drop land a day off from the indicator.
      const finalOffset = e.clientX - dragging.startX;
      const daysMoved = Math.round(finalOffset / columnWidth);
      if (daysMoved !== 0) {
        onTaskUpdate?.({ ...task, start_date: formatDate(addDays(parseDate(task.start_date), daysMoved)) });
      } else {
        onOpenTask?.(task.task_id);
      }
      setDragging(null);
      setDragOffset(0);
    },
    [dragging, columnWidth, onTaskUpdate, onOpenTask, task],
  );

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);
```

with:

```tsx
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { dragging, dragOffset, daysMoved, dragPos, onMouseDown } = useDayDrag(
    columnWidth,
    (days) => onTaskUpdate?.({ ...task, start_date: shiftISODate(task.start_date, days) }),
    () => onOpenTask?.(task.task_id),
  );
```

- [ ] **Step 3: Update the bar's `onMouseDown`**

In the bar `<div>` (the one rendered per segment), replace:

```tsx
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              setHovered(false);
              setDragging({ startX: e.clientX });
              setDragOffset(0);
              setDragPos({ x: e.clientX, y: e.clientY });
            }}
```

with:

```tsx
            onMouseDown={(e) => {
              setHovered(false);
              onMouseDown(e);
            }}
```

(The `left` computation `... + (dragging ? dragOffset : 0)` and the `${dragging ? ...}` class string stay as-is — `dragging` and `dragOffset` now come from the hook.)

- [ ] **Step 4: Replace the inline drag-pill portal**

Replace the final block (currently the `{dragging && start && createPortal((() => { ... })(), document.body)}` indicator — lines ~166–184):

```tsx
      {dragging && start && createPortal((() => {
        const daysMoved = Math.round(dragOffset / columnWidth);
        const previewStart = addDays(start, daysMoved);
        const dateLabel = previewStart.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const deltaLabel = daysMoved === 0 ? "no change" : `${daysMoved > 0 ? "+" : ""}${daysMoved}d`;
        return (
          <div
            className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full rounded-md bg-indigo-600 text-white shadow-lg px-2 py-1 flex items-center gap-1.5 whitespace-nowrap"
            style={{ left: dragPos.x, top: dragPos.y - 14 }}
          >
            <span className="text-[11px] font-semibold">{dateLabel}</span>
            <span className="text-[10px] font-medium text-indigo-200">{deltaLabel}</span>
          </div>
        );
      })(), document.body)}
```

with:

```tsx
      {dragging && start && (
        <DragDatePill cursor={dragPos} date={addDays(start, daysMoved)} daysMoved={daysMoved} />
      )}
```

- [ ] **Step 5: Type-check + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS. (If lint flags an unused import such as `formatDate` or `createPortal`, remove it — `createPortal` is still used by the hovered-tooltip block, `formatDate` is not.)

- [ ] **Step 6: Manual smoke test (Playwright MCP)**

With the dev server running (`localhost:5173`), navigate there, drag a task bar a few days right, release, and confirm: the indigo pill showed during drag and the bar landed on the new date. Confirms the refactor preserved behavior.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/gantt/TaskBar.tsx
git commit -m "refactor: TaskBar uses shared useDayDrag + DragDatePill"
```

---

## Task 5: `DeadlineMarker` component (draggable deadline)

Extracts the inline deadline JSX from `GanttChart` into a self-contained, draggable component. The label pill is the only grab handle; the line/dot stay `pointer-events-none` so they don't block task hovers.

**Files:**
- Create: `frontend/src/components/gantt/DeadlineMarker.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/gantt/DeadlineMarker.tsx` (the `deadlineColorMap` is moved here from `GanttChart`):

```tsx
import type { Deadline } from "@/types";
import { addDays, parseDate, shiftISODate } from "@/lib/dates";
import { useDayDrag } from "./useDayDrag";
import { DragDatePill } from "./DragDatePill";

const deadlineColorMap: Record<string, { line: string; bg: string; text: string }> = {
  red: { line: "bg-red-500", bg: "bg-red-50", text: "text-red-700" },
  orange: { line: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700" },
  amber: { line: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
  emerald: { line: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  blue: { line: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  violet: { line: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-700" },
};

interface DeadlineMarkerProps {
  deadline: Deadline;
  /** Px from the left of the body to the deadline's day-center line. */
  offset: number;
  /** Vertical stacking lane (avoids label collisions). */
  lane: number;
  /** Full body height, so the line spans every row. */
  totalHeight: number;
  columnWidth: number;
  onUpdate?: (deadline: Deadline) => void;
}

export function DeadlineMarker({ deadline, offset, lane, totalHeight, columnWidth, onUpdate }: DeadlineMarkerProps) {
  const colors = deadlineColorMap[deadline.color] ?? deadlineColorMap.red!;
  const { dragging, dragOffset, daysMoved, dragPos, onMouseDown } = useDayDrag(
    columnWidth,
    (days) => onUpdate?.({ ...deadline, date: shiftISODate(deadline.date, days) }),
  );
  const liveOffset = offset + (dragging ? dragOffset : 0);

  return (
    <div className="absolute top-0 z-[8] pointer-events-none" style={{ left: liveOffset, height: totalHeight }}>
      <div className={`w-0.5 h-full ${colors.line} opacity-60`} style={{ marginLeft: -1 }} />
      <div className={`absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${colors.line} ring-2 ring-white shadow-sm`} />
      <div
        className={`absolute left-1 whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shadow-sm pointer-events-auto cursor-grab select-none ${dragging ? "cursor-grabbing ring-1 ring-indigo-400" : ""}`}
        style={{ top: 12 + lane * 18 }}
        onMouseDown={onMouseDown}
      >
        {deadline.title}
      </div>
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(parseDate(deadline.date), daysMoved)} daysMoved={daysMoved} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npm run build`
Expected: PASS. (Unused until Task 7 wires it in.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/gantt/DeadlineMarker.tsx
git commit -m "feat: add draggable DeadlineMarker component"
```

---

## Task 6: `PersonalEventBars` component (draggable personal event)

Renders all of one personal event's per-member-row boxes and drags them together. Tooltip show/hide is delegated to `GanttChart` via callbacks (so the existing `EventTooltip` keeps working).

**Files:**
- Create: `frontend/src/components/gantt/PersonalEventBars.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/gantt/PersonalEventBars.tsx`:

```tsx
import type { CalendarEvent } from "@/types";
import { addDays, diffDays, parseDate, shiftISODate } from "@/lib/dates";
import { useDayDrag } from "./useDayDrag";
import { DragDatePill } from "./DragDatePill";

interface PersonalEventBarsProps {
  event: CalendarEvent;
  /** Per-member vertical placement on the timeline. */
  memberYRanges: Map<string, { top: number; height: number }>;
  rangeStart: Date;
  columnWidth: number;
  totalWidth: number;
  onUpdate?: (event: CalendarEvent) => void;
  onShowTooltip: (event: CalendarEvent, x: number, y: number) => void;
  onHideTooltip: () => void;
}

export function PersonalEventBars({
  event,
  memberYRanges,
  rangeStart,
  columnWidth,
  totalWidth,
  onUpdate,
  onShowTooltip,
  onHideTooltip,
}: PersonalEventBarsProps) {
  const { dragging, dragOffset, daysMoved, dragPos, onMouseDown } = useDayDrag(
    columnWidth,
    (days) =>
      onUpdate?.({
        ...event,
        start_date: shiftISODate(event.start_date, days),
        end_date: shiftISODate(event.end_date, days),
      }),
  );

  const start = parseDate(event.start_date);
  const end = parseDate(event.end_date);
  const baseLeft = diffDays(start, rangeStart) * columnWidth;
  const width = (diffDays(end, start) + 1) * columnWidth;
  const left = baseLeft + (dragging ? dragOffset : 0);
  if (left + width < 0 || left > totalWidth) return null;
  const clippedLeft = Math.max(0, left);
  const clippedWidth = Math.min(left + width, totalWidth) - clippedLeft;

  return (
    <>
      {event.member_emails.map((email) => {
        const range = memberYRanges.get(email);
        if (!range) return null;
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
      })}
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(start, daysMoved)} daysMoved={daysMoved} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npm run build`
Expected: PASS. (Unused until Task 7.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/gantt/PersonalEventBars.tsx
git commit -m "feat: add draggable PersonalEventBars component"
```

---

## Task 7: Wire deadlines + personal events into `GanttChart`

Adds the two update-callback props, renders `DeadlineMarker` and `PersonalEventBars`, removes the now-duplicated inline JSX and the moved `deadlineColorMap`, and exposes tooltip show/hide helpers.

**Files:**
- Modify: `frontend/src/components/gantt/GanttChart.tsx`

- [ ] **Step 1: Add imports**

Add to the gantt-component imports near the top of `GanttChart.tsx`:

```tsx
import { DeadlineMarker } from "./DeadlineMarker";
import { PersonalEventBars } from "./PersonalEventBars";
```

- [ ] **Step 2: Extend the props interface**

Replace the `GanttChartProps` interface (currently lines 17–25):

```tsx
interface GanttChartProps {
  members: Member[];
  tasks: TaskSetting[];
  events: CalendarEvent[];
  deadlines?: Deadline[];
  jiraBaseUrl?: string;
  onTaskUpdate?: (task: TaskSetting) => void;
  onOpenTask?: (taskId: string) => void;
}
```

with:

```tsx
interface GanttChartProps {
  members: Member[];
  tasks: TaskSetting[];
  events: CalendarEvent[];
  deadlines?: Deadline[];
  jiraBaseUrl?: string;
  onTaskUpdate?: (task: TaskSetting) => void;
  onOpenTask?: (taskId: string) => void;
  onEventUpdate?: (event: CalendarEvent) => void;
  onDeadlineUpdate?: (deadline: Deadline) => void;
}
```

- [ ] **Step 3: Destructure the new props**

Update the component signature (currently line 111):

```tsx
export function GanttChart({ members, tasks, events, deadlines = [], jiraBaseUrl = "", onTaskUpdate, onOpenTask }: GanttChartProps) {
```

to:

```tsx
export function GanttChart({ members, tasks, events, deadlines = [], jiraBaseUrl = "", onTaskUpdate, onOpenTask, onEventUpdate, onDeadlineUpdate }: GanttChartProps) {
```

- [ ] **Step 4: Delete the moved `deadlineColorMap`**

Remove this block (it now lives in `DeadlineMarker.tsx` — currently lines 87–94):

```tsx
const deadlineColorMap: Record<string, { line: string; bg: string; text: string }> = {
  red: { line: "bg-red-500", bg: "bg-red-50", text: "text-red-700" },
  orange: { line: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700" },
  amber: { line: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
  emerald: { line: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  blue: { line: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  violet: { line: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-700" },
};
```

- [ ] **Step 5: Add tooltip show/hide helpers**

Immediately after the `scrollToToday` callback (around line 277, before `handleRangeStartChange`), add:

```tsx
  const showEventTooltip = useCallback((_event: CalendarEvent, x: number, y: number) => {
    if (eventHoverTimeout.current) clearTimeout(eventHoverTimeout.current);
    setEventTooltipPos({ x, y });
    setHoveredEvent(_event);
  }, []);

  const hideEventTooltip = useCallback(() => {
    eventHoverTimeout.current = setTimeout(() => setHoveredEvent(null), 150);
  }, []);
```

- [ ] **Step 6: Replace the inline personal-events block**

Replace the personal event overlay block (currently lines 518–551, the `{personal.flatMap((ev) => { ... })}`):

```tsx
              {/* Personal event overlays — merged across a member's rows */}
              {personal.flatMap((ev) => {
                const start = parseDate(ev.start_date);
                const end = parseDate(ev.end_date);
                const left = diffDays(start, rangeStart) * columnWidth;
                const width = (diffDays(end, start) + 1) * columnWidth;
                if (left + width < 0 || left > totalWidth) return [];
                const clippedLeft = Math.max(0, left);
                const clippedWidth = Math.min(left + width, totalWidth) - clippedLeft;
                return ev.member_emails.flatMap((email) => {
                  const range = memberYRanges.get(email);
                  if (!range) return [];
                  return [(
                    <div
                      key={`${ev.id}-${email}`}
                      className="absolute z-[3] flex items-center justify-center overflow-hidden cursor-pointer"
                      style={{ left: clippedLeft, width: clippedWidth, top: range.top, height: range.height, backgroundColor: "rgba(186, 0, 0, 0.15)", border: "1px solid rgba(186, 0, 0, 0.4)" }}
                      onMouseEnter={(e) => {
                        if (eventHoverTimeout.current) clearTimeout(eventHoverTimeout.current);
                        const rect = e.currentTarget.getBoundingClientRect();
                        setEventTooltipPos({ x: rect.left, y: rect.bottom });
                        setHoveredEvent(ev);
                      }}
                      onMouseLeave={() => {
                        eventHoverTimeout.current = setTimeout(() => setHoveredEvent(null), 150);
                      }}
                    >
                      <span className="text-[10px] font-medium text-red-900/60 truncate px-1 pointer-events-none">
                        {ev.title}
                      </span>
                    </div>
                  )];
                });
              })}
```

with:

```tsx
              {/* Personal event overlays — merged across a member's rows */}
              {personal.map((ev) => (
                <PersonalEventBars
                  key={ev.id}
                  event={ev}
                  memberYRanges={memberYRanges}
                  rangeStart={rangeStart}
                  columnWidth={columnWidth}
                  totalWidth={totalWidth}
                  onUpdate={onEventUpdate}
                  onShowTooltip={showEventTooltip}
                  onHideTooltip={hideEventTooltip}
                />
              ))}
```

- [ ] **Step 7: Replace the inline deadline-markers block**

Replace the deadline markers block (currently lines 553–568, the `{deadlineLayout.map(({ dl, offset, lane }) => { ... })}`):

```tsx
              {/* Deadline markers */}
              {deadlineLayout.map(({ dl, offset, lane }) => {
                const colors = deadlineColorMap[dl.color] ?? deadlineColorMap.red!;
                return (
                  <div key={dl.id} className="absolute top-0 z-[8] pointer-events-none" style={{ left: offset, height: totalBodyHeight }}>
                    <div className={`w-0.5 h-full ${colors.line} opacity-60`} style={{ marginLeft: -1 }} />
                    <div className={`absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${colors.line} ring-2 ring-white shadow-sm`} />
                    <div
                      className={`absolute left-1 whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shadow-sm`}
                      style={{ top: 12 + lane * 18 }}
                    >
                      {dl.title}
                    </div>
                  </div>
                );
              })}
```

with:

```tsx
              {/* Deadline markers */}
              {deadlineLayout.map(({ dl, offset, lane }) => (
                <DeadlineMarker
                  key={dl.id}
                  deadline={dl}
                  offset={offset}
                  lane={lane}
                  totalHeight={totalBodyHeight}
                  columnWidth={columnWidth}
                  onUpdate={onDeadlineUpdate}
                />
              ))}
```

- [ ] **Step 8: Type-check + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS. If lint reports an unused symbol now that the inline blocks are gone (e.g. nothing references `deadlineColorMap` anymore — it should already be deleted in Step 4), resolve it. `parseDate`/`diffDays` are still used elsewhere in the file, so leave those imports.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/gantt/GanttChart.tsx
git commit -m "feat: render draggable deadline + personal-event components in GanttChart"
```

---

## Task 8: Draggable team-event caps in `GanttTeamEventStrip`

Add an `onEventUpdate` prop and a `TeamEventCap` subcomponent (one `useDayDrag` per cap — hooks can't run in a `.map`). Each cap reconstructs a full team `CalendarEvent` on commit (matching how the strip already builds one for `EventTooltip`).

**Files:**
- Modify: `frontend/src/components/gantt/GanttTeamEventStrip.tsx`

- [ ] **Step 1: Update imports + props**

Replace the top of `frontend/src/components/gantt/GanttTeamEventStrip.tsx`:

```tsx
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseDate, diffDays } from "@/lib/dates";
import type { EventType } from "@/types";
import { EventTooltip } from "./EventTooltip";

interface TeamEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}

interface GanttTeamEventStripProps {
  teamEvents: TeamEvent[];
  rangeStart: Date;
  columnWidth: number;
  totalWidth: number;
}
```

with:

```tsx
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, parseDate, diffDays, shiftISODate } from "@/lib/dates";
import type { CalendarEvent, EventType } from "@/types";
import { EventTooltip } from "./EventTooltip";
import { useDayDrag } from "./useDayDrag";
import { DragDatePill } from "./DragDatePill";

interface TeamEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}

interface GanttTeamEventStripProps {
  teamEvents: TeamEvent[];
  rangeStart: Date;
  columnWidth: number;
  totalWidth: number;
  onEventUpdate?: (event: CalendarEvent) => void;
}
```

- [ ] **Step 2: Accept the new prop**

Change the component signature:

```tsx
export function GanttTeamEventStrip({ teamEvents, rangeStart, columnWidth, totalWidth }: GanttTeamEventStripProps) {
```

to:

```tsx
export function GanttTeamEventStrip({ teamEvents, rangeStart, columnWidth, totalWidth, onEventUpdate }: GanttTeamEventStripProps) {
```

- [ ] **Step 3: Add the `TeamEventCap` subcomponent**

Add this component at the end of the file (after the `GanttTeamEventStrip` function). It owns one cap's drag and live position:

```tsx
interface LaidTeamEvent {
  ev: TeamEvent;
  left: number;
  width: number;
  right: number;
  lane: number;
}

interface TeamEventCapProps {
  item: LaidTeamEvent;
  height: number;
  columnWidth: number;
  totalWidth: number;
  onEventUpdate?: (event: CalendarEvent) => void;
  onHover: (ev: TeamEvent, x: number, y: number) => void;
  onLeave: () => void;
}

function TeamEventCap({ item, height, columnWidth, totalWidth, onEventUpdate, onHover, onLeave }: TeamEventCapProps) {
  const { dragging, dragOffset, daysMoved, dragPos, onMouseDown } = useDayDrag(
    columnWidth,
    (days) =>
      onEventUpdate?.({
        id: item.ev.key,
        member_emails: [],
        scope: "team",
        type: item.ev.type,
        title: item.ev.title,
        start_date: shiftISODate(item.ev.start_date, days),
        end_date: shiftISODate(item.ev.end_date, days),
      }),
  );

  const offset = dragging ? dragOffset : 0;
  const left = item.left + offset;
  const right = item.right + offset;
  const clippedLeft = Math.max(0, left);
  const clippedWidth = Math.min(right, totalWidth) - clippedLeft;
  // lane 0 sits flush at the bottom (capping the band); extra lanes stack upward
  const top = height - (item.lane + 1) * LANE_HEIGHT - item.lane * LANE_GAP;
  const style = capStyles[item.ev.type] ?? capStyles.other;

  return (
    <>
      <div
        className={`absolute flex items-center border-2 border-b-0 border-dashed text-[10px] font-medium px-1.5 overflow-hidden whitespace-nowrap cursor-grab select-none ${dragging ? "cursor-grabbing z-20 opacity-90" : ""} ${style}`}
        style={{ left: clippedLeft, width: clippedWidth, top, height: LANE_HEIGHT }}
        onMouseDown={onMouseDown}
        onMouseEnter={(e) => {
          if (dragging) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onHover(item.ev, rect.left, rect.bottom);
        }}
        onMouseLeave={() => {
          if (dragging) return;
          onLeave();
        }}
      >
        {item.ev.title || item.ev.type}
      </div>
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(parseDate(item.ev.start_date), daysMoved)} daysMoved={daysMoved} />
      )}
    </>
  );
}
```

- [ ] **Step 4: Render caps via the subcomponent**

Replace the `{laid.map((it) => { ... })}` block inside `GanttTeamEventStrip`'s returned JSX (the `<div>` per cap, currently lines ~72–101) with:

```tsx
      {laid.map((it) => (
        <TeamEventCap
          key={it.ev.key}
          item={it}
          height={height}
          columnWidth={columnWidth}
          totalWidth={totalWidth}
          onEventUpdate={onEventUpdate}
          onHover={(ev, x, y) => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            setTooltipPos({ x, y });
            setHovered(ev);
          }}
          onLeave={() => {
            hoverTimeout.current = setTimeout(() => setHovered(null), 150);
          }}
        />
      ))}
```

(The `laid` array's items already have shape `{ ev, left, width, right, lane }`, matching `LaidTeamEvent`. The existing `hovered`/`tooltipPos`/`hoverTimeout` state and the `createPortal` tooltip block below stay unchanged.)

- [ ] **Step 5: Type-check + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS. (`diffDays`/`parseDate` are still used by the `laid` layout calc and the cap pill.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/gantt/GanttTeamEventStrip.tsx
git commit -m "feat: draggable team-event caps"
```

---

## Task 9: App-level persistence + prop wiring

Adds optimistic update handlers (mirroring `handleTaskUpdate`) and threads the props into `GanttChart` and the team strip.

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/gantt/GanttChart.tsx`

- [ ] **Step 1: Import the update API functions**

In `frontend/src/App.tsx`, change:

```tsx
import { fetchEvents } from "@/api/events";
import { fetchTasks, upsertTask } from "@/api/tasks";
import { fetchDeadlines } from "@/api/deadlines";
```

to:

```tsx
import { fetchEvents, updateEvent } from "@/api/events";
import { fetchTasks, upsertTask } from "@/api/tasks";
import { fetchDeadlines, updateDeadline } from "@/api/deadlines";
```

- [ ] **Step 2: Add the handlers**

Immediately after `handleTaskUpdate` (currently ends line 68) in `App.tsx`, add:

```tsx
  const handleEventUpdate = useCallback(async (updated: CalendarEvent) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    try {
      const saved = await updateEvent(updated.id, updated);
      setEvents((prev) => prev.map((e) => (e.id === saved.id ? saved : e)));
    } catch {
      fetchEvents().then(setEvents).catch(() => {});
    }
  }, []);

  const handleDeadlineUpdate = useCallback(async (updated: Deadline) => {
    setDeadlines((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    try {
      const saved = await updateDeadline(updated.id, updated);
      setDeadlines((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
    } catch {
      fetchDeadlines().then(setDeadlines).catch(() => {});
    }
  }, []);
```

- [ ] **Step 3: Pass the new props to `GanttChart`**

Replace the `<GanttChart ... />` usage (currently lines 144–152):

```tsx
          <GanttChart
            members={members}
            tasks={tasks}
            events={events}
            deadlines={deadlines}
            jiraBaseUrl={jiraBaseUrl}
            onTaskUpdate={handleTaskUpdate}
            onOpenTask={(taskId) => setEditTaskId(taskId)}
          />
```

with:

```tsx
          <GanttChart
            members={members}
            tasks={tasks}
            events={events}
            deadlines={deadlines}
            jiraBaseUrl={jiraBaseUrl}
            onTaskUpdate={handleTaskUpdate}
            onOpenTask={(taskId) => setEditTaskId(taskId)}
            onEventUpdate={handleEventUpdate}
            onDeadlineUpdate={handleDeadlineUpdate}
          />
```

- [ ] **Step 4: Pass `onEventUpdate` to the team strip in `GanttChart`**

In `frontend/src/components/gantt/GanttChart.tsx`, replace the `<GanttTeamEventStrip ... />` usage (currently lines 399–404):

```tsx
              <GanttTeamEventStrip
                teamEvents={team}
                rangeStart={rangeStart}
                columnWidth={columnWidth}
                totalWidth={totalWidth}
              />
```

with:

```tsx
              <GanttTeamEventStrip
                teamEvents={team}
                rangeStart={rangeStart}
                columnWidth={columnWidth}
                totalWidth={totalWidth}
                onEventUpdate={onEventUpdate}
              />
```

- [ ] **Step 5: Type-check + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/gantt/GanttChart.tsx
git commit -m "feat: persist deadline/event drag via App update handlers"
```

---

## Task 10: End-to-end verification (Playwright MCP)

Verifies all three draggables move + persist, and that the task refactor still works. Requires the backend (`:8080`) and frontend dev server (`:5173`) running.

- [ ] **Step 1: Deadline drag**

Navigate to `http://localhost:5173`. Find a deadline label on the timeline. Using the Playwright MCP, press the mouse down on the label, move right by roughly `3 * columnWidth` px (columnWidth at 100% zoom = 42px → ~126px), and release. Confirm: the indigo date pill appeared during the drag, and after release the deadline line sits ~3 columns right. Open the **Deadlines** panel and confirm that deadline's date advanced by 3 days. (`browser_drag`, or `browser_evaluate` dispatching `mousedown`/`mousemove`/`mouseup` on `window`, both work.)

- [ ] **Step 2: Personal event drag**

Find a personal event box (a translucent red box on a member row). Drag it left by ~2 columns and release. Confirm the box moved and the **Events** panel shows that event's `start_date` and `end_date` each moved back 2 days (range width unchanged).

- [ ] **Step 3: Team event drag**

Find a team-event cap in the top strip. Drag it right by ~2 columns and release. Confirm the cap moved live, and after release both the cap and the faint full-height band sit at the new position; the **Events** panel shows the team event shifted +2 days.

- [ ] **Step 4: Task regression**

Drag a task bar a couple of days and confirm it still reschedules (the refactor in Task 4 preserved behavior).

- [ ] **Step 5: Final build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 6: Mark the plan done**

No code change. The feature is complete: deadlines, personal events, and team events are all drag-to-reschedule, sharing one `useDayDrag` hook with tasks.

---

## Self-Review Notes

- **Spec coverage:** deadline drag (Tasks 5, 7), personal-event drag (Tasks 6, 7), team-event drag (Task 8), move-only/range-preserving (Tasks 6, 8 shift both dates), shared hook + `TaskBar` refactor (Tasks 2, 4), `DragDatePill` (Task 3), data flow/persistence (Task 9), no backend/type changes (confirmed — only frontend files), testing approach (Task 10 + per-task build/lint). All spec sections map to tasks.
- **Type consistency:** the hook is `useDayDrag(columnWidth, onCommit, onClick?)` returning `{ dragging, dragOffset, daysMoved, dragPos, onMouseDown }` everywhere; `DragDatePill` is always `{ cursor, date, daysMoved }`; update callbacks are `onEventUpdate(event: CalendarEvent)` / `onDeadlineUpdate(deadline: Deadline)` from App through every consumer; `shiftISODate(iso, days)` used by all four commit handlers.
- **No placeholders:** every code step shows complete code; every run step shows the command and expected result.
