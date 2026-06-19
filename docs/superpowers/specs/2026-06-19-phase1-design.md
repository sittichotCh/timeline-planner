# Phase 1 — Imports Page + Gantt Scroll-Sync — Design

- **Date:** 2026-06-19
- **Status:** Approved (design)
- **Branch (suggested):** `feat/phase1-imports-page-scroll-sync` (off `master`)
- **Scope:** Frontend only. No backend, store, or API changes.

## 1. Goals

Two independent changes bundled as "Phase 1" (`phase1.md`):

1. **Imports page.** Replace the right-side slide-over import panel with a
   full **page** (alongside Timeline / Tasks / Jira Sync) that lists the parsed
   CSV records in an **inline-editable table** and lets the user **select which
   records to import** — instead of today's all-or-nothing commit.
2. **Gantt scroll-sync bug.** When scrolling the timeline right, the header
   (date labels + team-event caps) lags/desyncs from the body grid. Fix by
   collapsing the header and body into a **single scroll container** with a
   sticky header and sticky sidebar, so both axes sync natively (no JS).

The two parts share no code and can be implemented and verified independently.

## 2. Decisions (locked during brainstorming)

1. **Imports layout = inline-editable table.** One row per parsed record; per-row
   config edited inline (Kind/Scope/Type/Working-day/Members); Title & Dates
   read-only from the CSV.
2. **Selection model:** checkbox per row + Select-all; `Import Selected (n)` and
   `Import All`. Valid rows are **pre-selected** by default.
3. **Deadline color stays global** (one picker in the toolbar, applied to all
   deadline rows) — no per-row color column. Preserves current behavior and
   keeps the table from gaining a column that is empty for event rows.
4. **Import moves to the page nav group**; the slide-over panel is removed.
5. **Scroll fix = unify containers** (sticky header + sticky sidebar in one
   `overflow-auto` scroller). Not the smaller rAF/transform patch.
6. The backend import endpoints (`POST /api/import/preview`, `POST /api/import`)
   and `api/import.ts` (`previewCsv`, `commitImport`) are **reused unchanged**.

---

# Part A — Imports page

## A1. Current behavior being replaced

- `ImportPanel.tsx` is a `Sheet` slide-over, opened from `App`'s `panel` state
  (`panelItems` includes `import`). It previews rows as **cards** with rich
  per-row config and commits **all valid rows** at once (no selection).
- The pure helpers it owns — `RowConfig`/`EditRow` types, `defaultConfig`,
  `rowValid`, `rowHint`, `eventTypes`, `colorOptions`, `SAMPLE_CSV`,
  `downloadSample` — are the validation/shape logic we keep.

## A2. Navigation changes (`App.tsx`)

- `PageView` → `"timeline" | "tasks" | "jira" | "import"`.
- `SlidePanel` → `"members" | "events" | "deadlines" | null` (drop `"import"`).
- Add `{ key: "import", label: "Import", icon: Upload }` to `pageItems`; remove
  the `import` entry from `panelItems`.
- In `<main>`, add a `page === "import"` branch rendering
  `<ImportPage members={members} onImported={...} />`. The `onImported` callback
  is the existing one (refetch events + deadlines):
  ```ts
  onImported={() => {
    Promise.all([fetchEvents(), fetchDeadlines()])
      .then(([e, d]) => { setEvents(e); setDeadlines(d); })
      .catch(() => {});
  }}
  ```
- Remove the `{panel === "import" && <ImportPanel .../>}` block, the `ImportPanel`
  import, and (now unused) the `Upload` icon stays (reused by the page nav item).

## A3. New component `ImportPage.tsx`

Page chrome modeled on `JiraSyncPage` (`h-full flex flex-col`, toolbar →
selection bar → scrollable table). Props:

```ts
interface ImportPageProps {
  members: Member[];
  onImported: () => void;
}
```

**Local state**

- `file: File | null`, `rows: EditRow[]`, `parseErrors: ImportRowError[]`
- `deadlineColor: string` (default `"red"`)
- `selected: Set<number>` — indices of rows checked for import
- `imported: Set<number>` — indices already committed (locked, shown as
  "Imported")
