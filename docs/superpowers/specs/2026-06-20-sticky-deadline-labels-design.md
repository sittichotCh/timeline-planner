# Sticky Deadline Labels — Design

- **Date:** 2026-06-20
- **Status:** Approved (design)
- **Branch (suggested):** `feat/sticky-deadline-labels` (off `master`)
- **Scope:** Frontend only — `DeadlineMarker.tsx` + a small addition in `GanttChart.tsx`. No backend, API, type, or data changes.

## 1. Goal

In the Gantt timeline a deadline renders as a full-height vertical line with a small label near the top. Since the scroll-sync change the whole chart is one scroll container with a sticky header; when the user scrolls **down**, the deadline label (absolutely positioned at the top of the chart body) rides up with the rows and disappears under the sticky header — only the line remains.

Make each deadline label **stick** as the user scrolls down: it stays pinned **just below the date/team-event header**, always visible, while its line still spans the full height and the label stays on its date column (it scrolls horizontally with the column as today).

## 2. Decisions (locked during brainstorming, confirmed against a mockup)

1. **Sticky resting position = just below the header** (not flush at the very top over the header numbers). Confirmed via the side-by-side mockup.
2. **Vertical sticky only.** Horizontal behavior is unchanged: the label tracks its date column and scrolls left/right with the body (and slides under the sticky sidebar when its column does, as today).
3. **Lane stacking preserved.** The existing `deadlineLayout` lane assignment (in `GanttChart`) that offsets colliding labels downward is kept; sticky labels stack by lane just as they do today (`12 + lane*18`).
4. **Header offset is measured, not hard-coded.** The header height varies (date header alone vs. date header + team-event strip with a variable number of lanes), so the sticky `top` is derived from a measured header height, kept correct across team-event changes, zoom, and range changes.
5. **Scope = deadline labels only.** The today marker, personal event bars, team caps, and the deadline *line/dot* are unchanged (the line still spans full height; only the label gains sticky behavior).

## 3. Current behavior (`DeadlineMarker.tsx`)

```
<div absolute top-0 z-[8] pointer-events-none  left={liveOffset} height={totalHeight}>
  <div className="w-0.5 h-full {colors.line} opacity-60" marginLeft:-1 />          // line — IN FLOW (h-full)
  <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 ... {colors.line}" /> // dot — absolute
  <div className="absolute left-1 whitespace-nowrap text-[9px] ... {colors.bg/text}"// label — absolute
       style={{ top: 12 + lane*18 }} onMouseDown=drag onMouseEnter/Leave=tooltip>
    {deadline.title}
  </div>
  {dragging && <DragDatePill/>}
  {hovered && portal(<DeadlineTooltip/>)}
</div>
```

- The marker box has no explicit width; its only **in-flow** child is the line (`w-0.5`), so the box is ~2px wide. The dot is centered with `left-1/2` (≈ the line, given the ~2px box). The label is `absolute`, so it doesn't affect the box.
- The label's `top` is relative to the marker top, which sits at the chart-body top — i.e. ~12px below the header at scroll 0, and scrolls away above the header as you scroll down.

## 4. New behavior

### 4.1 `GanttChart.tsx` — measure header height, pass it down

