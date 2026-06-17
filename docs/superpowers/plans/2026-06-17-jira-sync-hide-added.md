# Jira Sync — Hide Already-Added Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Hide added" toggle (on by default) to the Jira Sync page that hides issues already imported as tasks, while keeping rows added during the current session visible.

**Architecture:** Pure client-side view filter inside `JiraSyncPage.tsx`. A `hideAdded` boolean (persisted to `localStorage`) drives a derived `visibleIssues` list. A new `isPreExisting` predicate distinguishes pre-existing tasks (hidden) from session-added issues (kept visible via the existing `added` set). No API or backend change.

**Tech Stack:** React 19 + TypeScript (strict, no `any`) + Tailwind CSS v4. shadcn/Radix `Checkbox`, `Label`, `Badge`. Path alias `@/` → `frontend/src/`.

---

## Testing note

The frontend has **no unit-test runner** (no Jest/Vitest configured). Per the project's established practice, verification for each task is:

1. `npm run build` — `tsc -b && vite build`; type-checks the strict TS and produces a production build. Expected exit 0 (a pre-existing "chunk size" warning is normal and not a failure).
2. `npm run lint` — ESLint. Expected exit 0.
3. **Playwright MCP (best-effort):** if a reachable Jira instance is configured (`JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_TOKEN`) and `tasks.csv` shares keys with a JQL result, verify behavior in the browser. If no live Jira is available, rely on build + lint + a careful read of the diff against the spec; note this in the task report.

All commands run from `F:\workspace\timeline-planner\frontend`.

## File Structure

- **Modify:** `frontend/src/components/JiraSyncPage.tsx` — the only file touched. Adds `hideAdded` state + persistence, the `isPreExisting` predicate, the `visibleIssues` derived list, the toggle checkbox, the filtered count badge, and the "all added" empty state.

No new files. No type changes (`TaskSetting` / `JiraIssue` already carry everything needed).

---

### Task 1: Filter logic + "Hide added" toggle

**Files:**
- Modify: `frontend/src/components/JiraSyncPage.tsx`

This task makes the filter functional (default on) and adds the checkbox to control it. After this task, pre-existing tasks are hidden by default, session-added rows stay visible, and the user can toggle the behavior.

- [ ] **Step 1: Add `hideAdded` state**

In the state block (currently ends at `const [selected, setSelected] = useState<Set<string>>(new Set());`, around line 53), add immediately after the `selected` state:

```tsx
const [hideAdded, setHideAdded] = useState(
  () => localStorage.getItem("jira_hideAdded") !== "false",
);
```

This defaults to `true` (only an explicit stored `"false"` turns it off) and remembers the user's choice across reloads, matching the existing `jira_jql` / `jira_pageSize` persistence.

- [ ] **Step 2: Add the `isPreExisting` predicate**

Directly below the existing `isAlreadyAdded` function (currently lines 168-170):

```tsx
function isAlreadyAdded(key: string): boolean {
  return added.has(key) || tasks.some((t) => t.task_id === key);
}

function isPreExisting(key: string): boolean {
  return !added.has(key) && tasks.some((t) => t.task_id === key);
}
```

`isPreExisting` is true only for issues that are already tasks **and** were not added this session. Because `handleAdd` adds the key to the `added` set, a just-added issue is excluded here and stays visible.

- [ ] **Step 3: Add the `visibleIssues` derived list**

Just below the existing `const selectableCount = ...` line (currently line 181), before the `return (`:

```tsx
const selectableCount = issues.filter((i) => !isAlreadyAdded(i.key)).length;

const visibleIssues = hideAdded
  ? issues.filter((i) => !isPreExisting(i.key))
  : issues;
```

- [ ] **Step 4: Render `visibleIssues` in the table**

Change the table body map (currently line 282) from `issues.map` to `visibleIssues.map`:

```tsx
{visibleIssues.map((issue) => {
  const isAdded = isAlreadyAdded(issue.key);
  const isSelected = selected.has(issue.key);
```

Leave the inner row JSX unchanged.

- [ ] **Step 5: Add the "Hide added" checkbox to the bulk-actions bar**

In the bulk-actions bar, insert a new checkbox group **immediately after** the count `Badge` (currently lines 243-245) and **before** the `<div className="ml-auto flex gap-1.5">` action buttons:

```tsx
          <Badge variant="secondary" className="text-[11px]">
            {total ? `${issues.length} / ${total}` : issues.length}
          </Badge>
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={hideAdded}
              onCheckedChange={(c) => {
                const next = c === true;
                setHideAdded(next);
                localStorage.setItem("jira_hideAdded", String(next));
              }}
            />
            <Label className="text-[11px] cursor-pointer">Hide added</Label>
          </div>
          <div className="ml-auto flex gap-1.5">
```

`Checkbox` and `Label` are already imported. The `c === true` coercion handles Radix's `boolean | "indeterminate"` callback type without using `any`.

- [ ] **Step 6: Verify build passes**

Run: `npm run build`
Expected: exit 0. TypeScript compiles (no unused-variable errors — `hideAdded`, `setHideAdded`, `isPreExisting`, `visibleIssues` are all now used). A pre-existing chunk-size warning may appear; that is not a failure.

