# Filter Events & Deadlines Panels to Timeline Range — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Events and Deadlines side panels list only items that overlap the Gantt timeline's current `From`/`To` range; out-of-range items are hard-hidden.

**Architecture:** The `From`/`To` range is already persisted by `GanttChart` to `localStorage` under `gantt-settings`. A new shared `loadGanttRange()` helper reads it; each panel reads the range once on mount and filters its rendered list (CRUD still runs against the full array). `GanttChart` is refactored to source its own range defaults from the same helper so there is one definition. See spec: `docs/superpowers/specs/2026-06-16-panel-range-filter-design.md`.

**Tech Stack:** React 19 + TypeScript (strict, no `any`) + Vite + Tailwind v4; Radix `Sheet` panels; `@/` → `src/`.

**Testing note:** This frontend has **no unit-test runner** — only `npm run build` (`tsc -b && vite build`, strict TS) and `npm run lint`. Per CLAUDE.md, UI behavior is verified in a real browser via Playwright. So each task's verification is `npm run build` + `npm run lint` (run from `frontend/`), and Task 6 verifies behavior in Playwright. This replaces the usual write-failing-test cycle.

**Staging discipline:** Each commit stages **only** the exact files named in that task (`git add <path>`). Never `git add -A` / `git add .`.

---

### Task 1: Shared gantt-settings module with `loadGanttRange`

**Files:**
- Create: `frontend/src/lib/ganttSettings.ts`

- [ ] **Step 1: Create the module**

Create `frontend/src/lib/ganttSettings.ts` with exactly:

```ts
import { formatDate } from "@/lib/dates";

/** localStorage key under which the Gantt range + zoom settings are persisted. */
export const STORAGE_KEY = "gantt-settings";

/** First day of the current month, as an ISO YYYY-MM-DD string. */
export function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Last day of next month, as an ISO YYYY-MM-DD string. */
export function nextMonthEnd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return formatDate(last);
}

export interface GanttRange {
  rangeStart: string;
  rangeEnd: string;
}

/**
 * Read the persisted timeline From/To range, falling back to the default
 * window (current month start → next month end) when nothing is saved or the
 * stored value is unreadable. Returns ISO YYYY-MM-DD strings.
 *
 * This is the single source of truth for the range defaults; both GanttChart
 * (which writes the range) and the Events/Deadlines panels (which read it to
 * filter their lists) resolve through this function so they always agree.
 */
export function loadGanttRange(): GanttRange {
  let saved: { rangeStart?: string; rangeEnd?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    saved = {};
  }
  return {
    rangeStart: saved.rangeStart ?? currentMonthStart(),
    rangeEnd: saved.rangeEnd ?? nextMonthEnd(),
  };
}
```

- [ ] **Step 2: Verify build + lint**

Run (from `frontend/`): `npm run build && npm run lint`
Expected: build succeeds (only the pre-existing chunk-size warning, if any); lint exits 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/ganttSettings.ts
git commit -m "$(cat <<'EOF'
feat: add shared loadGanttRange settings helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Refactor GanttChart to use the shared helper

`GanttChart` currently defines its own `STORAGE_KEY`, `currentMonthStart`, and `nextMonthEnd`, and resolves the initial range inline. Replace those with imports from `ganttSettings` so the defaults live in exactly one place. Pure refactor — no behavior change.

**Files:**
- Modify: `frontend/src/components/gantt/GanttChart.tsx`

- [ ] **Step 1: Add the import**

At the end of the existing import block (after the `import { issueTypeBadgeStyle } from "@/lib/jira";` line), add:

```ts
import { STORAGE_KEY, loadGanttRange } from "@/lib/ganttSettings";
```

- [ ] **Step 2: Remove the now-duplicated local `STORAGE_KEY` constant**

Delete this line (currently around line 44):

```ts
const STORAGE_KEY = "gantt-settings";
```

(`loadSettings` / `saveSettings` keep working — they now reference the imported `STORAGE_KEY`.)

- [ ] **Step 3: Remove the local `currentMonthStart` / `nextMonthEnd` functions**

Delete both function declarations (currently around lines 95–104):

```ts
function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function nextMonthEnd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return formatDate(last);
}
```

- [ ] **Step 4: Resolve the initial range via `loadGanttRange`**

Replace the current state initialization (currently around lines 107–109):

```ts
  const saved = useMemo(() => loadSettings(), []);
  const [rangeStartStr, setRangeStartStr] = useState(() => saved.rangeStart ?? currentMonthStart());
  const [rangeEndStr, setRangeEndStr] = useState(() => saved.rangeEnd ?? nextMonthEnd());
```

