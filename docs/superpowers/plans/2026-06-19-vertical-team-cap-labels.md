# Vertical Team-Cap Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Gantt team-event cap labels as vertical (rotated) text reading bottom-to-top, wrapping into columns across the cap width, with each cap capped at 96px and overflow clipped.

**Architecture:** Frontend-only, single file (`GanttTeamEventStrip.tsx`). Replace the fixed 20px horizontal cap with a content-driven, uniform `capHeight` (≤96px) used for both strip layout and each cap box; switch the label text to `writing-mode: vertical-rl` + `transform: rotate(180deg)` with wrapping + clip. Layout stays pure-data (no DOM measurement); the per-character height estimate `CHAR_W` is calibrated in the browser.

**Tech Stack:** React 19 + TypeScript (strict) + Tailwind v4; existing helpers `useDayDrag`, `hatchBackground`, `EventTooltip`, `DragDatePill`.

## Global Constraints

- Strict TypeScript — NO `any` types (non-null assertions `x!` are acceptable; the file already uses them).
- No frontend unit-test runner. Verification cycle: from `frontend/`, `npm run build` (`tsc -b` + `vite build`) and `npm run lint` (eslint) both clean, then **Playwright MCP** in a real browser (calibrate `CHAR_W`, confirm orientation/wrap/clip/drag/tooltip).
- **Scope is `frontend/src/components/gantt/GanttTeamEventStrip.tsx` only.** Do NOT change `PersonalEventBars`, `GanttMergedEventRow`, `GanttHeader`, `GanttChart`, or any other file.
- Keep drag-to-reschedule (`useDayDrag`), the hover `EventTooltip` (full title + delete), the lane-overlap algorithm, cap colors, and the dashed band connection unchanged. Cap **width** stays the event's date-span width.
- Spec: `docs/superpowers/specs/2026-06-19-vertical-team-cap-labels-design.md`.

---

## Setup (before Task 1)

- [ ] **Create a feature branch off `master`:**

```bash
git checkout -b feat/vertical-team-cap-labels
```

### Verification environment (for the Playwright step)

The existing seed data has overlapping team events (releases, cutoffs, smoke tests), which is what we need. Run against an isolated copy so nothing real is touched:

```bash
cp -r backend/data /tmp/tp-vcap-data
cd backend && DATA_DIR=/tmp/tp-vcap-data PORT=8080 go run ./cmd/server   # terminal 1
cd frontend && npm run dev                                               # terminal 2 → http://localhost:5173
```

---

### Task 1: Vertical bottom-to-top team-cap labels

**Files:**
- Modify: `frontend/src/components/gantt/GanttTeamEventStrip.tsx`

**Interfaces:**
- No exported-signature change. `GanttTeamEventStrip` keeps its props; `GanttChart` renders it unchanged.
- Internal: `TeamEventCapProps` gains `capHeight: number`.

- [ ] **Step 1: Replace the height constants with the vertical-cap constants**

In `frontend/src/components/gantt/GanttTeamEventStrip.tsx`, find:

```tsx
const LANE_HEIGHT = 20;
const LANE_GAP = 2;
```

Replace with:

```tsx
const LANE_GAP = 2;
const MAX_CAP_HEIGHT = 96;   // hard ceiling for a cap's height (spec §4)
const MIN_CAP_HEIGHT = 24;   // floor so a short-titled strip stays a visible cap
const V_PAD = 10;            // vertical padding budget inside a cap
const CHAR_W = 6.5;          // ~px of vertical advance per char at text-[10px]; CALIBRATE in Step 7
```

- [ ] **Step 2: Compute a uniform `capHeight` and use it for the strip height**

In the `GanttTeamEventStrip` component, find the lane/height computation:

```tsx
  const laneCount = laid.reduce((m, it) => Math.max(m, it.lane + 1), 0);
  const height = laneCount * (LANE_HEIGHT + LANE_GAP);
```

Replace with:

```tsx
  const laneCount = laid.reduce((m, it) => Math.max(m, it.lane + 1), 0);
  // One uniform cap height for the whole strip: tall enough for the longest
  // title's single rotated column, clamped to [MIN, MAX]. A title longer than
  // MAX wraps into extra columns and fills MAX, so min(MAX, …) is correct either
  // way. Pure-data estimate (no DOM measure); CHAR_W is calibrated in the browser.
  const capHeight = Math.min(
    MAX_CAP_HEIGHT,
    Math.max(MIN_CAP_HEIGHT, ...laid.map((it) => it.ev.title.length * CHAR_W + V_PAD)),
  );
  const height = laneCount * (capHeight + LANE_GAP);
```