- [ ] **Step 7: Verify lint passes**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 8: Verify in browser (best-effort)**

If a live Jira instance is configured, start backend (`cd backend && go run ./cmd/server`) and frontend (`npm run dev`), then via Playwright MCP: navigate to `http://localhost:5173`, open the Jira Sync page, run a JQL query whose results include at least one key already present in `tasks.csv`. Confirm:
- The pre-existing issue is **absent** from the list by default.
- Clicking **Add** on a new issue keeps it visible with the "Added ✓" badge.
- Unchecking "Hide added" reveals the pre-existing issue.

If no live Jira is reachable, record that build + lint passed and the diff was reviewed against the spec.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/JiraSyncPage.tsx
git commit -m "feat: hide pre-existing Jira issues behind a Hide added toggle"
```

---

### Task 2: Filtered count badge + "all added" empty state

**Files:**
- Modify: `frontend/src/components/JiraSyncPage.tsx`

This task adds the affordances that explain the filtering: a `N of M` count while rows are hidden, and an empty state for when every fetched issue is hidden.

- [ ] **Step 1: Add the `hiddenCount` derived value**

Directly below the `visibleIssues` declaration added in Task 1:

```tsx
const visibleIssues = hideAdded
  ? issues.filter((i) => !isPreExisting(i.key))
  : issues;

const hiddenCount = issues.length - visibleIssues.length;
```

- [ ] **Step 2: Update the count badge to show `N of M` while filtering**

Change the count `Badge` content (currently `{total ? \`${issues.length} / ${total}\` : issues.length}`) to:

```tsx
          <Badge variant="secondary" className="text-[11px]">
            {hideAdded && hiddenCount > 0
              ? `${visibleIssues.length} of ${issues.length}`
              : total
                ? `${issues.length} / ${total}`
                : issues.length}
          </Badge>
```

When filtering hides at least one row, the badge reads e.g. `12 of 20` (visible of fetched). Otherwise it keeps the existing `fetched / total` (or plain count) form. The server-side `total` still appears on the "Load more" button.

- [ ] **Step 3: Add the "all added" empty state**

In the issue-list area, the empty/table branch is currently:

```tsx
{issues.length === 0 && !syncing ? (
  <div className="text-center py-20">
    ... Ready to sync ...
  </div>
) : (
  <table className="w-full text-[12px]">
```

Insert a middle branch so that when a fetch returned issues but all are hidden, a message shows instead of an empty table:

```tsx
{issues.length === 0 && !syncing ? (
  <div className="text-center py-20">
    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
      <RefreshCw className="size-6 text-muted-foreground" />
    </div>
    <p className="text-[13px] text-muted-foreground font-medium">Ready to sync</p>
    <p className="text-[11px] text-muted-foreground mt-1">Enter a JQL query and click Fetch to find issues.</p>
  </div>
) : visibleIssues.length === 0 && !syncing ? (
  <div className="text-center py-20">
    <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
      <Check className="size-6 text-emerald-600" />
    </div>
    <p className="text-[13px] text-muted-foreground font-medium">All fetched issues are already added</p>
    <p className="text-[11px] text-muted-foreground mt-1">Uncheck &ldquo;Hide added&rdquo; to see them.</p>
  </div>
) : (
  <table className="w-full text-[12px]">
```

The first branch (`issues.length === 0`) is checked first, so the new middle branch only triggers when `issues.length > 0` and everything is filtered out. The bulk-actions bar (gated on `issues.length > 0`) stays visible above, so the "Hide added" checkbox remains available to undo the filter. `Check` and `RefreshCw` are already imported.

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: exit 0 (pre-existing chunk-size warning aside).

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 6: Verify in browser (best-effort)**

If a live Jira instance is configured, via Playwright MCP confirm:
- With rows hidden, the count badge reads `N of M` (e.g. `12 of 20`).
- A JQL query whose every result is already a task shows the "All fetched issues are already added" empty state, and the "Hide added" checkbox above still works to reveal them.

If no live Jira is reachable, record build + lint pass and a spec-aligned diff review.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/JiraSyncPage.tsx
git commit -m "feat: show filtered count and empty state for hidden Jira issues"
```

---

## Self-Review

**Spec coverage:**
- Decision 1 (toggle, hidden by default) → Task 1 Step 1 (default `true`) + Step 5 (checkbox). ✓
- Decision 2 (keep session-added visible; pre-existing hidden) → Task 1 Step 2 (`isPreExisting` excludes `added`) + Step 3/4. ✓
- Decision 3 (client-side only) → only `JiraSyncPage.tsx` modified. ✓
- Count badge `N of M` → Task 2 Steps 1-2. ✓
- New empty state → Task 2 Step 3. ✓
- Bulk-add logic untouched → no task changes `handleAddAll` / `handleAddSelected` / `selectableCount`. ✓
- `localStorage` persistence (`jira_hideAdded`) → Task 1 Steps 1 & 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `hideAdded`/`setHideAdded`, `isPreExisting`, `visibleIssues`, `hiddenCount` are named identically everywhere they appear. The Radix `onCheckedChange` value is coerced with `c === true` (no `any`). ✓
