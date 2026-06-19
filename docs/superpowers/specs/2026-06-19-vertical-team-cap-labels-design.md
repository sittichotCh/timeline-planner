# Vertical Team-Cap Labels — Design

- **Date:** 2026-06-19
- **Status:** Approved (design)
- **Branch (suggested):** `feat/vertical-team-cap-labels` (off `master`)
- **Scope:** Frontend only, and only `frontend/src/components/gantt/GanttTeamEventStrip.tsx`. No backend, API, type, or data changes.

## 1. Goal

Team-event "caps" in the Gantt header strip currently render their title as a
**horizontal single line** clipped to the event's date-span width, so short or
narrow team events (e.g. a 1-day "Deploy Server", or a long title on a 2-day
event) are unreadable. Re-render the cap label as **vertical (rotated) text**
that reads **bottom-to-top**, wrapping into additional vertical columns across
the cap's width, with each cap's height capped at a fixed maximum (96px) and any
overflow clipped. The full title remains available via the existing hover
tooltip.

## 2. Decisions (locked during brainstorming, confirmed against a mockup)

1. **Scope = team caps only.** `PersonalEventBars`, the full-height bands
   (`GanttMergedEventRow`), and the date header (`GanttHeader`) are unchanged.
2. **Orientation = vertical, reading bottom-to-top.** Rotated text (CSS
   `writing-mode: vertical-rl` + `transform: rotate(180deg)` — `sideways-lr`
   is Firefox-only, so it can't be used in this Chromium-targeted app).
3. **Wrapping:** the rotated text may wrap into multiple vertical columns across
   the cap's width; columns beyond the cap width are clipped.
4. **Height limit:** each cap is capped at **`MAX_CAP_HEIGHT = 96px`**. Overflow
   is a clean **clip** (`overflow: hidden`) — no "…" glyph (CSS `text-overflow`/
   `line-clamp` do not work on vertical wrapped text). Full title stays in the
   hover tooltip.
5. **Strip grows; no lane cap.** A taller cap makes the team-event strip taller;
   overlapping caps still stack in lanes; the strip grows to fit. (User
   explicitly accepted this over capping strip/lane count.)
6. **Working-day caps** keep the semi-opaque chip (`bg-background/85`) behind the
   (now vertical) text so it reads over the diagonal hatch.

## 3. Current behavior (`GanttTeamEventStrip.tsx`)

- Constants `LANE_HEIGHT = 20`, `LANE_GAP = 2`.
- `laid` (an IIFE) maps `teamEvents` → `{ ev, left, width, right }`, filters to
  the visible range, sorts by `left`, and assigns each a **lane** by horizontal
  overlap (`while (lane < laneRight.length && laneRight[lane] > it.left) lane++`).
- `laneCount = max(lane)+1`; strip `height = laneCount * (LANE_HEIGHT + LANE_GAP)`;
  outer `<div className="relative bg-card" style={{ width: totalWidth, height }}>`.
- Each `TeamEventCap` is absolutely positioned: `left = clippedLeft`,
  `width = clippedWidth`, `height = LANE_HEIGHT`,
  `top = height - (lane+1)*LANE_HEIGHT - lane*LANE_GAP` (lane 0 flush at the
  strip bottom, against the band; extra lanes stack upward). The cap box is
  `flex items-center border-2 border-b-0 border-dashed text-[10px] font-medium
  px-1.5 overflow-hidden whitespace-nowrap …`. Working-day caps wrap the text in
  a `bg-background/85 rounded px-1 truncate` chip.
- `useDayDrag` lets a cap be dragged to reschedule (shifts `left` by
  `dragOffset` while dragging); hover shows `EventTooltip` via a portal. **Both
  are unchanged by this design.**

## 4. New rendering

### 4.1 Cap height (uniform, content-driven, capped)

Compute one cap height for the whole strip from the longest title (no DOM
measurement — keeps the existing pure-data layout):

```
const MAX_CAP_HEIGHT = 96;
const MIN_CAP_HEIGHT = 24;     // keep a short-titled strip from collapsing
const CHAR_W = 6.5;            // ~px of vertical advance per char at text-[10px]; calibrate in impl
const V_PAD = 10;              // top+bottom padding inside the cap

// estimate the single-column height each title would need, take the largest,
// clamp to [MIN, MAX]. (When a title would exceed MAX it wraps into columns and
// fills MAX, so min(MAX, …) is the right cap either way.)
const capHeight = Math.min(
  MAX_CAP_HEIGHT,
  Math.max(MIN_CAP_HEIGHT, ...laid.map((it) => it.ev.title.length * CHAR_W + V_PAD)),
);
```

All caps share `capHeight` (aligned tops and bottoms). `CHAR_W` is an estimate
to be calibrated against the real font during implementation via Playwright
(target: a ~13-char title fits one column under 96px; a ~30-char title fills 96px
and wraps).

### 4.2 Strip + lane positioning

- `height = laneCount * (capHeight + LANE_GAP)` (replaces `LANE_HEIGHT` with
  `capHeight`).
- Lane assignment algorithm is **unchanged** (horizontal overlap).
- `TeamEventCap` height = `capHeight`;
  `top = height - (lane+1)*capHeight - lane*LANE_GAP` (lane 0 still flush at the
  bottom against the band).

### 4.3 Cap label element

- Cap box keeps `border-2 border-b-0 border-dashed`, the type `base`/`fill`
  colors, `overflow-hidden`, `cursor-grab`, drag handlers, and `left/width/top`
  positioning. Drop `whitespace-nowrap` and `flex items-center`; align the label
  toward the bottom/start so reading begins at the band edge (e.g. `flex
  items-end`).
- The title text is a span styled for bottom-to-top vertical flow:
  ```
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  max-height: <capHeight>px;   // (the cap box already caps height; belt-and-suspenders)
  overflow: hidden;            // clip beyond height/width — no ellipsis
  ```
  Wrapping is left enabled (no `whitespace-nowrap`) so long titles flow into
  extra columns across the cap width; the box's `overflow: hidden` clips columns
  past the cap width and text past `capHeight`.
- **Working-day caps:** keep the `bg-background/85 rounded px-1` chip around the
  vertical text (drop `truncate`, which is horizontal-only) so it stays legible
  over the hatch.

### 4.4 Unchanged

Drag-to-reschedule (`useDayDrag` + `DragDatePill`), hover `EventTooltip` (full
title + delete), lane overlap logic, cap colors, and the dashed connection into
the band below. The cap **width** is still the event's date-span width.

## 5. Consequences / edge cases

- The team-event strip (inside the sticky Gantt header since the scroll-sync
  change) becomes taller — up to ~`(96+gap)px` per lane. Accepted.
- Very long titles clip with no ellipsis glyph; hover tooltip carries the full
  title (existing behavior).
- A strip whose events all have short titles uses a smaller `capHeight` (down to
  `MIN_CAP_HEIGHT`), so it won't reserve the full 96px unnecessarily.
- Empty title falls back to the event type label (existing `title || type`).

## 6. Testing & verification

- `npm run build` (tsc strict, no `any`) + `npm run lint` clean.
- Playwright (real browser): on the Timeline with overlapping team events,
  confirm cap labels render **vertically, reading bottom-to-top**; a short title
  (e.g. "Deploy Server") is fully legible; a long title fills ~96px and
  wraps/clip­s; caps stay column-aligned with their date span and still connect
  into the band; hover still shows the full-title tooltip; drag-to-reschedule
  still works. Calibrate `CHAR_W` so the height estimate matches the rendered
  text (no large empty gap, no premature clip).

## 7. Anticipated file changes

- `frontend/src/components/gantt/GanttTeamEventStrip.tsx` — height constants +
  `capHeight` computation; strip/lane positioning uses `capHeight`; cap label
  span switches to vertical (bottom-to-top) wrapping with clip; working-day chip
  retained.

(No other files; `GanttChart.tsx` simply renders the strip and is unaffected.)

## 8. Out of scope

- Personal event bar labels, the full-height team bands, and the date header.
- A visible ellipsis for clipped vertical text (would need JS measurement).
- Per-cap (non-uniform) heights, and any cap-width change (caps still span the
  event's date range).
- Capping the strip height / lane count.
