# Delete From Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom **Delete** button to the event tooltip and to a new deadline tooltip, deleting the item immediately from the Gantt.

**Architecture:** `EventTooltip` gains an optional `onDelete`; a new `DeadlineTooltip` mirrors it; `DeadlineMarker` grows a self-contained hover tooltip (like `GanttTeamEventStrip`). Delete callbacks flow up through `GanttChart` to `App`, which removes the item from state and calls the existing DELETE API (refetch on failure). Frontend-only — the backend DELETE routes already exist.

**Tech Stack:** React 19 + TypeScript (strict) + Vite + Tailwind v4; UI `Button` from `@/components/ui/button`; icons from `lucide-react`.

## Global Constraints

- Frontend is strict TypeScript — **no `any`.** Run frontend commands from `frontend/`. There is **no frontend unit-test runner** — verification is `npm run build` (tsc) + `npm run lint` + Playwright MCP.
- **Frontend-only.** No backend changes — `DELETE /api/events/:id` and `DELETE /api/deadlines/:id` already exist; `deleteEvent(id)` / `deleteDeadline(id)` are in `@/api/events` / `@/api/deadlines`.
- **Delete is immediate** (one click, no confirmation), matching the existing panel Delete buttons.
- The Delete button is a full-width destructive `Button` (`variant="destructive" size="xs"`) with a `Trash2` icon + "Delete", at the **bottom** of the tooltip card.
- After delete, the owning component clears its own hover state so no tooltip lingers on a removed item.
- App delete handlers mirror the existing update handlers: optimistic state change, then API call, then full refetch on failure.

---

### Task 1: Event tooltip Delete

**Files:**
- Modify: `frontend/src/components/gantt/EventTooltip.tsx` (add `onDelete` + button)
- Modify: `frontend/src/components/gantt/GanttTeamEventStrip.tsx` (`onEventDelete` prop + pass `onDelete`)
- Modify: `frontend/src/components/gantt/GanttChart.tsx` (`onEventDelete` prop + wire personal tooltip and team strip)
- Modify: `frontend/src/App.tsx` (`handleEventDelete` + import `deleteEvent` + pass prop)

**Interfaces:**
- Produces: `EventTooltip` prop `onDelete?: () => void`; `GanttTeamEventStrip` prop `onEventDelete?: (event: CalendarEvent) => void`; `GanttChart` prop `onEventDelete?: (event: CalendarEvent) => void`.
- Consumes: `deleteEvent(id: string): Promise<void>` (`@/api/events`), `fetchEvents` (already imported in App).

- [ ] **Step 1: Add `onDelete` + Delete button to `EventTooltip`**

Replace the entire contents of `frontend/src/components/gantt/EventTooltip.tsx` with:

