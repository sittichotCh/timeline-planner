# CSV Import — Per-Row Editor — Design

- **Date:** 2026-06-19
- **Status:** Approved (design)
- **Branch:** `feat/import-modal-settings` (reset to master; supersedes the
  abandoned "modal global settings" design of the same date)

## 1. Goal

Replace the current one-shot CSV import (where every field is a CSV column)
with a **two-step, per-row editor**:

1. The user uploads a CSV that contains only the raw data: `title`,
   `start_date`, `end_date`.
2. The import modal shows the parsed rows in an **editable table/list**. Each
   row is configured individually: its **kind** (event or deadline) and, for
   event rows, **scope + members**, **type**, and **counts-as-working-day**.
   Deadline rows take a single **color** chosen once for the whole import.
3. The user clicks Import; the backend creates all the events and deadlines in
   one batch.

This lets a single file mix events and deadlines and gives the user full
per-row control instead of relying on CSV columns.

## 2. Decisions (locked during brainstorming)

1. **Kind is per-row.** Each row chooses event or deadline; one file can mix
   both. Default kind = **event**.
2. **Per-row editable fields (event rows):** scope (personal/team), members
   (multi-select, personal only), type (leave/oncall/holiday/other, default
   `other`), counts-as-working-day (default false).
3. **Deadline color:** a **single** color picker applies to **all** deadline
   rows in the import (not per-row). Default `red`.
4. **Title/dates are read-only** in the table — taken from the CSV, not edited
   in the grid.
5. **Title comes from the CSV.** For event rows of type `other` (the default)
   the CSV title is kept as-is. For `leave`/`oncall`/`holiday` the store
   normalizes the stored title to the type label ("Leave"/"Oncall"/"Holiday") —
   the app-wide convention enforced in `store.GetEvents`/`CreateEvent`, also used
   by the manual Add-Event form. To keep a custom title, use type `other`. (The
   store is reused unchanged, so this convention applies to imported events too.)

## 3. Current behavior being replaced

- `importer.Parse(r)` reads a unified CSV with an `event_type` discriminator and
  per-row `scope/type/member_emails/color/counts_as_working_day`, returning
  `[]Event, []Deadline, []RowError, error`.
- `handler.Import.Upload` (`POST /api/import`, multipart `file`) calls
  `importer.Parse` then `store.ImportEvents`/`ImportDeadlines`.
- `ImportPanel` is a plain file-picker + sample download + result summary.
- `store.ImportEvents`/`ImportDeadlines` (batch append + skip-duplicates, ID
  assignment) and the dedup keys in `store/import.go` — **kept unchanged.**

## 4. CSV format

Columns matched by header name (case-insensitive, trimmed, order-independent;
extra columns ignored):

- **Required:** `title`, `start_date`.
- **Optional:** `end_date` (used by event rows; ignored by deadline rows). A row
  with no/blank `end_date` can only be a deadline.
- Blank rows are skipped.

## 5. Architecture — two endpoints

### 5.1 Preview — `POST /api/import/preview`

- Multipart form, field `file`.
- Parses with the new `importer.ParseRows` and returns:
  ```json
  { "rows": [{"title": "...", "start_date": "...", "end_date": "..."}],
    "errors": [{"row": 3, "reason": "invalid start_date: expected YYYY-MM-DD"}] }
  ```
- `rows` are the rows good enough to edit; `errors` are CSV lines that were
  rejected at parse time (shown to the user as skipped, not editable).
- A structurally unusable file (unreadable, empty, missing `title`/`start_date`
  header) → **400** with `{"error": "..."}`.

### 5.2 Commit — `POST /api/import`

- JSON body of finalized rows:
  ```json
  {
    "events":   [{"member_emails": ["a@co.com"], "scope": "personal",
                  "type": "other", "title": "Regression",
                  "start_date": "2026-06-22", "end_date": "2026-06-26",
                  "counts_as_working_day": true}],
    "deadlines":[{"title": "Release", "date": "2026-08-03", "color": "violet"}]
  }
  ```
  (No IDs — the store assigns them.)