(`Math.max(MIN_CAP_HEIGHT, ...[])` is `MIN_CAP_HEIGHT` when `laid` is empty, which is harmless since `laneCount` is then 0 and the strip renders nothing.)

- [ ] **Step 3: Pass `capHeight` into each cap**

Find the cap map in the returned JSX:

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

Add the `capHeight` prop:

```tsx
      {laid.map((it) => (
        <TeamEventCap
          key={it.ev.key}
          item={it}
          height={height}
          capHeight={capHeight}
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

- [ ] **Step 4: Add `capHeight` to `TeamEventCapProps`**

Find:

```tsx
interface TeamEventCapProps {
  item: LaidTeamEvent;
  height: number;
  columnWidth: number;
  totalWidth: number;
  onEventUpdate?: (event: CalendarEvent) => void;
  onHover: (ev: TeamEvent, x: number, y: number) => void;
  onLeave: () => void;
}
```

Replace with:

```tsx
interface TeamEventCapProps {
  item: LaidTeamEvent;
  height: number;
  capHeight: number;
  columnWidth: number;
  totalWidth: number;
  onEventUpdate?: (event: CalendarEvent) => void;
  onHover: (ev: TeamEvent, x: number, y: number) => void;
  onLeave: () => void;
}
```

- [ ] **Step 5 (code): Rewrite `TeamEventCap` to position by `capHeight` and render a vertical, bottom-to-top, wrapping, clipped label**

Find the whole `TeamEventCap` function:

```tsx
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
        counts_as_working_day: item.ev.counts_as_working_day,
      }),
  );

  const offset = dragging ? dragOffset : 0;
  const left = item.left + offset;
  const right = item.right + offset;
  const clippedLeft = Math.max(0, left);
  const clippedWidth = Math.min(right, totalWidth) - clippedLeft;
  // lane 0 sits flush at the bottom (capping the band); extra lanes stack upward
  const top = height - (item.lane + 1) * LANE_HEIGHT - item.lane * LANE_GAP;
  const working = item.ev.counts_as_working_day;
  const base = capBase[item.ev.type] ?? capBase.other;
  const fill = working ? "" : (capFill[item.ev.type] ?? capFill.other);

  return (
    <>
      <div
        className={`absolute flex items-center border-2 border-b-0 border-dashed text-[10px] font-medium px-1.5 overflow-hidden whitespace-nowrap cursor-grab select-none ${dragging ? "cursor-grabbing z-20 opacity-90" : ""} ${base} ${fill}`}
        style={{ left: clippedLeft, width: clippedWidth, top, height: LANE_HEIGHT, ...(working ? { backgroundImage: hatchBackground(item.ev.type) } : {}) }}
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
        {working ? (
          <span className="bg-background/85 rounded px-1 truncate">{item.ev.title || item.ev.type}</span>
        ) : (
          item.ev.title || item.ev.type
        )}
      </div>
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(parseDate(item.ev.start_date), daysMoved)} daysMoved={daysMoved} />
      )}
    </>
  );
}
```

Replace it with (changes: `capHeight` in props; `top`/box `height` use `capHeight`; box is `flex items-end justify-start` (anchor toward the band/start), no `whitespace-nowrap`; the label is always a span with vertical bottom-to-top writing mode, wrapping, and clip; working-day chip retained):

```tsx
function TeamEventCap({ item, height, capHeight, columnWidth, totalWidth, onEventUpdate, onHover, onLeave }: TeamEventCapProps) {
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
        counts_as_working_day: item.ev.counts_as_working_day,
      }),
  );

  const offset = dragging ? dragOffset : 0;
  const left = item.left + offset;
  const right = item.right + offset;
  const clippedLeft = Math.max(0, left);
  const clippedWidth = Math.min(right, totalWidth) - clippedLeft;
  // lane 0 sits flush at the bottom (capping the band); extra lanes stack upward
  const top = height - (item.lane + 1) * capHeight - item.lane * LANE_GAP;
  const working = item.ev.counts_as_working_day;
  const base = capBase[item.ev.type] ?? capBase.other;
  const fill = working ? "" : (capFill[item.ev.type] ?? capFill.other);

  return (
    <>
      <div
        className={`absolute flex items-end justify-start border-2 border-b-0 border-dashed text-[10px] font-medium px-1 py-1 overflow-hidden cursor-grab select-none ${dragging ? "cursor-grabbing z-20 opacity-90" : ""} ${base} ${fill}`}
        style={{ left: clippedLeft, width: clippedWidth, top, height: capHeight, ...(working ? { backgroundImage: hatchBackground(item.ev.type) } : {}) }}
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
        <span
          className={`overflow-hidden ${working ? "bg-background/85 rounded px-0.5" : ""}`}
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: capHeight }}
        >
          {item.ev.title || item.ev.type}
        </span>
      </div>
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(parseDate(item.ev.start_date), daysMoved)} daysMoved={daysMoved} />
      )}
    </>
  );
}
```

- [ ] **Step 6: Build & lint**

Run (from `frontend/`): `npm run build` then `npm run lint`
Expected: both PASS. (`writingMode: "vertical-rl"` and `transform` are valid `React.CSSProperties`; no `any`.) Confirm the removed `LANE_HEIGHT` constant has no remaining references: `git grep -n LANE_HEIGHT frontend/src` returns nothing.

- [ ] **Step 7: Playwright verify + calibrate `CHAR_W`**

With the dev servers running (see Setup), use Playwright MCP on the **Timeline**:
1. Confirm team-event cap labels now render **vertically and read bottom-to-top** (rotate by reading: the title's first character is at the **bottom**, last at the top). If it reads top-to-bottom, the rotation is wrong — adjust (e.g. remove the `rotate(180deg)`, or switch anchor) and rebuild.
2. Confirm a short title (e.g. "Deploy Server") is fully legible in one column; a long title (e.g. "POS Owner 2.121.0 - Release (10%)") fills ~96px and wraps into additional columns across the cap width, with overflow clipped (no "…").
3. **Calibrate `CHAR_W`:** measure a representative cap. With `browser_evaluate`, for a known mid-length title's cap, read its label span `scrollHeight` vs `clientHeight`. If short titles show a large empty gap above the text (cap much taller than the text), `CHAR_W` is too high — lower it (try 5.5, 5.0). If a title that should fit one column is clipping with width to spare, `CHAR_W` is too low — raise it. Re-run `npm run build` after any change and re-check. Stop when short titles sit snugly and only genuinely-long titles hit the 96px clip.
4. Confirm caps stay column-aligned with their date span and still connect into the dashed band below; the strip grew taller to fit.
5. Confirm **drag-to-reschedule** still works (drag a cap horizontally → its dates shift) and **hover** still shows the `EventTooltip` with the full title + Delete.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/gantt/GanttTeamEventStrip.tsx
git commit -m "feat: vertical bottom-to-top team-event cap labels"
```