```tsx
import type { CalendarEvent } from "@/types";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface EventTooltipProps {
  event: CalendarEvent;
  position: { x: number; y: number };
  onDelete?: () => void;
}

const typeLabels: Record<string, string> = {
  leave: "Leave",
  oncall: "Oncall",
  holiday: "Holiday",
  other: "Other",
};

const scopeStyles: Record<string, string> = {
  personal: "bg-red-50 text-red-700 ring-1 ring-red-200",
  team: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
};

const typeStyles: Record<string, string> = {
  leave: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  oncall: "bg-red-50 text-red-700 ring-1 ring-red-200",
  holiday: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  other: "bg-gray-50 text-gray-600 ring-1 ring-gray-200",
};

export function EventTooltip({ event, position, onDelete }: EventTooltipProps) {
  return (
    <div
      className="pt-2"
      style={{ marginLeft: position.x, marginTop: position.y }}
    >
    <div className="bg-white rounded-xl shadow-xl ring-1 ring-black/5 p-4 w-64 backdrop-blur-sm">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${scopeStyles[event.scope] ?? "bg-gray-50 text-gray-600 ring-1 ring-gray-200"}`}>
            {event.scope === "team" ? "Team" : "Personal"}
          </span>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${typeStyles[event.type] ?? "bg-gray-50 text-gray-600 ring-1 ring-gray-200"}`}>
            {typeLabels[event.type] ?? event.type}
          </span>
        </div>
        <p className="text-[13px] text-gray-900 font-medium leading-snug">{event.title}</p>
        <div className="flex gap-4 text-[11px] text-gray-500">
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
              <path fillRule="evenodd" d="M4 1.75a.75.75 0 01.75.75V3h6.5V2.5a.75.75 0 011.5 0V3h.25A1.75 1.75 0 0114.75 4.75v8.5A1.75 1.75 0 0113 15H3A1.75 1.75 0 011.25 13.25v-8.5A1.75 1.75 0 013 3h.25V2.5A.75.75 0 014 1.75z" clipRule="evenodd" />
            </svg>
            {event.start_date}
          </div>
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
              <path fillRule="evenodd" d="M2 8a.75.75 0 01.75-.75h8.69L8.22 4.03a.75.75 0 011.06-1.06l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06l3.22-3.22H2.75A.75.75 0 012 8z" clipRule="evenodd" />
            </svg>
            {event.end_date}
          </div>
        </div>
        {onDelete && (
          <Button variant="destructive" size="xs" className="w-full mt-1" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </Button>
        )}
      </div>
    </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `onDelete` in the team strip**

In `frontend/src/components/gantt/GanttTeamEventStrip.tsx`, add the prop to the props interface. Change:
```tsx
interface GanttTeamEventStripProps {
  teamEvents: TeamEvent[];
  rangeStart: Date;
  columnWidth: number;
  totalWidth: number;
  onEventUpdate?: (event: CalendarEvent) => void;
}
```
to:
```tsx
interface GanttTeamEventStripProps {
  teamEvents: TeamEvent[];
  rangeStart: Date;
  columnWidth: number;
  totalWidth: number;
  onEventUpdate?: (event: CalendarEvent) => void;
  onEventDelete?: (event: CalendarEvent) => void;
}
```

Change the component signature:
```tsx
export function GanttTeamEventStrip({ teamEvents, rangeStart, columnWidth, totalWidth, onEventUpdate }: GanttTeamEventStripProps) {
```
to:
```tsx
export function GanttTeamEventStrip({ teamEvents, rangeStart, columnWidth, totalWidth, onEventUpdate, onEventDelete }: GanttTeamEventStripProps) {
```

Add a body-level reconstruction of the hovered event (so it isn't duplicated). Immediately after this line:
```tsx
  const height = laneCount * (LANE_HEIGHT + LANE_GAP);
```
insert:
```tsx

  const hoveredEvent: CalendarEvent | null = hovered
    ? {
        id: hovered.key,
        member_emails: [],
        scope: "team",
        type: hovered.type,
        title: hovered.title,
        start_date: hovered.start_date,
        end_date: hovered.end_date,
        counts_as_working_day: hovered.counts_as_working_day,
      }
    : null;
```

Replace the tooltip portal block:
```tsx
      {hovered && createPortal(
        <div
          className="fixed z-50"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <EventTooltip
            event={{ id: hovered.key, member_emails: [], scope: "team", type: hovered.type, title: hovered.title, start_date: hovered.start_date, end_date: hovered.end_date, counts_as_working_day: hovered.counts_as_working_day }}
            position={{ x: 0, y: 0 }}
          />
        </div>,
        document.body,
      )}
```
with:
```tsx
      {hovered && hoveredEvent && createPortal(
        <div
          className="fixed z-50"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <EventTooltip
            event={hoveredEvent}
            position={{ x: 0, y: 0 }}
            onDelete={onEventDelete ? () => { if (hoveredEvent) { onEventDelete(hoveredEvent); setHovered(null); } } : undefined}
          />
        </div>,
        document.body,
      )}
```

- [ ] **Step 3: Add the `onEventDelete` prop to `GanttChart` and wire both tooltips**

In `frontend/src/components/gantt/GanttChart.tsx`, change the props interface:
```tsx
  onEventUpdate?: (event: CalendarEvent) => void;
  onDeadlineUpdate?: (deadline: Deadline) => void;
}
```
to:
```tsx
  onEventUpdate?: (event: CalendarEvent) => void;
  onDeadlineUpdate?: (deadline: Deadline) => void;
  onEventDelete?: (event: CalendarEvent) => void;
}
```

Change the component destructure:
```tsx
export function GanttChart({ members, tasks, events, deadlines = [], jiraBaseUrl = "", onTaskUpdate, onOpenTask, onEventUpdate, onDeadlineUpdate }: GanttChartProps) {
```
to:
```tsx
export function GanttChart({ members, tasks, events, deadlines = [], jiraBaseUrl = "", onTaskUpdate, onOpenTask, onEventUpdate, onDeadlineUpdate, onEventDelete }: GanttChartProps) {
```

Pass it to the team strip. Change:
```tsx
              <GanttTeamEventStrip
                teamEvents={team}
                rangeStart={rangeStart}
                columnWidth={columnWidth}
                totalWidth={totalWidth}
                onEventUpdate={onEventUpdate}
              />
```
to:
```tsx
              <GanttTeamEventStrip
                teamEvents={team}
                rangeStart={rangeStart}
                columnWidth={columnWidth}
                totalWidth={totalWidth}
                onEventUpdate={onEventUpdate}
                onEventDelete={onEventDelete}
              />
```

Wire the personal tooltip. Change:
```tsx
          <EventTooltip event={hoveredEvent} position={{ x: 0, y: 0 }} />
```
to:
```tsx
          <EventTooltip
            event={hoveredEvent}
            position={{ x: 0, y: 0 }}
            onDelete={() => { if (hoveredEvent) { onEventDelete?.(hoveredEvent); setHoveredEvent(null); } }}
          />
```

- [ ] **Step 4: Add `handleEventDelete` in `App` and pass it down**

In `frontend/src/App.tsx`, change the events import:
```tsx
import { fetchEvents, updateEvent } from "@/api/events";
```
to:
```tsx
import { fetchEvents, updateEvent, deleteEvent } from "@/api/events";
```

Add the handler immediately after `handleEventUpdate` (after its closing `}, []);`):
```tsx
  const handleEventDelete = useCallback(async (event: CalendarEvent) => {
    setEvents((prev) => prev.filter((e) => e.id !== event.id));
    try {
      await deleteEvent(event.id);
    } catch {
      fetchEvents().then(setEvents).catch(() => {});
    }
  }, []);
