# Sticky Deadline Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Gantt deadline label stick just below the date/team-event header as the user scrolls down, instead of scrolling up out of view.

**Architecture:** Frontend-only, two interdependent files. `GanttChart.tsx` measures the sticky header's height with a `ResizeObserver` and passes it as `headerOffset` to each `DeadlineMarker`. `DeadlineMarker.tsx` makes its line + dot absolute and turns the label into a `position: sticky` element pinned at `headerOffset + 12 + lane*18` (with a matching `marginTop` so there is no jump at scroll 0). Lane stacking, drag, and the hover tooltip are unchanged; horizontal still tracks the date column.

**Tech Stack:** React 19 + TypeScript (strict) + Tailwind v4; `ResizeObserver`; existing helpers `useDayDrag`, `DragDatePill`, `DeadlineTooltip`.

## Global Constraints

- Strict TypeScript — NO `any` types (non-null assertions `x!` are acceptable; both files already use them).
- No frontend unit-test runner. Verification cycle: from `frontend/`, `npm run build` (`tsc -b` + `vite build`) and `npm run lint` (eslint) both clean, then **Playwright MCP** in a real browser (controller-run).
- **Scope is `GanttChart.tsx` + `DeadlineMarker.tsx` only.** Do NOT change the today marker, personal event bars, team caps, the deadline line/dot styling, the lane-packing algorithm, or deadline colors.
- The deadline line still spans full height; only the **label** gains sticky behavior. Sticky is vertical only — the label still scrolls horizontally with its column.
- Spec: `docs/superpowers/specs/2026-06-20-sticky-deadline-labels-design.md`.

---

## Setup (before Task 1)

- [ ] **Create a feature branch off `master`:**

```bash
git checkout -b feat/sticky-deadline-labels
```

### Verification environment (for the Playwright step)

The seed data has deadlines and enough rows to scroll. Run against an isolated copy:

```bash
cp -r backend/data /tmp/tp-sdl-data
cd backend && DATA_DIR=/tmp/tp-sdl-data PORT=8080 go run ./cmd/server   # terminal 1
cd frontend && npm run dev                                              # terminal 2 → http://localhost:5173
```

---

### Task 1: Sticky deadline labels

**Files:**
- Modify: `frontend/src/components/gantt/GanttChart.tsx`
- Modify: `frontend/src/components/gantt/DeadlineMarker.tsx`

**Interfaces:**
- Produces: `DeadlineMarker` gains a required prop `headerOffset: number` (px from the scroll-container top to the bottom of the sticky header).
- `GanttChart` measures the header height into state `headerHeight` and passes `headerOffset={headerHeight}` to every `DeadlineMarker`. No exported-signature change on `GanttChart`.

- [ ] **Step 1: `GanttChart.tsx` — add the header ref, `headerHeight` state, and a ResizeObserver**

`useEffect`/`useRef`/`useState` are already imported. Find this block (the ref/state cluster near the top of the component):

```tsx
  const scrollRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [exportingPng, setExportingPng] = useState(false);
```

Replace it with (adds `headerRowRef`, `headerHeight`, and the observer effect):

```tsx
  const scrollRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const headerRowRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [exportingPng, setExportingPng] = useState(false);

  // Measure the sticky header's height so deadline labels can stick just below
  // it. The ResizeObserver fires when the team-event strip appears/disappears or
  // its lane count changes, so no extra deps are needed.
  useEffect(() => {
    const el = headerRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    ro.observe(el);
    setHeaderHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
```

- [ ] **Step 2: `GanttChart.tsx` — attach the ref to the sticky header row**

Find:

```tsx
          {/* Header — pinned to the top while scrolling down */}
          <div className="sticky top-0 z-30 flex" style={{ width: SIDEBAR_WIDTH + totalWidth }}>
```

Replace with (add `ref={headerRowRef}`):

```tsx
          {/* Header — pinned to the top while scrolling down */}
          <div ref={headerRowRef} className="sticky top-0 z-30 flex" style={{ width: SIDEBAR_WIDTH + totalWidth }}>
```

- [ ] **Step 3: `GanttChart.tsx` — pass `headerOffset` to each `DeadlineMarker`**

Find the deadline markers map:

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
                  onDelete={onDeadlineDelete}
                />
              ))}
```

Replace with (add `headerOffset={headerHeight}`):

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
                  headerOffset={headerHeight}
                  onUpdate={onDeadlineUpdate}
                  onDelete={onDeadlineDelete}
                />
              ))}
```

- [ ] **Step 4: `DeadlineMarker.tsx` — add the `headerOffset` prop**

Find the props interface and the component signature:

```tsx
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
```

Replace with (add `headerOffset`):

```tsx
interface DeadlineMarkerProps {
  deadline: Deadline;
  /** Px from the left of the body to the deadline's day-center line. */
  offset: number;
  /** Vertical stacking lane (avoids label collisions). */
  lane: number;
  /** Full body height, so the line spans every row. */
  totalHeight: number;
  columnWidth: number;
  /** Px from the scroll-container top to the bottom of the sticky header, so the label sticks just below it. */
  headerOffset: number;
  onUpdate?: (deadline: Deadline) => void;
  onDelete?: (deadline: Deadline) => void;
}

export function DeadlineMarker({ deadline, offset, lane, totalHeight, columnWidth, headerOffset, onUpdate, onDelete }: DeadlineMarkerProps) {
```