---

## Finalization

- [ ] `npm run build` + `npm run lint` clean once more from `frontend/`.
- [ ] Remove the throwaway data dir (`rm -rf /tmp/tp-vcap-data`).
- [ ] Use superpowers:finishing-a-development-branch to integrate (merge to `master`).

---

## Self-review notes (coverage check against the spec)

- Spec §2.1 scope (team caps only) → Global Constraints + single-file Task 1.
- Spec §2.2 bottom-to-top rotation → Step 5 (`writing-mode: vertical-rl` + `rotate(180deg)`), Step 7.1 verification.
- Spec §2.3 wrap into columns → Step 5 (no `whitespace-nowrap`; span `overflow-hidden`), Step 7.2.
- Spec §2.4 96px cap + clip, no ellipsis → `MAX_CAP_HEIGHT`, span `overflow-hidden`, Step 7.2.
- Spec §2.5 strip grows, lane stacking unchanged → Step 2 (`height` uses `capHeight`), Step 5 (`top` uses `capHeight`), lane algorithm untouched.
- Spec §2.6 working-day chip retained → Step 5 (`bg-background/85` span).
- Spec §4.1 uniform content-driven `capHeight` with MIN/MAX/CHAR_W/V_PAD → Steps 1–2; calibration → Step 7.3.
- Spec §4.4 drag + tooltip + colors + band unchanged → preserved in Step 5; Step 7.5 verifies.
- Spec §6 testing (build, lint, Playwright, calibration) → Steps 6–7.