```

Pass the prop to `GanttChart`. Change:
```tsx
            onEventUpdate={handleEventUpdate}
            onDeadlineUpdate={handleDeadlineUpdate}
          />
```
to:
```tsx
            onEventUpdate={handleEventUpdate}
            onDeadlineUpdate={handleDeadlineUpdate}
            onEventDelete={handleEventDelete}
          />
```

- [ ] **Step 5: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no tsc errors, no ESLint errors. (Behavior verified in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/gantt/EventTooltip.tsx frontend/src/components/gantt/GanttTeamEventStrip.tsx frontend/src/components/gantt/GanttChart.tsx frontend/src/App.tsx
git commit -m "feat: delete an event from its Gantt tooltip"
```

---

### Task 2: Deadline tooltip + Delete

**Files:**
- Create: `frontend/src/components/gantt/DeadlineTooltip.tsx`
- Modify: `frontend/src/components/gantt/DeadlineMarker.tsx` (hover tooltip + `onDelete`)
- Modify: `frontend/src/components/gantt/GanttChart.tsx` (`onDeadlineDelete` prop + wire `DeadlineMarker`)
- Modify: `frontend/src/App.tsx` (`handleDeadlineDelete` + import `deleteDeadline` + pass prop)

**Interfaces:**
- Consumes: `Deadline` (`@/types`); `deleteDeadline(id: string): Promise<void>` (`@/api/deadlines`); `fetchDeadlines` (already imported in App).
- Produces: `DeadlineTooltip` (`deadline`, `position`, `onDelete?`); `DeadlineMarker` prop `onDelete?: (deadline: Deadline) => void`; `GanttChart` prop `onDeadlineDelete?: (deadline: Deadline) => void`.