- Add a ref to the existing sticky header row (`<div className="sticky top-0 z-30 flex" …>`), e.g. `headerRowRef`.
- Track its rendered height in state `headerHeight` (number, px), updated with a `ResizeObserver` in a `useEffect` (also recomputed implicitly when team events appear/disappear or lanes change, since those change the element's height). Initialize to `0`; the observer corrects it on first layout.
- Pass `headerOffset={headerHeight}` to each `<DeadlineMarker>`.

```tsx
const headerRowRef = useRef<HTMLDivElement>(null);
const [headerHeight, setHeaderHeight] = useState(0);
useEffect(() => {
  const el = headerRowRef.current;
  if (!el) return;
  const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
  ro.observe(el);
  setHeaderHeight(el.offsetHeight);
  return () => ro.disconnect();
}, []);
```

(Attach `ref={headerRowRef}` to the sticky header row div. The `ResizeObserver` fires on team-strip/lane/zoom-driven height changes, so no extra deps are needed.)

### 4.2 `DeadlineMarker.tsx` — sticky label

- New prop `headerOffset: number`.
- Restructure the marker's children so the **label** can be the sole in-flow child and use `position: sticky` (the line and dot become absolute so they don't push the label down):
  - **Line:** `absolute top-0 bottom-0 w-0.5 {colors.line} opacity-60` with `marginLeft:-1` (spans full height at the column, unchanged visually).
  - **Dot:** `absolute -top-0.5 left-0 -translate-x-1/2 …` (anchor to `left-0` instead of `left-1/2`, so it stays centered on the line now that the box width equals the label width).
  - **Label:** remove `absolute`; make it sticky:
    ```tsx
    style={{
      position: "sticky",
      top: headerOffset + 12 + lane * 18,   // stuck position: just below the header, lane-stacked
      marginTop: 12 + lane * 18,            // natural position matches, so no jump at scroll 0
    }}
    ```
    Keep its classes (`whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded {colors.bg} {colors.text} shadow-sm pointer-events-auto cursor-grab select-none` + dragging ring), the `onMouseDown` drag handler, and the hover handlers exactly as today. Replace the absolute `left-1` with `ml-1` (a 4px left inset, matching today's nudge); the inline `top` is replaced by the sticky `top` + `marginTop` above.
- `DragDatePill` and the `DeadlineTooltip` portal are unchanged.

**Why this works:** the marker div spans the full body height inside the single scroll container (`scrollRef`), with no intermediate `overflow`. A `position: sticky` label therefore pins relative to the scroll viewport, at `top = headerOffset + 12 + lane*18` (just under the sticky header), and only releases at the very bottom of the body — i.e. it stays visible the whole scroll. At scroll 0 the natural position (`marginTop`) equals the stuck position, so there is no visual jump. Horizontal scrolling moves the marker (and label) with its column, unchanged.

## 5. Consequences / edge cases

- **PNG export** resets scroll to 0,0 before capturing; at scroll 0 the sticky label renders at its natural position (just below the header), identical to today's output. Unaffected.
- **First paint:** `headerHeight` starts at 0 for one frame, so a label could momentarily sit ~12px from the very top before the observer sets the real height. Negligible (one frame on mount); acceptable.
- **Multiple deadlines:** lanes already prevent horizontal label overlap; since all labels stick into the same vertical band (as they already share the top band today), lane stacking remains correct and necessary.
- **Bottom of scroll:** as with any sticky element, the label detaches near the very bottom of the body (where the line ends anyway). Acceptable.

## 6. Testing & verification

- `npm run build` (tsc strict, no `any`) + `npm run lint` clean.
- Playwright (real browser) on the Timeline with at least one deadline:
  - At scroll top, the label sits just below the header on its date column (unchanged from today).
  - Scroll **down**: the label stays pinned just below the header (does not disappear), still horizontally on its column; the line still spans full height.
  - Two deadlines close together keep their lane offsets (no overlap) while stuck.
  - Drag-to-reschedule still works (drag the label horizontally → date shifts) and hover still shows the `DeadlineTooltip` with Delete.
  - Scroll **right**: the label moves with its column (not horizontally pinned).

## 7. Anticipated file changes

- `frontend/src/components/gantt/GanttChart.tsx` — `headerRowRef` + `headerHeight` state + `ResizeObserver`; pass `headerOffset` to `DeadlineMarker`.
- `frontend/src/components/gantt/DeadlineMarker.tsx` — `headerOffset` prop; line/dot → absolute; label → `position: sticky` with `top`/`marginTop`.

## 8. Out of scope

- The today marker, personal event bars, team-event caps, and the deadline line/dot styling.
- Any horizontal-sticky behavior for labels.
- Changing the lane-packing algorithm or deadline colors.