- The handler validates each item defensively (see §7), then calls the unchanged
  `store.ImportEvents` / `store.ImportDeadlines`.
- Returns `{ "imported_events": N, "imported_deadlines": M,
  "skipped_duplicates": K, "errors": [] }` — same `ImportResult` shape as today;
  `errors` is always empty from commit (parse errors come from preview), kept so
  the response type is honest.
- If any item is invalid → **400** with `{"error": "..."}`. (The frontend
  prevents this via per-row validation; the check is a safety net.)

## 6. Backend changes

### 6.1 `importer/importer.go`

Replace `Parse` and its event/deadline-specific helpers with a single
row parser:

```go
// Row is one CSV data row: just the raw fields the user must supply.
type Row struct {
    Title     string `json:"title"`
    StartDate string `json:"start_date"`
    EndDate   string `json:"end_date"`
}

// ParseRows reads a CSV with columns title, start_date, (optional) end_date and
// returns the valid rows plus a RowError per rejected row. A non-nil error is
// returned only for a structurally unusable file (unreadable, empty, or missing
// the title/start_date header).
func ParseRows(r io.Reader) ([]Row, []RowError, error)
```

- Per-row validation: `title` non-empty; `start_date` valid `YYYY-MM-DD`;
  `end_date` valid `YYYY-MM-DD` **if present and non-blank** (blank allowed).
  `end < start` is **not** rejected here (it only matters for event rows; the
  commit step enforces it). Rejected rows → `RowError{row, reason}`.
- `RowError`, `validDate`, `isBlankRow`, the header-index/`get` helper stay (the
  event_type/scope/type/color/canonical-title logic is removed).

### 6.2 `handler/import.go`

- `Preview(c)` → `POST /api/import/preview`: open `file`, `importer.ParseRows`,
  return rows + errors (or 400 on structural error). Empty `errors` serialize as
  `[]`.
- `Commit(c)` → `POST /api/import`: bind the JSON body, validate every event and
  deadline (§7), import via the store, return the counts. Reuses a local
  `parseEmails`-free path (emails arrive as a JSON array already).
- `respondImport`-style helper builds the response.

### 6.3 Routes (`cmd/server/main.go`)

- Keep `POST /api/import` → `Commit`.
- Add `POST /api/import/preview` → `Preview`.

### 6.4 Store

No change. `ImportEvents`/`ImportDeadlines` and the dedup keys are reused as-is.

## 7. Validation

**Preview (per row, in `ParseRows`):** reject row if `title` empty, `start_date`
missing/invalid, or `end_date` present-but-invalid. Otherwise keep it.

**Commit (per item, in the handler — authoritative):**
- Event: `title` non-empty; `start_date`/`end_date` valid; `end >= start`;
  `scope ∈ {personal, team}`; `type ∈ {leave, oncall, holiday, other}`; if
  `personal`, `member_emails` non-empty (team → members forced empty).
- Deadline: `title` non-empty; `date` valid; `color` coerced to the palette
  (`red, orange, amber, emerald, blue, violet`; invalid/blank → `red`).
- Any invalid item → 400 (UI prevents reaching this).

**Frontend (per row, live — drives the Import button):**
- Deadline row: always valid.
- Event row: valid iff it has a non-blank `end_date` with `end >= start` **and**
  (`scope = team` **or** ≥1 member selected).
- Import is enabled only when there is ≥1 editable row and **every** editable
  row is valid.

## 8. Frontend changes

### 8.1 `api/import.ts`

```ts
export interface ImportRow { title: string; start_date: string; end_date: string }
export interface ImportPreview { rows: ImportRow[]; errors: ImportRowError[] }
export interface ImportCommit {
  events: Omit<CalendarEvent, "id">[];
  deadlines: Omit<Deadline, "id">[];
}
export function previewCsv(file: File): Promise<ImportPreview>;
export function commitImport(payload: ImportCommit): Promise<ImportResult>;
```

`ImportResult` is unchanged (`imported_events`, `imported_deadlines`,
`skipped_duplicates`, `errors`); commit always returns `errors: []` (parse
errors come from preview).

### 8.2 `ImportPanel.tsx` (rebuilt)