- [ ] **Step 1: Create `DeadlineTooltip`**

Create `frontend/src/components/gantt/DeadlineTooltip.tsx`:

```tsx
import type { Deadline } from "@/types";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface DeadlineTooltipProps {
  deadline: Deadline;
  position: { x: number; y: number };
  onDelete?: () => void;
}

const colorDot: Record<string, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
};

export function DeadlineTooltip({ deadline, position, onDelete }: DeadlineTooltipProps) {
  return (
    <div
      className="pt-2"
      style={{ marginLeft: position.x, marginTop: position.y }}
    >
    <div className="bg-white rounded-xl shadow-xl ring-1 ring-black/5 p-4 w-64 backdrop-blur-sm">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${colorDot[deadline.color] ?? "bg-red-500"}`} />
          <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Deadline</span>
        </div>
        <p className="text-[13px] text-gray-900 font-medium leading-snug">{deadline.title}</p>
        <div className="flex items-center gap-1 text-[11px] text-gray-500">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
            <path fillRule="evenodd" d="M4 1.75a.75.75 0 01.75.75V3h6.5V2.5a.75.75 0 011.5 0V3h.25A1.75 1.75 0 0114.75 4.75v8.5A1.75 1.75 0 0113 15H3A1.75 1.75 0 011.25 13.25v-8.5A1.75 1.75 0 013 3h.25V2.5A.75.75 0 014 1.75z" clipRule="evenodd" />
          </svg>
          {deadline.date}
        </div>
        {onDelete && (
          <Button variant="destructive" size="xs" className="w-full mt-1" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </Button>
        )}
      </div>
    </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a hover tooltip + `onDelete` to `DeadlineMarker`**

Replace the entire contents of `frontend/src/components/gantt/DeadlineMarker.tsx` with:

```tsx
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Deadline } from "@/types";
import { addDays, parseDate, shiftISODate } from "@/lib/dates";
import { useDayDrag } from "./useDayDrag";
import { DragDatePill } from "./DragDatePill";
import { DeadlineTooltip } from "./DeadlineTooltip";

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
  onDelete?: (deadline: Deadline) => void;
}

export function DeadlineMarker({ deadline, offset, lane, totalHeight, columnWidth, onUpdate, onDelete }: DeadlineMarkerProps) {
  const colors = deadlineColorMap[deadline.color] ?? deadlineColorMap.red!;
  const { dragging, dragOffset, daysMoved, dragPos, onMouseDown } = useDayDrag(
    columnWidth,
    (days) => onUpdate?.({ ...deadline, date: shiftISODate(deadline.date, days) }),
  );
  const liveOffset = offset + (dragging ? dragOffset : 0);

  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div className="absolute top-0 z-[8] pointer-events-none" style={{ left: liveOffset, height: totalHeight }}>
      <div className={`w-0.5 h-full ${colors.line} opacity-60`} style={{ marginLeft: -1 }} />
      <div className={`absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${colors.line} ring-2 ring-white shadow-sm`} />
      <div
        className={`absolute left-1 whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shadow-sm pointer-events-auto cursor-grab select-none ${dragging ? "cursor-grabbing ring-1 ring-indigo-400" : ""}`}
        style={{ top: 12 + lane * 18 }}
        onMouseDown={onMouseDown}
        onMouseEnter={(e) => {
          if (dragging) return;
          if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          const rect = e.currentTarget.getBoundingClientRect();
          setTooltipPos({ x: rect.left, y: rect.bottom });
          setHovered(true);
        }}
        onMouseLeave={() => {
          if (dragging) return;
          hoverTimeout.current = setTimeout(() => setHovered(false), 150);
        }}
      >
        {deadline.title}
      </div>
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(parseDate(deadline.date), daysMoved)} daysMoved={daysMoved} />
      )}
      {hovered && createPortal(
        <div
          className="fixed z-50"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          }}
          onMouseLeave={() => {
            hoverTimeout.current = setTimeout(() => setHovered(false), 150);
          }}
        >
          <DeadlineTooltip
            deadline={deadline}
            position={{ x: 0, y: 0 }}
            onDelete={onDelete ? () => { onDelete(deadline); setHovered(false); } : undefined}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the `onDeadlineDelete` prop to `GanttChart` and wire `DeadlineMarker`**

In `frontend/src/components/gantt/GanttChart.tsx`, change the props interface (it now ends with `onEventDelete` from Task 1):
```tsx
  onEventUpdate?: (event: CalendarEvent) => void;
  onDeadlineUpdate?: (deadline: Deadline) => void;
  onEventDelete?: (event: CalendarEvent) => void;
}
```
to:
```tsx
  onEventUpdate?: (event: CalendarEvent) => void;
  onDeadlineUpdate?: (deadline: Deadline) => void;
  onEventDelete?: (event: CalendarEvent) => void;
  onDeadlineDelete?: (deadline: Deadline) => void;
}
```

Change the component destructure (it ends with `onEventDelete` from Task 1):
```tsx
export function GanttChart({ members, tasks, events, deadlines = [], jiraBaseUrl = "", onTaskUpdate, onOpenTask, onEventUpdate, onDeadlineUpdate, onEventDelete }: GanttChartProps) {
```
to:
```tsx
export function GanttChart({ members, tasks, events, deadlines = [], jiraBaseUrl = "", onTaskUpdate, onOpenTask, onEventUpdate, onDeadlineUpdate, onEventDelete, onDeadlineDelete }: GanttChartProps) {
```

Pass it to each `DeadlineMarker`. Change:
```tsx
                <DeadlineMarker
                  key={dl.id}
                  deadline={dl}
                  offset={offset}
                  lane={lane}
                  totalHeight={totalBodyHeight}
                  columnWidth={columnWidth}
                  onUpdate={onDeadlineUpdate}
                />
```
to:
```tsx
                <DeadlineMarker
                  key={dl.id}
                  deadline={dl}
                  offset={offset}
                  lane={lane}
                  totalHeight={totalBodyHeight}
                  columnWidth={columnWidth}
                  onUpdate={onDeadlineUpdate}
                  onDelete={onDeadlineDelete}
                />
```

- [ ] **Step 4: Add `handleDeadlineDelete` in `App` and pass it down**

In `frontend/src/App.tsx`, change the deadlines import:
```tsx
import { fetchDeadlines, updateDeadline } from "@/api/deadlines";
```
to:
```tsx
import { fetchDeadlines, updateDeadline, deleteDeadline } from "@/api/deadlines";
```

Add the handler immediately after `handleDeadlineUpdate` (after its closing `}, []);`):
```tsx
  const handleDeadlineDelete = useCallback(async (deadline: Deadline) => {
    setDeadlines((prev) => prev.filter((d) => d.id !== deadline.id));
    try {
      await deleteDeadline(deadline.id);
    } catch {
      fetchDeadlines().then(setDeadlines).catch(() => {});
    }
  }, []);
```

Pass the prop to `GanttChart` (the block now ends with `onEventDelete` from Task 1):
```tsx
            onEventUpdate={handleEventUpdate}
            onDeadlineUpdate={handleDeadlineUpdate}
            onEventDelete={handleEventDelete}
          />
```
to:
```tsx
            onEventUpdate={handleEventUpdate}
            onDeadlineUpdate={handleDeadlineUpdate}
            onEventDelete={handleEventDelete}
            onDeadlineDelete={handleDeadlineDelete}
          />
```

- [ ] **Step 5: Type-check and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no tsc errors, no ESLint errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/gantt/DeadlineTooltip.tsx frontend/src/components/gantt/DeadlineMarker.tsx frontend/src/components/gantt/GanttChart.tsx frontend/src/App.tsx
git commit -m "feat: deadline hover tooltip with delete"
```

---

### Task 3: End-to-end verification (controller-run)

No code unless a defect is found. Verify in a real browser and confirm both suites are green.

