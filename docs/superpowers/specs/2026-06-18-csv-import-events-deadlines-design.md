# CSV Import for Events & Deadlines — Design

- **Date:** 2026-06-18
- **Status:** Approved (design)
- **Branch:** `feat/csv-import-events-deadlines`

## 1. Goal

Let a user bulk-import **events** and **deadlines** from a single CSV file. A
row's `event_type` column decides which kind it is: `event` rows become calendar
events, `deadline` rows become deadlines. This is the first file-upload feature
in the app.

## 2. Decisions (locked during brainstorming)

1. **One unified file.** A single CSV carries both kinds, distinguished by an
   `event_type` discriminator column. Note this is distinct from an event's
   internal `type` field (`leave/oncall/holiday/other`).
2. **Import mode: Append + skip duplicates.** Valid rows are appended with fresh
   IDs; a row that matches an existing item (or an earlier row in the same file)
   is skipped and counted.
3. **Bad rows: Best-effort + report.** Every valid row is imported; invalid rows
   are skipped and returned with their CSV line number and a reason.

## 3. Import File Format

A single CSV. **Columns are matched by header name** (case-insensitive,
trimmed), so column order does not matter, and unknown columns are ignored. This
keeps the format friendly for Google Sheets exports.

```
event_type,title,start_date,end_date,member_emails,scope,type,color
event,Regression,2026-05-25,2026-05-29,a@co.com|b@co.com,personal,other,
event,,2026-06-01,2026-06-01,,team,holiday,
deadline,Release 1%,2026-08-03,,,,,red
```

Column usage:

| Column          | Event row                                  | Deadline row                |
|-----------------|--------------------------------------------|-----------------------------|
| `event_type`    | **required** — `event`                     | **required** — `deadline`   |
| `title`         | required only when type → `other`          | **required**                |
| `start_date`    | **required** (event start)                 | **required** (the date)     |
| `end_date`      | **required** (event end)                   | ignored                     |
| `member_emails` | pipe (`\|`) delimited; ≥1 if `personal`    | ignored                     |
| `scope`         | `personal`/`team`; blank → `personal`      | ignored                     |
| `type`          | `leave/oncall/holiday/other`; blank→`other`| ignored                     |
| `color`         | ignored                                    | blank/unknown → `red`       |

The only hard structural requirement is that an `event_type` header column
exists. All other columns are optional headers; if a column is absent its value
is treated as blank for every row.

## 4. Per-row Validation & Defaults

Values are trimmed before validation. Fully blank lines are skipped silently
(not counted as errors).

### Event rows (`event_type = event`)
- `start_date`, `end_date`: required; must parse as `YYYY-MM-DD`; `end_date` must
  be `>= start_date`. Otherwise → row error.
- `scope`: must be `personal` or `team`; blank → `personal`; other → row error.
- `type`: one of `leave`, `oncall`, `holiday`, `other`. Legacy values are mapped
  the same way the app already does (`vacation`→`leave`, `busy`→`oncall`,
  `weekend`→`other`). Blank → `other`. Unknown value → row error.
- `title`: required when the resolved type is `other`; missing → row error. For
  `leave`/`oncall`/`holiday` the title is optional and is auto-canonicalized to
  `Leave`/`Oncall`/`Holiday` (matches current `GetEvents` behavior).
- `member_emails`: at least one required when `scope = personal`; missing → row
  error. Emails are **not** validated against `members.csv` — consistent with the
  current backend, which enforces no foreign key between events and members.
  For `scope = team`, member emails are accepted as-is (typically blank).

### Deadline rows (`event_type = deadline`)
- `start_date`: required; must parse as `YYYY-MM-DD`. Otherwise → row error.
- `title`: required; missing → row error.
- `color`: blank or not in the palette (`red`, `orange`, `amber`, `emerald`,
  `blue`, `violet`) → normalized to `red` (this is a normalization, not an
  error).

### Discriminator
- `event_type`: required per row; must be `event` or `deadline`
  (case-insensitive). Anything else → row error.

### Error reporting
Each error references the **CSV line number**, where the header is line 1, so the
first data row is line 2 (matches what a user sees in a spreadsheet/editor). An
error carries `{ row, reason }`.

## 5. Append + Skip Duplicates

Accepted rows are appended; each new item gets a freshly generated ID
(`genID()`). A candidate is skipped as a duplicate when its content key matches
**either** an existing stored item **or** an earlier accepted row in the same
import (so a file containing the same item twice imports it once).

