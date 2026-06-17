# Effort — Jira-Only, Read-Only, "-" When Empty — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a task's Effort sourced only from Jira Dev points, non-editable in the edit modal, and displayed as "-" everywhere when Jira has no value.

**Architecture:** Frontend-only. Use `0` as the "no estimate" sentinel (effort `0` already renders no Gantt bar / 0 working days / 0 member-total). Change the import & resync defaults from `1`/existing-value to `0`, add a shared `formatEffortDays()` display helper that returns "-" for `<= 0`, and replace the modal's editable number input with a disabled text field.

**Tech Stack:** React 19 + TypeScript (strict, no `any`) + Tailwind CSS v4. shadcn `Input`/`Label`. Path alias `@/` → `frontend/src/`.

---

## Testing note

The frontend has **no unit-test runner** (no Jest/Vitest). Verification per task:

1. `npm run build` — `tsc -b && vite build`. Expected exit 0 (a pre-existing "chunk size larger than 500 kB" warning is normal, not a failure; any TypeScript error IS a failure).
2. `npm run lint` — ESLint. Expected exit 0.

All commands run from `F:\workspace\timeline-planner\frontend`. Browser (Playwright MCP) verification is done once at the end — Jira credentials are configured in `backend/.env`, so a live check is possible.

## File Structure

- **Modify:** `frontend/src/lib/jira.ts` — add `formatEffortDays(effort)` next to `devPointsToEffort`.
- **Modify:** `frontend/src/components/TaskPage.tsx` — use `formatEffortDays` in the list; change resync default to `0`.
- **Modify:** `frontend/src/components/gantt/TaskTooltip.tsx` — use `formatEffortDays`.
- **Modify:** `frontend/src/components/JiraSyncPage.tsx` — change import default to `0`.
- **Modify:** `frontend/src/components/TaskEditModal.tsx` — change resync default to `0`; replace the editable Effort input with a disabled text field.

No new files. No type changes. No backend changes.

---

### Task 1: Add `formatEffortDays` helper and show "-" in the read-only displays

**Files:**
- Modify: `frontend/src/lib/jira.ts`
- Modify: `frontend/src/components/TaskPage.tsx`
- Modify: `frontend/src/components/gantt/TaskTooltip.tsx`

After this task, the Tasks list and the Gantt tooltip render "-" for any effort `<= 0` and are unchanged for positive values.

- [ ] **Step 1: Add the helper to `lib/jira.ts`**

`frontend/src/lib/jira.ts` currently ends the `devPointsToEffort` function around line 10. Add this new exported function directly below it (before the `issueTypeBadgeClass` block):

```ts
/** Format a task's effort for display. Returns "-" when there is no estimate (<= 0). */
export function formatEffortDays(effort: number): string {
  if (effort <= 0) return "-";
  return `${effort} day${effort > 1 ? "s" : ""}`;
}
```

This preserves the existing pluralization (`1` → "1 day", `2` → "2 days", `0.5` → "0.5 day").

- [ ] **Step 2: Use it in the Tasks list**

In `frontend/src/components/TaskPage.tsx`, the import on line 5 is:

```tsx
import { devPointsToEffort, issueTypeBadgeStyle } from "@/lib/jira";
```

Change it to add `formatEffortDays`:

```tsx
import { devPointsToEffort, formatEffortDays, issueTypeBadgeStyle } from "@/lib/jira";
```

Then, around line 434, the effort cell currently reads:

```tsx
                      {task.effort} day{task.effort > 1 ? "s" : ""}
```

Replace that line with:

```tsx
                      {formatEffortDays(task.effort)}
```

- [ ] **Step 3: Use it in the Gantt tooltip**

In `frontend/src/components/gantt/TaskTooltip.tsx`, the import on line 2 is:

```tsx
import { issueTypeBadgeStyle } from "@/lib/jira";
```

Change it to:

```tsx
import { formatEffortDays, issueTypeBadgeStyle } from "@/lib/jira";
```

Then, around line 60, the effort line currently reads:

```tsx
            {task.effort} day{task.effort > 1 ? "s" : ""}
```

Replace that line with:

```tsx
            {formatEffortDays(task.effort)}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exit 0 (chunk-size warning aside).

- [ ] **Step 5: Verify lint**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/jira.ts frontend/src/components/TaskPage.tsx frontend/src/components/gantt/TaskTooltip.tsx
git commit -m "feat: add formatEffortDays helper and show \"-\" for empty effort"
```

---

### Task 2: Source effort only from Jira (drop the manual default)

**Files:**
- Modify: `frontend/src/components/JiraSyncPage.tsx`
- Modify: `frontend/src/components/TaskPage.tsx`
- Modify: `frontend/src/components/TaskEditModal.tsx`