- [ ] **Step 5: `DeadlineMarker.tsx` — line/dot → absolute, label → sticky**

Find the marker JSX (the line, dot, and label):

```tsx
    <div className="absolute top-0 z-[8] pointer-events-none" style={{ left: liveOffset, height: totalHeight }}>
      <div className={`w-0.5 h-full ${colors.line} opacity-60`} style={{ marginLeft: -1 }} />
      <div className={`absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${colors.line} ring-2 ring-white shadow-sm`} />
      <div
        className={`absolute left-1 whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shadow-sm pointer-events-auto cursor-grab select-none ${dragging ? "cursor-grabbing ring-1 ring-indigo-400" : ""}`}
        style={{ top: 12 + lane * 18 }}
        onMouseDown={onMouseDown}
```

Replace with (line + dot become `absolute`; label drops `absolute left-1`/inline `top`, gains `ml-1` and sticky styling):

```tsx
    <div className="absolute top-0 z-[8] pointer-events-none" style={{ left: liveOffset, height: totalHeight }}>
      <div className={`absolute top-0 bottom-0 w-0.5 ${colors.line} opacity-60`} style={{ marginLeft: -1 }} />
      <div className={`absolute -top-0.5 left-0 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${colors.line} ring-2 ring-white shadow-sm`} />
      <div
        className={`ml-1 whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shadow-sm pointer-events-auto cursor-grab select-none ${dragging ? "cursor-grabbing ring-1 ring-indigo-400" : ""}`}
        style={{ position: "sticky", top: headerOffset + 12 + lane * 18, marginTop: 12 + lane * 18 }}
        onMouseDown={onMouseDown}
```

Leave the rest of the label element (the `onMouseEnter`/`onMouseLeave` handlers, `{deadline.title}`), the `DragDatePill`, and the tooltip portal exactly as they are.

Rationale (do not add anything else): the line/dot are now `absolute` so the label is the marker's only in-flow child and can use `position: sticky`; the dot moves from `left-1/2` to `left-0` so it stays centered on the line now that the box width equals the label width (not ~2px). `marginTop` makes the un-stuck (scroll-0) position equal the stuck position, so there's no jump.

- [ ] **Step 6: Build & lint**

Run (from `frontend/`): `npm run build` then `npm run lint`
Expected: both PASS (no type errors; `position: "sticky"` is valid `React.CSSProperties`; no `any`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/gantt/GanttChart.tsx frontend/src/components/gantt/DeadlineMarker.tsx
git commit -m "feat: sticky deadline labels that stay below the header on scroll"
```

- [ ] **Step 8 (controller-run): Playwright verification**

With the dev servers running (see Setup), use Playwright MCP on the **Timeline** (ensure at least one deadline exists; the seed data has them):
1. At scroll top: each deadline label sits just below the header on its date column (unchanged look). Capture the label's `getBoundingClientRect().top` and the scroll container's, and the header height.
2. Set the scroll container's `scrollTop` to a large value (e.g. 300). Confirm the deadline label's viewport `top` stays ≈ `containerTop + headerHeight + 12 (+lane*18)` — i.e. it did NOT scroll away — while a normal row at the same content position did move up. Confirm the label is still horizontally on its date column (same `left` as the line).
3. With two deadlines close together, confirm their labels keep distinct lane offsets (no overlap) while stuck.
4. Confirm drag-to-reschedule still works (drag the label horizontally → date shifts) and hover still shows the `DeadlineTooltip` with Delete.
5. Set `scrollLeft` to a nonzero value and confirm the label moves left with its column (not horizontally pinned).
6. If any check fails, fix in `DeadlineMarker.tsx`/`GanttChart.tsx`, re-run build+lint, and amend/add a commit; otherwise done.

---

## Finalization

- [ ] `npm run build` + `npm run lint` clean once more from `frontend/`.
- [ ] Remove the throwaway data dir (`rm -rf /tmp/tp-sdl-data`).
- [ ] Use superpowers:finishing-a-development-branch to integrate (merge to `master`).

---

## Self-review notes (coverage check against the spec)

- Spec §4.1 (measure header height via ResizeObserver, pass `headerOffset`) → Steps 1–3.
- Spec §4.2 (line/dot absolute; label sticky with `top = headerOffset + 12 + lane*18` and matching `marginTop`; dot `left-0`; keep classes/drag/hover; `ml-1` left inset) → Steps 4–5.
- Spec §2.2 (vertical sticky only; horizontal tracks column) → Step 5 (no horizontal sticky) + Step 8.5 verification.
- Spec §2.3 (lane stacking preserved) → `lane*18` retained in Step 5; Step 8.3 verification.
- Spec §2.5 / Out-of-scope (today marker, personal bars, team caps, line/dot styling, lane algorithm, colors unchanged) → not touched.
- Spec §5 (PNG export unaffected — captures at scroll 0 where sticky = natural position) → no export code changed; sticky natural position equals today's top:12.
- Spec §6 (build, lint, Playwright) → Steps 6, 8.