- `busy`, `error: string | null`, `result: ImportResult | null`

The pure helpers (`EditRow`, `RowConfig`, `defaultConfig`, `rowValid`,
`rowHint`, `eventTypes`, `colorOptions`, `SAMPLE_CSV`, `downloadSample`) move
from `ImportPanel.tsx` into `ImportPage.tsx` (kept local to the component, as the
panel did — no shared lib needed since the panel is deleted).

**On file select:** call `previewCsv(f)`; set `rows` from preview, `parseErrors`
from preview errors; **pre-select all valid rows** (`selected` = indices where
`rowValid(row)`); clear `imported`/`result`/`error`.

**Toolbar (top, `border-b bg-card`)**

- Title "Import".
- "Sample CSV" download button (`downloadSample`).
- "Choose CSV file…" button + hidden file input (same as today).
- **Deadline color** swatch picker — shown only when ≥1 non-imported row has
  `kind === "deadline"`; sets `deadlineColor`, applied to all deadline rows on
  commit.

**Selection bar** (shown when `rows.length > 0`, modeled on JiraSyncPage's bulk
bar)

- **Select all** checkbox: checked when every selectable row is selected;
  toggles all selectable rows. *Selectable* = valid AND not already imported.
- Count badge (e.g. `2 of 5`).
- `Import Selected (n)` — `n` = count of selected, valid, not-imported rows;
  disabled when `n === 0` or `busy`.
- `Import All` — commits all valid, not-imported rows regardless of selection;
  disabled when none or `busy`.

**Table** (`flex-1 overflow-auto`)

| Col | Content | Editable | Notes |
|-----|---------|----------|-------|
| ☑ | selection checkbox | yes | disabled if row invalid or imported; header = Select-all |
| Title | `row.data.title` | read-only | |
| Dates | `start → end` (`end` blank ⇒ just `start`) | read-only | |
| Kind | Event / Deadline | dropdown | flips `cfg.kind` |
| Scope | Personal / Team | dropdown | event rows only; `—` otherwise |
| Type | Leave / Oncall / Holiday / Other | dropdown | event rows only; `—` otherwise |
| Work-day | checkbox (`counts_as_working_day`) | checkbox | event rows only; `—` otherwise |
| Members | multi-select popover | popover | event + personal only; `—` for team/deadline |
| Status | hint / "Imported" | — | `rowHint(row)` for invalid event rows; "Imported" badge once committed |

- Inactive cells (by kind/scope) render a muted `—`.
- Editing a row recomputes its validity; if it becomes invalid it is removed
  from `selected`, if it becomes valid it is **not** auto-added (user re-checks).
  (Initial pre-selection is the only automatic selection.)

**Members popover (`MemberMultiSelect`, small local sub-component)**

- A button in the cell showing the selection (e.g. "2 members" or first
  name + `+N`; "Select…" when empty).
- On click, an absolutely-positioned dropdown lists members as checkboxes
  (toggle `cfg.member_emails`). Closes on outside click (a fixed transparent
  backdrop) or Esc. No new UI primitive required — built with `useState` open +
  a backdrop, styled with Tailwind to match existing dropdowns.
- Empty-members hint deferred to the row's Status cell via `rowHint`.

**Import flow**