After this task, importing or resyncing an issue with no Dev points sets effort to `0` (which renders as "-" thanks to Task 1) instead of `1` / the previous value.

- [ ] **Step 1: Change the import default in `JiraSyncPage.tsx`**

Around line 109, the line reads:

```tsx
      effort: devPointsToEffort(issue.fields?.dev_points) ?? 1,
```

Change it to:

```tsx
      effort: devPointsToEffort(issue.fields?.dev_points) ?? 0,
```

- [ ] **Step 2: Change the resync default in `TaskPage.tsx`**

Around lines 230-231, the code reads:

```tsx
            // Re-apply Dev points → effort; keep the existing effort if unset.
            effort: devPointsToEffort(issue.fields?.dev_points) ?? task.effort,
```

Change both the comment and the fallback so effort always reflects current Jira:

```tsx
            // Re-apply Dev points → effort; empty Dev points clears it to 0 ("-").
            effort: devPointsToEffort(issue.fields?.dev_points) ?? 0,
```

- [ ] **Step 3: Change the resync default in `TaskEditModal.tsx`**

Around line 98, inside `handleResync`'s `setForm`, the line reads:

```tsx
        effort: devPointsToEffort(issue.fields?.dev_points) ?? f.effort,
```

Change it to:

```tsx
        effort: devPointsToEffort(issue.fields?.dev_points) ?? 0,
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exit 0 (chunk-size warning aside).

- [ ] **Step 5: Verify lint**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/JiraSyncPage.tsx frontend/src/components/TaskPage.tsx frontend/src/components/TaskEditModal.tsx
git commit -m "feat: source task effort only from Jira (no manual default)"
```

---

### Task 3: Make the edit modal Effort field read-only

**Files:**
- Modify: `frontend/src/components/TaskEditModal.tsx`

After this task, the Effort field in the task edit modal is a disabled text input showing the formatted effort (`4 days` or `-`) with a "From Jira Dev points" hint, and can no longer be typed.

- [ ] **Step 1: Import the helper**

In `frontend/src/components/TaskEditModal.tsx`, the import on line 5 is:

```tsx
import { devPointsToEffort, issueTypeBadgeStyle } from "@/lib/jira";
```

Change it to:

```tsx
import { devPointsToEffort, formatEffortDays, issueTypeBadgeStyle } from "@/lib/jira";
```

- [ ] **Step 2: Replace the editable Effort input with a disabled display**

Around lines 201-204, the Effort block currently reads:

```tsx
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Effort (days)</Label>
            <Input type="number" min={0.5} step={0.5} className="h-8 !text-[12px] mt-1" value={form.effort} onChange={(e) => setForm({ ...form, effort: Number(e.target.value) })} />
          </div>
```

Replace that block with:

```tsx
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Effort (days)</Label>
            <Input type="text" disabled className="h-8 !text-[12px] mt-1" value={formatEffortDays(form.effort)} />
            <p className="text-[10px] text-muted-foreground mt-1">From Jira Dev points</p>
          </div>
```

This removes the `onChange` (so effort is no longer editable) and the `type="number"` / `min` / `step` props, and shows `4 days` or `-` via the shared helper.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0 (chunk-size warning aside). Confirm there is no "declared but never used" error — `form.effort` is still read by the disabled input, and `setForm` is still used by the other fields.

- [ ] **Step 4: Verify lint**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TaskEditModal.tsx
git commit -m "feat: make the edit modal Effort field read-only"
```

---

## Self-Review

**Spec coverage:**
- "Effort comes only from Jira (drop default of 1)" → Task 2 Steps 1-3 (`?? 0` in import + both resync paths). ✓
- "Disable the Effort field in the edit modal" → Task 3 Step 2 (disabled text input, `onChange` removed). ✓
- "Show '-' wherever effort is displayed, via one shared helper" → Task 1 (helper + Tasks list + tooltip) and Task 3 (modal). ✓
- "No bar / 0 days for empty effort" → no code needed; `effort: 0` already yields no segments (verified in `computeWorkingSegments`). Covered by Task 2 producing `0`. ✓
- "Frontend-only, no backend/type change" → no task touches Go or `types/index.ts`. ✓
- `exportXlsx.ts` unchanged → not in any task's file list. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete before/after code. ✓

**Type consistency:** `formatEffortDays(effort: number): string` is defined once in Task 1 and imported identically (`from "@/lib/jira"`) in TaskPage (Task 1), TaskTooltip (Task 1), and TaskEditModal (Task 3). The disabled `<Input>` keeps `value` a string (`formatEffortDays(...)`), consistent with `type="text"`. No `any`. ✓
