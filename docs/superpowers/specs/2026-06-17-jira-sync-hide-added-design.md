# Jira Sync — Hide Already-Added Issues

**Date:** 2026-06-17
**Status:** Approved
**Area:** `frontend/src/components/JiraSyncPage.tsx`

## Problem

The Jira Sync page fetches issues by JQL and lets the user import them as tasks.
Issues that are already tasks still appear in the results list, marked with a green
"Added ✓" badge. When syncing a query that overlaps heavily with work already
imported, this clutters the list and makes it harder to see what is left to add.

## Goal

Let the user hide already-added issues from the results list so the list focuses on
issues not yet imported, while preserving immediate confirmation feedback for issues
added during the current session.

## Decisions

1. **Toggle, hidden by default.** A "Hide added" checkbox in the toolbar, on by
   default. Unchecking reveals already-added issues with their existing green badge.
2. **Keep session-added rows visible.** When "Hide added" is on, an issue the user
   clicks **Add** on this session stays visible with its "Added ✓" confirmation. Only
   *pre-existing* tasks (already tasks before this fetch) are hidden. The next **Fetch**
   resets the session and those rows become hidden.
3. **Client-side only.** No API or backend change. The filter is a view concern in
   `JiraSyncPage`.

## Design

### State

- `const [hideAdded, setHideAdded] = useState(() => localStorage.getItem("jira_hideAdded") !== "false")`
  - Defaults to `true`; persists the user's choice alongside the existing
    `jira_jql` / `jira_pageSize` keys.
  - Persist on toggle: `localStorage.setItem("jira_hideAdded", String(next))`.

### Predicate

The existing `isAlreadyAdded(key)` returns true for both pre-existing tasks and
session-added issues. We need a narrower predicate that excludes session-added ones:

```ts
// Pre-existing: an issue that is already a task but was NOT added this session.
function isPreExisting(key: string): boolean {
  return !added.has(key) && tasks.some((t) => t.task_id === key);
}
```

- The `added` set already tracks issues imported during the current session and is
  reset to empty on each fresh fetch (`fetchPage(undefined)` calls `setAdded(new Set())`).
- Because `handleAdd` adds the key to both `tasks` (via `onTasksChange`) and `added`,
  a just-added issue is in `added`, so `isPreExisting` returns false → it stays visible.

### Derived list

```ts
const visibleIssues = hideAdded ? issues.filter((i) => !isPreExisting(i.key)) : issues;
```

- The issue table maps over `visibleIssues` instead of `issues`.
- The "all hidden" empty-state check and the count badge read from `visibleIssues`.
- Bulk actions (`handleAddAll`, `handleAddSelected`, `toggleSelectAll`, `selectableCount`)
  are **unchanged** — they already exclude `isAlreadyAdded` issues, so hiding rows does
  not change what gets imported or selected.

### UI

- **Checkbox** in the bulk-actions bar (the strip that already holds "Select all" and
  the count badge), labeled "Hide added". Toggling flips `hideAdded` and persists it.
- **Count badge** — let `hiddenCount = issues.length - visibleIssues.length`. When
  `hideAdded && hiddenCount > 0`, show `${visibleIssues.length} of ${issues.length}`
  (visible of *fetched*), e.g. `12 of 20`. Otherwise keep the existing form:
  `total ? \`${issues.length} / ${total}\` : issues.length`. The Jira server-side
  `total` continues to appear on the "Load more" button, so dropping it from this badge
  while filtering does not lose that context.
- **New empty state**: when a fetch returned issues but all are hidden
  (`issues.length > 0 && visibleIssues.length === 0`), show a short message:
  "All fetched issues are already added — uncheck *Hide added* to see them." The existing
  "Ready to sync" empty state (`issues.length === 0 && !syncing`, no fetch yet) is untouched.

## Out of scope

- No server-side filtering; the sync endpoint and `total` semantics are unchanged.
- No change to import/CRUD handlers or the Jira read-only contract.
- No change to the bulk-add selection logic.

## Verification

- `npm run build` (tsc + vite) and `npm run lint` pass.
- Playwright MCP: confirm pre-existing tasks are hidden by default, the count shows
  `N of M`, clicking Add keeps the row visible with "Added ✓", unchecking "Hide added"
  reveals pre-existing rows, and a fully-added fetch shows the new empty state.