- Build `events[]` / `deadlines[]` exactly as `ImportPanel.handleImport` does
  (team events send `member_emails: []`; deadlines use `deadlineColor` and the
  row's `start_date` as `date`) — but only from the **target set** of row
  indices (selected-and-valid for `Import Selected`; all-valid for `Import All`),
  excluding already-imported rows.
- `await commitImport({ events, deadlines })`; on success: add the committed
  indices to `imported`, drop them from `selected`, set `result`, and call
  `onImported()` when `imported_events + imported_deadlines > 0`.
- Errors → `error` banner (same styling as today). The file stays loaded so the
  user can import remaining rows.

**Constraints:** strict TypeScript, no `any` (CLAUDE.md).

## A4. Delete `ImportPanel.tsx`

Removed entirely (replaced by `ImportPage.tsx`).

## A5. Out of scope (Part A)

- Editing Title/Dates inline (read-only from CSV — unchanged).
- Per-row deadline color (global picker kept).
- Bulk "apply config to selected rows" (purely per-row — the rejected layout
  option).
- Any backend / `api/import.ts` change.

---

# Part B — Gantt scroll-sync fix

## B1. Root cause

`GanttChart.tsx` renders the header (`GanttHeader` + `GanttTeamEventStrip`) in an
`overflow-hidden` div (`headerScrollRef`) and the body grid in a separate
`overflow-auto` div (`chartRef`). `handleChartScroll` imperatively mirrors
`chartRef.scrollLeft → headerScrollRef.scrollLeft` (and
`chartRef.scrollTop → sidebarRef.scrollTop`). This JS mirroring is what visibly
lags/desyncs the header when scrolling right.

## B2. Target structure — one scroll container

Collapse the header strip, sidebar, and chart into a **single** `overflow-auto`
scroll container; pin the header with `sticky top-0` and the sidebar with
`sticky left-0`. The top bar (zoom / date range / export buttons) is unchanged.

```
<div className="flex flex-col h-full">
  <topbar/>  {/* unchanged */}

  <div ref={scrollRef} className="flex-1 overflow-auto">
    <div ref={captureRef} className="relative"
         style={{ width: SIDEBAR_WIDTH + totalWidth }}>

      {/* Header row — pinned to top while scrolling down */}
      <div className="sticky top-0 z-30 flex"
           style={{ width: SIDEBAR_WIDTH + totalWidth }}>
        <div className="sticky left-0 z-40 flex-shrink-0 border-r border-b bg-card flex items-end px-3 pb-1"
             style={{ width: SIDEBAR_WIDTH }}>
          <span ...>Member / Task</span>
        </div>
        <div style={{ width: totalWidth }}>
          <GanttHeader dates={dates} columnWidth={columnWidth} />
          {team.length > 0 && <GanttTeamEventStrip ... />}
        </div>
      </div>

      {/* Body row */}
      <div className="flex" style={{ width: SIDEBAR_WIDTH + totalWidth }}>
        <div className="sticky left-0 z-20 flex-shrink-0 border-r bg-card"
             style={{ width: SIDEBAR_WIDTH }}>
          {rows.map(/* sidebar member/task rows — unchanged markup */)}
        </div>
        <div className="relative" style={{ width: totalWidth, minHeight: totalBodyHeight }}>
          {/* grid, team overlays, personal overlays, deadline markers,
              today marker, row content — all unchanged, still positioned
              relative to this chart div */}
        </div>
      </div>

    </div>
  </div>

  {hoveredEvent && createPortal(...)}  {/* unchanged */}
</div>
```

**z-index layering** (so pinned chrome covers scrolling content):
corner `z-40` > header `z-30` > sidebar `z-20` > today/deadline overlays `z-10`
> row content `z-[1]`. The sticky sidebar's opaque `bg-card` hides bars/markers
sliding underneath it.

`GanttHeader.tsx` and `GanttTeamEventStrip.tsx` are **unchanged** — they simply
render inside the new sticky header.

## B3. Refs & handlers to change

- **Remove:** `headerScrollRef`, `sidebarRef`, `bodyWrapperRef`, `timelineRef`,
  `handleChartScroll`, and the `onScroll` wiring. (`timelineRef` — today the
  outer `flex-1 overflow-hidden flex flex-col` wrapper and the PNG `container` —
  is superseded by `scrollRef`/`captureRef`.)
- **Keep one scroller ref** `scrollRef` (replaces `chartRef`) and add
  `captureRef` for the inner content wrapper (used by PNG export).
- **Initial scroll `useEffect` + `scrollToToday`:** now operate on the single
  `scrollRef`. Because the chart content begins at content-x `SIDEBAR_WIDTH`
  (the sticky sidebar overlays the left `SIDEBAR_WIDTH` of the viewport), the
  scroll math must account for the sidebar:
  - visible chart width = `scrollRef.clientWidth - SIDEBAR_WIDTH`
  - to place `todayOffset` ~⅓ into the visible chart:
    `scrollLeft = SIDEBAR_WIDTH + todayOffset - (scrollRef.clientWidth - SIDEBAR_WIDTH) / 3`
    (clamped at 0), and the equivalent adjustment for the first-task branch.
  - `scrollToToday` uses the same formula with `behavior: "smooth"`.

## B4. PNG export (`exportPng.ts` + `handlePngExport`)

Single-container capture replaces the four-container expansion:

- New `PngCaptureRefs` = `{ container: HTMLElement /* captureRef inner wrapper */,
  scroller: HTMLElement /* scrollRef */, totalWidth, totalBodyHeight,
  sidebarWidth }`.
- Capture steps: snapshot the scroller's inline style; set the scroller to
  `overflow: visible`, `height: auto`, and scroll it to `0,0`; `toPng(container,
  { width: container.scrollWidth, height: container.scrollHeight, ... })` (keep
  `backgroundColor`, `pixelRatio: 2`, `cacheBust`, `skipFonts`); restore.
- At scroll `0,0`, `sticky top-0`/`left-0` elements sit at their natural
  top-left positions, so the captured image shows the full timeline with the
  header on top and the sidebar on the left — same output as today.
- `handlePngExport` passes `captureRef.current` + `scrollRef.current` and the
  existing dimensions; drop the removed refs.

> **Risk note:** PNG export is the one area touched by the refactor. It must be
> visually verified after the change (see B5). If `html-to-image` mishandles the
> sticky children in the clone, the fallback is to temporarily neutralize sticky
> (`position: static`) on the header/sidebar during capture — at scroll 0 this
> is a visual no-op.

## B5. Out of scope (Part B)

- Changing column widths, zoom, date-range, or any visual styling of the
  timeline beyond the scroll-container restructure.
- Touching `GanttHeader`, `GanttTeamEventStrip`, `TaskBar`, markers, or overlay
  components.

---

## 3. Testing & verification

**Part A (Imports page)**

- `npm run build` (tsc strict) + `npm run lint` clean.
- Playwright round-trip (isolated `DATA_DIR`): open the **Import** page; upload a
  mixed CSV; confirm the table lists each row with editable Kind/Scope/Type/
  Work-day/Members and read-only Title/Dates; confirm an invalid event row
  (personal, no member) shows a hint and its checkbox is disabled; set a row to
  Deadline and pick a color; **deselect** one valid row, click `Import Selected`,
  and verify only the selected rows landed (events/deadlines appear on the
  Timeline) while the deselected row did not; confirm imported rows flip to
  "Imported" and the result summary shows; confirm a bad CSV line appears in the
  skipped list.

**Part B (scroll-sync)**

- `npm run build` + `npm run lint` clean.
- Playwright: scroll the timeline **right** and confirm the date labels and
  team-event caps stay column-aligned with the body grid (no lag/offset); scroll
  **down** and confirm the header and the member/task sidebar stay pinned;
  spot-check that the Today marker and a deadline marker remain aligned to their
  columns; click **PNG** and confirm the exported image contains the full
  timeline (header on top, sidebar on left, all rows/columns).

## 4. Anticipated file changes

**Frontend (only)**

- `frontend/src/App.tsx` — move Import to page nav; render `ImportPage`; remove
  the `ImportPanel` slide-over wiring.
- `frontend/src/components/ImportPage.tsx` — **new** (inline-editable table +
  selection).
- `frontend/src/components/ImportPanel.tsx` — **deleted**.
- `frontend/src/components/gantt/GanttChart.tsx` — unify into one scroll
  container with sticky header + sidebar; remove JS scroll sync; adjust
  initial-scroll / `scrollToToday` math; update PNG call site.
- `frontend/src/lib/exportPng.ts` — single-container capture.

**Unchanged (reused):** `api/import.ts`, `types/index.ts`, `GanttHeader.tsx`,
`GanttTeamEventStrip.tsx`, all backend code.

## 5. Migration / compatibility

No data or API changes. Stored events/deadlines, the CSV format, and the import
endpoints are untouched. Existing Gantt settings (range/zoom in `localStorage`)
continue to work.