with:

```ts
  const saved = useMemo(() => loadSettings(), []);
  const initialRange = useMemo(() => loadGanttRange(), []);
  const [rangeStartStr, setRangeStartStr] = useState(initialRange.rangeStart);
  const [rangeEndStr, setRangeEndStr] = useState(initialRange.rangeEnd);
```

(`saved` is still used just below for the zoom initializer — leave that as-is.)

- [ ] **Step 5: Verify build + lint**

Run (from `frontend/`): `npm run build && npm run lint`
Expected: build succeeds, lint exits 0. Watch for any "unused variable" error on `formatDate` — it is still used elsewhere in `GanttChart`, so there should be none. If lint flags an unused import, do **not** remove `formatDate` blindly; confirm it is genuinely unused first (it is used in the background-grid `key` and elsewhere).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/gantt/GanttChart.tsx
git commit -m "$(cat <<'EOF'
refactor: GanttChart sources range defaults from ganttSettings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add `formatShortDate` date helper

The panel headers show the active window as a compact label (e.g. `Jun 1`). Add a locale-aware formatter to the dates lib.

**Files:**
- Modify: `frontend/src/lib/dates.ts`

- [ ] **Step 1: Append the helper**

Add at the end of `frontend/src/lib/dates.ts`:

```ts
/**
 * Format an ISO date string (YYYY-MM-DD) as a short, locale-aware label such as
 * "Jun 1", for compact range display. Parses via local-midnight (parseDate) so
 * the day never shifts across timezones.
 */
export function formatShortDate(iso: string): string {
  return parseDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
```

- [ ] **Step 2: Verify build + lint**

Run (from `frontend/`): `npm run build && npm run lint`
Expected: build succeeds, lint exits 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/dates.ts
git commit -m "$(cat <<'EOF'
feat: add formatShortDate helper for compact range labels

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Filter the Events panel to the range

**Files:**
- Modify: `frontend/src/components/EventPanel.tsx`

- [ ] **Step 1: Add imports**

After the existing `import { createEvent, updateEvent, deleteEvent } from "@/api/events";` line, add:

```ts
import { loadGanttRange } from "@/lib/ganttSettings";
import { formatShortDate } from "@/lib/dates";
```

- [ ] **Step 2: Read the range and derive the visible list**

Inside `EventPanel`, immediately after the existing `const [error, setError] = useState<string | null>(null);` line, add:

```ts
  // Captured once when the panel opens. The From/To inputs live behind the
  // panel's modal overlay, so the range can't change while the panel is open;
  // the panel remounts (and re-reads) each time it is reopened.
  const [range] = useState(loadGanttRange);
  const visibleEvents = events.filter(
    (e) => e.start_date <= range.rangeEnd && e.end_date >= range.rangeStart,
  );
```

- [ ] **Step 3: Update the header subtitle to show count + range**

Replace the current description line (currently line 160):

```tsx
          <SheetDescription>{events.length} events</SheetDescription>
```

with:

```tsx
          <SheetDescription>
            {visibleEvents.length === events.length
              ? `${events.length} events`
              : `${visibleEvents.length} of ${events.length} events`}{" · "}
            {formatShortDate(range.rangeStart)} &rarr; {formatShortDate(range.rangeEnd)}
          </SheetDescription>
```

- [ ] **Step 4: Render the filtered list**

Change the list map from `events.map` to `visibleEvents.map`. Replace the opening of the map (currently line 168):

```tsx
          {events.map((event) => {
```

with:

```tsx
          {visibleEvents.map((event) => {
```

(Leave the entire body of the `.map` callback unchanged — it references `event`.)

- [ ] **Step 5: Add the filtered-empty state**

The existing block (currently lines 201–209) handles "no events at all". Immediately **after** that closing `)}`, add a second empty state for "events exist but none in range":

```tsx
          {events.length > 0 && visibleEvents.length === 0 && !showForm && (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <Calendar className="size-6 text-muted-foreground" />
              </div>
              <p className="text-[13px] text-muted-foreground font-medium">No events in this range</p>
              <p className="text-[11px] text-muted-foreground mt-1">Adjust the timeline&rsquo;s From / To to see more.</p>
            </div>
          )}
```

- [ ] **Step 6: Verify build + lint**

Run (from `frontend/`): `npm run build && npm run lint`
Expected: build succeeds, lint exits 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/EventPanel.tsx
git commit -m "$(cat <<'EOF'
feat: filter Events panel list to the timeline range

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Filter the Deadlines panel to the range