- **Event key:** `scope | canonicalType | canonicalTitle | start_date | end_date | sortedMembers`
  (members sorted and pipe-joined so order doesn't affect identity).
- **Deadline key:** `title | date` (color is cosmetic and excluded).

Normalization (legacy-type mapping + canonical title) is applied **before** the
key is computed and before storage, so imported items dedupe and display
consistently with items created through the existing UI.

## 6. Backend

### Route
- `POST /api/import` — `multipart/form-data` with a single `file` field. Standard
  file upload; no JSON wrapping of the CSV. Registered in
  `cmd/server/main.go` alongside the other route groups.

### Packages / files
- **`internal/importer/`** (new) — pure, no persistence, unit-testable. Parses an
  `io.Reader` and returns `(events []model.Event, deadlines []model.Deadline,
  errs []RowError)`. Owns header mapping, per-row validation, defaults, and
  legacy-type resolution. Produces normalized `model.Event`/`model.Deadline`
  values (no IDs yet — IDs are assigned at persist time).
- **`internal/store/import.go`** (new) — `ImportEvents(cands []model.Event)
  (added, skipped int, err error)` and `ImportDeadlines(cands []model.Deadline)
  (added, skipped int, err error)`. Each reads the existing collection once,
  builds a set of existing keys, walks candidates skipping duplicates (against
  existing keys and keys accepted earlier in the batch), assigns `genID()` to
  accepted items, and writes the collection once. This mirrors the existing
  read-modify-write CRUD pattern and reuses the store mutex; it does not attempt
  cross-call atomicity beyond what current CRUD already provides (single-user
  local tool).
- **`internal/handler/import.go`** (new) — glue: reads the uploaded file, calls
  `importer.Parse`, then `store.ImportEvents` / `store.ImportDeadlines`, and
  assembles the summary response.

### Shared-normalization refactor
Move the existing private `migrateEventType` and `canonicalTitle` from
`internal/store/events.go` into the `model` package as exported helpers
(e.g. `model.NormalizeEventType`, `model.CanonicalTitle`). Update
`store/events.go` to call them. The importer uses the same helpers so import
normalization can never drift from the rest of the app. This is a focused
refactor in service of the feature, covered by existing event tests plus new
importer tests.

### Response
Best-effort imports return **HTTP 200** with a summary, even when some rows were
skipped or errored:

```json
{
  "imported_events": 12,
  "imported_deadlines": 6,
  "skipped_duplicates": 3,
  "errors": [
    { "row": 5, "reason": "invalid start_date: expected YYYY-MM-DD" },
    { "row": 9, "reason": "unknown event_type 'task'" }
  ]
}
```

**HTTP 400** is returned only when the file itself is unusable: unreadable/empty
upload, not parseable as CSV, or missing the required `event_type` header column.

## 7. Frontend

- **Placement:** a single new **Import** entry in the header nav (lucide `Upload`
  icon), opening a slide-over `Sheet` like the existing panels. Because the file
  spans both events and deadlines, one shared entry is cleaner than per-panel
  buttons. Add `"import"` to the `SlidePanel` union in `App.tsx`.
- **`src/components/ImportPanel.tsx`** (new):
  - File picker (`<input type="file" accept=".csv">`).
  - A short inline hint describing the format.
  - A **"Download sample CSV"** button that generates the unified template
    client-side (Blob download) so users can see the exact format.
  - A results area, reusing the existing inline message styling: a success
    summary line (e.g. "Imported 12 events, 6 deadlines · 3 duplicates skipped")
    plus a list of skipped/error rows with their line numbers. Errors use the
    existing `bg-destructive/10 text-destructive` treatment.
  - On success, refreshes events + deadlines by re-fetching both via the
    existing `fetchEvents`/`fetchDeadlines` API and updating `App` state (the
    import response returns only counts, not the created items), so the Gantt
    chart updates immediately.
- **`src/api/import.ts`** (new): `importCsv(file: File): Promise<ImportResult>` —
  posts `FormData` to `/api/import` (no JSON `Content-Type`; the browser sets the
  multipart boundary).
- **`src/types/index.ts`**: add `ImportResult` and `ImportRowError` interfaces.
  Strict TypeScript, no `any`.

## 8. Testing

- **Backend (TDD):**
  - `internal/importer` unit tests: valid event rows; valid deadline rows;
    header-order independence and extra/missing columns; blank-scope→personal;
    blank-type→other; `other`-without-title errors; invalid/`end < start` dates;
    unknown `event_type`; unknown `scope`/`type`; color normalization;
    pipe-delimited member parsing; CSV line numbers in errors.
  - `internal/store` tests: append accepted items; skip duplicate vs existing;
    skip duplicate within the same batch; correct `added`/`skipped` counts.
- **Frontend:** verified in a real browser with Playwright (per `CLAUDE.md`):
  the happy-path upload (Gantt updates) and a file with bad rows (summary shows
  imported counts + skipped rows with reasons).

## 9. Non-goals / Out of scope

- Importing **members** (this file is events + deadlines only).
- Editing/updating existing items via import (mode is append-only with dedup; no
  upsert, no `id` column in the import file).
- Writing anything back to Jira (Jira remains read-only).
- Export to CSV (only import is in scope; the "Download sample CSV" button emits
  a static template, not current data).

## 10. File change summary

**New**
- `backend/internal/importer/importer.go` (+ `importer_test.go`)
- `backend/internal/store/import.go` (+ `import_test.go`)
- `backend/internal/handler/import.go`
- `frontend/src/components/ImportPanel.tsx`
- `frontend/src/api/import.ts`

**Modified**
- `backend/internal/model/event.go` — exported `NormalizeEventType`,
  `CanonicalTitle`
- `backend/internal/store/events.go` — use the model helpers
- `backend/cmd/server/main.go` — register `POST /api/import`
- `frontend/src/types/index.ts` — `ImportResult`, `ImportRowError`
- `frontend/src/components/App.tsx` — `"import"` panel + nav entry + refresh