**Files:** none (verification only).

- [ ] **Step 1: Frontend build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: PASS — no errors.

- [ ] **Step 2: Backend builds (unchanged)**

Run: `cd backend && go build ./...`
Expected: PASS.

- [ ] **Step 3: Start both servers (isolated data dir)**

Backend (background, isolated temp `DATA_DIR`): `DATA_DIR="$(mktemp -d)" PORT=8080 go -C backend run ./cmd/server`
Frontend (background): `npm --prefix frontend run dev`
Expected: backend `Server starting on :8080`; Vite on `http://localhost:5173`.

- [ ] **Step 4: Seed data**

Via `curl` (or the UI): add a member; a **personal** event for them (overlapping the visible range); a **team** event; and a **deadline** in range.

- [ ] **Step 5: Verify with Playwright MCP**

1. `browser_navigate` to `http://localhost:5173`.
2. Hover the personal event bar → the tooltip shows a **Delete** button → move into the tooltip and click it → the bar disappears from the chart; confirm via `GET /api/events` that it's gone.
3. Hover the team event cap → tooltip → Delete → the team band/cap disappears; confirm via `GET /api/events`.
4. Hover the deadline label → a **new tooltip** appears (color dot, title, date) → Delete → the deadline marker disappears; confirm via `GET /api/deadlines`.
5. Confirm no stray/empty tooltip remains after each delete.

- [ ] **Step 6: Stop the verification servers**

Stop the two background servers (kill the listeners on ports 8080 and 5173) and remove the temp data dir.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §2.1 events + deadlines get tooltip Delete; deadlines get a new tooltip | Task 1 (event), Task 2 (deadline tooltip) |
| §2.2 immediate delete, no confirm | Task 1/2 buttons call `onDelete` directly |
| §2.3 bottom destructive Delete button (Trash2 + "Delete") | Task 1 Step 1, Task 2 Step 1 |
| §2.4 frontend-only; DELETE routes already exist | No backend task; uses `deleteEvent`/`deleteDeadline` |
| §4.1 `EventTooltip` onDelete + button | Task 1 Step 1 |
| §4.2 new `DeadlineTooltip` | Task 2 Step 1 |
| §4.3 `DeadlineMarker` self-contained hover tooltip + onDelete, suppressed while dragging | Task 2 Step 2 |
| §4.4 `GanttTeamEventStrip` onEventDelete + clears hovered | Task 1 Step 2 |
| §4.5 `GanttChart` onEventDelete/onDeadlineDelete + wiring, clears hoveredEvent | Task 1 Step 3, Task 2 Step 3 |
| §4.6 App handlers (optimistic + refetch-on-failure) + wiring + imports | Task 1 Step 4, Task 2 Step 4 |
| §6 after delete clear hover state | Task 1 (setHovered/ setHoveredEvent null), Task 2 (setHovered false) |
| §7 build/lint + Playwright | Tasks 1–3 |
| §9 non-goals (no confirm, no backend, no other affordances) | Honored |

No gaps.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step shows complete file contents or exact before/after; commands list expected output. Frontend gates on `npm run build` + `npm run lint` (no unit runner, per Global Constraints); behavior verified in Task 3.

**3. Type consistency:** `onDelete?: () => void` on both tooltips; `onEventDelete?: (event: CalendarEvent) => void` on `GanttTeamEventStrip` and `GanttChart`; `onDeadlineDelete?: (deadline: Deadline) => void` on `GanttChart`; `DeadlineMarker.onDelete?: (deadline: Deadline) => void`; App `handleEventDelete(event: CalendarEvent)` / `handleDeadlineDelete(deadline: Deadline)`. The null-in-closure cases (`hoveredEvent` in `GanttTeamEventStrip` and `GanttChart`) are guarded with `if (hoveredEvent)` inside the handler so TS narrows correctly. `deleteEvent(id)` / `deleteDeadline(id)` match `@/api` signatures. `Button` `variant="destructive" size="xs"` and `Trash2` match existing usage (`EventPanel`).
