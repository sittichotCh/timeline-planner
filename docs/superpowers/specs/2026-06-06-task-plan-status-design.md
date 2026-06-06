# Task Planning Status (OPEN / WIP / DONE)

**Date:** 2026-06-06
**Status:** Approved

## Goal

Add an explicit planning status to each task, separate from the Jira status, so
tasks that are finished can be filtered off the Gantt chart. This replaces an
earlier idea of storing a computed `end_date` for filtering — an explicit status
expresses "is this done" directly instead of inferring it from dates.

## Requirements

- New field `plan_status` on a task with fixed values: `OPEN`, `WIP`, `DONE`.
- Separate from the existing `status` field (which holds the read-only Jira
  status string and is left untouched).
- A `DONE` task is hidden from the Gantt chart **and** excluded from the member
  workload totals (task count / total effort days) shown on the chart.
- Default is `OPEN`: existing tasks and newly Jira-imported tasks are treated as
  `OPEN` when `plan_status` is empty/missing.
- Editable in two places:
  - The task edit modal (a Status `Select`).
  - The Tasks table, as an **inline dropdown** for quick changes.
- The Tasks table keeps **both** columns: the existing Jira "Status" column and a
  new "State" column for `plan_status`.

## Design

### Data model

- **Backend** `model.TaskSetting`: add `PlanStatus string \`json:"plan_status"\``.
- **CSV** (`tasks.csv`): append `plan_status` to `tasksHeader`. `parseTaskRow`
  looks columns up by name, so append-only is backward compatible; the existing
  `headerNeedsMigration` path rewrites old files on next read.
- **Default**: in `parseTaskRow`, an empty/missing `plan_status` becomes `OPEN`.
  Jira resync preserves `plan_status` (it is not a Jira field).
- **Frontend type** (`src/types/index.ts`): `plan_status: TaskStatus` where
  `type TaskStatus = "OPEN" | "WIP" | "DONE"`.

### Chart filtering

In `GanttChart`, derive `visibleTasks = tasks.filter(t => t.plan_status !== "DONE")`
and base `scheduledTasks`, `unscheduledTasks`, and `memberWorkloads` on it. This
covers both "hide DONE rows" and "exclude DONE from workload totals" in one place.
The xlsx export mirrors the timeline, so it excludes DONE the same way.

### Editing UI

- **TaskEditModal**: add a Status `Select` (OPEN / WIP / DONE) using the existing
  shadcn `Select` component.
- **TaskPage table**: add a "State" column with an inline dropdown to change
  `plan_status` without opening the modal. Keep the existing Jira "Status" column.
- Badge / control colors: `OPEN` = slate, `WIP` = amber, `DONE` = green.

## Out of scope

- No auto-linking of Jira status to `plan_status` (kept independent).
- No new chart filter controls; DONE simply disappears.

## Implementation steps

1. Backend: add `PlanStatus` to model; append to CSV header; default empty to
   `OPEN` in `parseTaskRow`; include in `taskToRow`.
2. Frontend types: add `TaskStatus` and `plan_status`.
3. `GanttChart`: filter DONE out of visible tasks and workloads; export too.
4. `TaskEditModal`: add Status select.
5. `TaskPage`: add State column with inline dropdown.
6. Verify: backend restart, frontend build, manual check in browser.