- Wider panel (e.g. `maxWidth ≈ 640`) to fit per-row controls.
- **File step:** "Choose CSV file…" + "Download sample CSV"
  (`title,start_date,end_date`). On select → `previewCsv` → build row state.
- **Row state:** for each previewed row keep its raw data + editable config:
  `{ kind: "event"|"deadline", scope, member_emails, type, counts_as_working_day }`
  with defaults `kind="event", scope="personal", member_emails=[], type="other",
  counts_as_working_day=false`.
- **Per-row card/list** (one block per row), each showing read-only
  Title / Start → End, then:
  - Kind selector (Event / Deadline).
  - Event rows: scope toggle (Personal/Team); member chips (Personal only); type
    select; "counts as a working day" checkbox.
  - Deadline rows: a short note that end_date is ignored and color comes from the
    shared picker.
  - Invalid event rows show an inline hint (missing member / missing-or-bad end
    date).
- **Shared deadline color picker** (the 6 swatches), applied to all deadline
  rows on commit. Shown whenever there is ≥1 deadline row (or always).
- **Skipped-rows notice:** list the preview `errors` (`Line N: reason`).
- **Import** button: disabled per §7; on click builds `events[]`/`deadlines[]`
  (team events send `member_emails: []`; deadlines use the shared color and the
  row's `start_date` as `date`), calls `commitImport`, shows the result summary,
  and calls `onImported` when anything was created.
- Gains a `members: Member[]` prop (from `App.tsx`).
- Strict TypeScript, no `any`.

### 8.3 `App.tsx`

Pass `members={members}` into `ImportPanel`.

## 9. Testing

- **Backend (TDD):**
  - `importer.ParseRows`: valid rows; `end_date` optional (blank allowed);
    header-order independence + extra columns ignored; blank rows skipped;
    row errors (empty title, bad start, bad end-when-present) by line number;
    structural errors (empty file, missing `title`/`start_date` header).
  - `handler` Preview: happy path returns rows + line-numbered errors; missing
    file → 400; structural CSV error → 400.
  - `handler` Commit: mixed events+deadlines create the right counts and stamp
    the posted fields (scope/type/members/working-day; deadline color); personal
    event with no members → 400; invalid type/scope/date → 400; team event
    stored with empty members; duplicates skipped count.
- **Frontend:** `npm run build` (tsc) + `npm run lint`; Playwright round-trip
  with an isolated `DATA_DIR` — upload a mixed CSV, set some rows to event
  (personal w/ member, working-day on) and some to deadline, pick a deadline
  color, confirm Import is disabled until a personal event row has a member,
  import, and verify the events (titles from CSV, type/working-day) and the
  colored deadline markers appear; verify a bad CSV line is reported as skipped.

## 10. Anticipated file changes

**Backend**
- `backend/internal/importer/importer.go` — replace `Parse` with `ParseRows`.
- `backend/internal/importer/importer_test.go` — rewrite for `ParseRows`.
- `backend/internal/handler/import.go` — `Preview` + `Commit`.
- `backend/internal/handler/import_test.go` — rewrite for both endpoints.
- `backend/cmd/server/main.go` — add the preview route.

**Frontend**
- `frontend/src/api/import.ts` — `previewCsv` + `commitImport` + types.
- `frontend/src/components/ImportPanel.tsx` — rebuilt per-row editor.
- `frontend/src/App.tsx` — pass `members`.
- `frontend/src/types/index.ts` — only if shared types are added here (otherwise
  keep import types local to `api/import.ts`).

## 11. Migration / compatibility

This replaces the old CSV column format outright (old multi-column templates no
longer apply — only `title`/`start_date`/`end_date` are read). No data migration:
stored events/deadlines are unaffected, and the store/dedup layer is unchanged.

## 12. Non-goals / out of scope

- Editing title/dates in the grid (read-only from CSV).
- Per-row deadline color (one shared color instead).
- Bulk "apply to all rows" for the event fields (purely per-row).
- Auto-detecting a row's kind from its data (default event; user flips).
- Changing the store, dedup identity, or the manual Add-Event / Deadline panels.