**Files:**
- Modify: `frontend/src/components/DeadlinePanel.tsx`

- [ ] **Step 1: Add imports**

After the existing `import { createDeadline, updateDeadline, deleteDeadline } from "@/api/deadlines";` line, add:

```ts
import { loadGanttRange } from "@/lib/ganttSettings";
import { formatShortDate } from "@/lib/dates";
```

- [ ] **Step 2: Read the range**

Inside `DeadlinePanel`, immediately after the existing `const [error, setError] = useState<string | null>(null);` line, add:

```ts
  // Captured once on open; range can't change behind the modal overlay.
  const [range] = useState(loadGanttRange);
```

- [ ] **Step 3: Filter before sorting**

Replace the current sorted line (currently line 96):

```ts
  const sorted = [...deadlines].sort((a, b) => a.date.localeCompare(b.date));
```

with:

```ts
  const visible = deadlines.filter((d) => d.date >= range.rangeStart && d.date <= range.rangeEnd);
  const sorted = [...visible].sort((a, b) => a.date.localeCompare(b.date));
```

(`sorted` now contains only in-range deadlines; the existing `{sorted.map(...)}` needs no change.)

- [ ] **Step 4: Update the header subtitle**

Replace the current description line (currently line 103):

```tsx
          <SheetDescription>{deadlines.length} deadlines</SheetDescription>
```

with:

```tsx
          <SheetDescription>
            {visible.length === deadlines.length
              ? `${deadlines.length} deadlines`
              : `${visible.length} of ${deadlines.length} deadlines`}{" · "}
            {formatShortDate(range.rangeStart)} &rarr; {formatShortDate(range.rangeEnd)}
          </SheetDescription>
```

- [ ] **Step 5: Add the filtered-empty state**

The existing block (currently lines 132–140) handles "no deadlines at all". Immediately **after** that closing `)}`, add:

```tsx
          {deadlines.length > 0 && visible.length === 0 && !showForm && (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <Flag className="size-6 text-muted-foreground" />
              </div>
              <p className="text-[13px] text-muted-foreground font-medium">No deadlines in this range</p>
              <p className="text-[11px] text-muted-foreground mt-1">Adjust the timeline&rsquo;s From / To to see more.</p>
            </div>
          )}
```

- [ ] **Step 6: Verify build + lint**

Run (from `frontend/`): `npm run build && npm run lint`
Expected: build succeeds, lint exits 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/DeadlinePanel.tsx
git commit -m "$(cat <<'EOF'
feat: filter Deadlines panel list to the timeline range

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: End-to-end verification (Playwright)

No code changes — confirm behavior in a real browser. Requires the dev servers running (`cd backend && go run ./cmd/server` and `cd frontend && npm run dev`), app at `http://localhost:5173`.

- [ ] **Step 1: Set a narrow range**

Navigate to the timeline. Set `From` / `To` to a window you know excludes at least one existing event and one existing deadline (check the data first, or pick a tight 1-week window). The chart should show only overlapping items (this already worked pre-change — it confirms the range value).

- [ ] **Step 2: Verify the Events panel**

Open the **Events** panel. Confirm:
- Only events overlapping the range are listed.
- The header reads `X of Y events · <start> → <end>` when some are hidden (or `Y events · …` when none are).
- If the narrow range excludes every event, the "No events in this range" empty state shows.

- [ ] **Step 3: Verify the Deadlines panel**

Open the **Deadlines** panel and confirm the equivalent: only in-range deadlines listed, correct `X of Y` subtitle, and the filtered-empty state when applicable.

- [ ] **Step 4: Widen the range and re-check**

Set `From`/`To` back to a wide window. Reopen each panel and confirm the previously-hidden items reappear and the subtitle shows the full count.

- [ ] **Step 5: Confirm CRUD still spans the full dataset**

With a narrow range active, edit an in-range event's title via the panel and save. Confirm it persists and no out-of-range items were dropped (reopen with a wide range — all items still present). This verifies CRUD runs against the full array, not the filtered view.

---

## Notes for the implementer

- **No `any`.** `useState(loadGanttRange)` infers `GanttRange`; `range.rangeStart` / `range.rangeEnd` are `string`.
- **ISO string compare is intentional** — `YYYY-MM-DD` strings sort chronologically, so `<=` / `>=` are correct without parsing to `Date`.
- **Inclusive bounds** on both ends, matching the chart's `generateDateRange`.
- Do **not** filter the arrays passed into the panels from `App`; filter only the locally-derived `visibleEvents` / `visible` used for rendering, so create/update/delete keep operating on the full dataset.
