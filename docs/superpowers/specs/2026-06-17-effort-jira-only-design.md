# Effort — Jira-Only, Read-Only, "-" When Empty

**Date:** 2026-06-17
**Status:** Approved
**Area:** `frontend/` (frontend-only — no backend change)

## Problem

A task's Effort (in days) is editable in the task edit modal and, on Jira import,
silently defaults to `1` when the Jira issue has no "Dev points" value. This means
"no estimate" is indistinguishable from "a real 1-day estimate," and the value can
drift from Jira through manual edits.

## Goal

Effort is sourced **only** from Jira's Dev points. The field is **not editable**. When
Jira has no Dev points for an issue, effort is treated as "no estimate" and displayed
as **"-"** everywhere effort appears.

## Decisions

1. **No bar, 0 days for empty effort.** A task with no estimate is treated as `0` days:
   no Gantt bar is drawn and it contributes `0` to member day-totals. (Chosen over
   keeping a minimum 1-day bar.)
2. **Sentinel `0` represents "no estimate."** No nullable type and no backend change —
   the Go model is already `float64` and round-trips `0`, and effort `0` already yields
   an empty bar / 0 working days (verified in `computeWorkingSegments` /
   `getWorkingDays`). Chosen over a nullable (`number | null` / `*float64`) model, which
   would touch the backend, CSV layer, type, and every consumer for no functional gain.
3. **Frontend-only.** No Go or CSV changes.

## Design

### 1. Effort comes only from Jira (drop the manual default of `1`)

- `frontend/src/components/JiraSyncPage.tsx` (import): change
  `effort: devPointsToEffort(issue.fields?.dev_points) ?? 1` to `?? 0`.
- `frontend/src/components/TaskPage.tsx` (resync): change
  `effort: devPointsToEffort(issue.fields?.dev_points) ?? task.effort` to `?? 0`.
- `frontend/src/components/TaskEditModal.tsx` (resync): change
  `effort: devPointsToEffort(issue.fields?.dev_points) ?? f.effort` to `?? 0`.

After this, effort always reflects current Jira: a resync of an issue whose Dev points
were cleared sets effort to `0` ("-").

### 2. Disable the Effort field in the edit modal

- `frontend/src/components/TaskEditModal.tsx` (~line 203): replace the editable number
  `<Input type="number" ... value={form.effort} onChange={...} />` with a **disabled
  text** input that displays the formatted effort, so it matches the form's existing
  `<Input>` styling but cannot be edited:

  ```tsx
  <Input type="text" disabled className="h-8 !text-[12px] mt-1" value={formatEffortDays(form.effort)} />
  <p className="text-[10px] text-muted-foreground mt-1">From Jira Dev points</p>
  ```

  Reads `4 days` or `-`. Remove the `onChange` (and the `min`/`step`/`type="number"`
  props) so effort can no longer be typed. Keep the "Effort (days)" label above it.

### 3. Show "-" wherever effort is displayed, via one shared helper

- Add to `frontend/src/lib/jira.ts`:

  ```ts
  /** Format a task's effort for display. Returns "-" when there is no estimate (<= 0). */
  export function formatEffortDays(effort: number): string {
    if (effort <= 0) return "-";
    return `${effort} day${effort > 1 ? "s" : ""}`;
  }
  ```

  (Preserves the existing pluralization: `1` → "1 day", `2` → "2 days", `0.5` → "0.5 day".)

- Use `formatEffortDays` in:
  - `frontend/src/components/TaskPage.tsx` (~line 434) — replaces inline
    `{task.effort} day{task.effort > 1 ? "s" : ""}`.
  - `frontend/src/components/gantt/TaskTooltip.tsx` (~line 60) — replaces the same inline
    pattern.
  - The modal's new read-only Effort field.

## Out of scope / accepted trade-offs

- **No backend / CSV / type changes.** `0` round-trips through the existing `float64`
  model and already renders as no-bar / 0 days.
- **Dev points literally `0`** display as "-" (treated as no estimate). 0-point items are
  not meaningfully schedulable, so this conflation is accepted.
- **Existing data:** tasks currently storing `1` (silently defaulted from an empty Dev
  points value) keep showing "1 day" until re-imported or re-synced, at which point they
  correctly become "-". No data migration.
- `frontend/src/lib/exportXlsx.ts` is unchanged: it uses effort only for scheduling math
  (`getWorkingDays`), where `0` already yields no days, and has no effort value column.

## Verification

- `npm run build` (tsc + vite) and `npm run lint` pass.
- Playwright MCP (Jira credentials are configured in `backend/.env`): open a task in the
  edit modal and confirm the Effort field is read-only; confirm a task whose Jira issue
  has no Dev points shows "-" in the modal, the Tasks list, and the Gantt tooltip, and
  draws no bar; confirm a task with Dev points shows "N days" and a bar as before.
