# Phase 1 — Imports Page + Gantt Scroll-Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slide-over CSV import panel with a full Imports page that lists parsed records in an inline-editable table with per-row selection, and fix the Gantt header/body scroll desync by unifying them into one scroll container.

**Architecture:** Frontend-only. Part A adds `ImportPage.tsx` (page chrome modeled on `JiraSyncPage`, an editable `<table>`, a small members popover) wired into `App.tsx`'s page nav, deleting `ImportPanel.tsx`; backend and `api/import.ts` are reused unchanged. Part B restructures `GanttChart.tsx` into a single `overflow-auto` scroller with a `sticky top-0` header and `sticky left-0` sidebar (native two-axis sync, no JS), and simplifies `exportPng.ts` to a single-container capture.

**Tech Stack:** React 19 + TypeScript (strict) + Vite + Tailwind v4, base-ui primitives (`Select`, `Checkbox`), lucide-react icons, `html-to-image` for PNG export.

## Global Constraints

- **Strict TypeScript — no `any` types.** (CLAUDE.md) Non-null assertions (`x!`) are used elsewhere in this codebase and are acceptable.
- **No frontend unit-test runner exists.** The per-task test cycle is: `npm run build` (runs `tsc -b` + `vite build`) and `npm run lint` (eslint) from `frontend/`, both clean, then **Playwright MCP** behavioral verification in a real browser where noted.
- **Backend, store, CSV format, and `/api/import*` endpoints are unchanged.** Reuse `previewCsv` / `commitImport` from `frontend/src/api/import.ts` as-is.
- **`@/` path alias maps to `frontend/src/`.**
- Spec: `docs/superpowers/specs/2026-06-19-phase1-design.md`.

---

## Setup (before Task 1)

- [ ] **Create a feature branch off `master`:**

```bash
git checkout -b feat/phase1-imports-page-scroll-sync
```

(Or, if executing in an isolated worktree per superpowers:using-git-worktrees, ensure the worktree is on this branch.)

### Verification environment (used by the Playwright steps)

Run the app against an **isolated, throwaway data dir** so import tests don't pollute real data but existing members are still available:

```bash
# from repo root
cp -r backend/data /tmp/tp-phase1-data
cd backend && DATA_DIR=/tmp/tp-phase1-data PORT=8080 go run ./cmd/server   # terminal 1
cd frontend && npm run dev                                                  # terminal 2 → http://localhost:5173
```

On Windows PowerShell the backend line is:
`$env:DATA_DIR="$env:TEMP\tp-phase1-data"; $env:PORT="8080"; go run ./cmd/server` (after copying `backend/data` there).

---

# Part A — Imports page

### Task A1: Create `ImportPage.tsx`

Self-contained new component. Not yet reachable from the app (wired in Task A2), so this task is verified by a clean build + lint only.

**Files:**
- Create: `frontend/src/components/ImportPage.tsx`

**Interfaces:**
- Consumes: `previewCsv(file: File): Promise<ImportPreview>` and `commitImport(payload: ImportCommit): Promise<ImportResult>` from `@/api/import`; types `Member`, `CalendarEvent`, `Deadline`, `EventScope`, `EventType`, `ImportResult`, `ImportRowError` from `@/types`; `ImportRow` from `@/api/import`; UI `Button`, `Badge`, `Checkbox`, `Label`, `Select*`.
- Produces: `export function ImportPage(props: { members: Member[]; onImported: () => void }): JSX.Element` — consumed by `App.tsx` in Task A2.

- [ ] **Step 1: Write the full component file**

Create `frontend/src/components/ImportPage.tsx` with exactly this content:

```tsx
import { useRef, useState } from "react";
import type {
  CalendarEvent,
  Deadline,
  EventScope,
  EventType,
  ImportResult,
  ImportRowError,
  Member,
} from "@/types";
import { previewCsv, commitImport, type ImportRow } from "@/api/import";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileDown, FileText, ChevronDown, Check } from "lucide-react";

interface ImportPageProps {
  members: Member[];
  onImported: () => void;
}

type RowKind = "event" | "deadline";

interface RowConfig {
  kind: RowKind;
  scope: EventScope;
  member_emails: string[];
  type: EventType;
  counts_as_working_day: boolean;
}

interface EditRow {
  data: ImportRow;
  cfg: RowConfig;
}

const eventTypes: { value: EventType; label: string }[] = [
  { value: "leave", label: "Leave" },
  { value: "oncall", label: "Oncall" },
  { value: "holiday", label: "Holiday" },
  { value: "other", label: "Other" },
];

const colorOptions = [
  { value: "red", className: "bg-red-500" },
  { value: "orange", className: "bg-orange-500" },
  { value: "amber", className: "bg-amber-500" },
  { value: "emerald", className: "bg-emerald-500" },
  { value: "blue", className: "bg-blue-500" },
  { value: "violet", className: "bg-violet-500" },
];

const SAMPLE_CSV =
  "title,start_date,end_date\n" +
  "Regression,2026-05-25,2026-05-29\n" +
  "Release 1%,2026-08-03,\n";

function defaultConfig(): RowConfig {
  return {
    kind: "event",
    scope: "personal",
    member_emails: [],
    type: "other",
    counts_as_working_day: false,
  };
}

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// A row is importable iff it is a deadline, or an event with a valid end date
// (>= start) and either team scope or at least one member selected.
function rowValid(row: EditRow): boolean {
  if (row.cfg.kind === "deadline") return true;
  if (!row.data.end_date || row.data.end_date < row.data.start_date) return false;
  return row.cfg.scope === "team" || row.cfg.member_emails.length > 0;
}

function rowHint(row: EditRow): string | null {
  if (row.cfg.kind === "deadline") return null;
  if (!row.data.end_date) return "Needs an end date — set this row to Deadline.";
  if (row.data.end_date < row.data.start_date) return "End date is before start date.";
  if (row.cfg.scope === "personal" && row.cfg.member_emails.length === 0)
    return "Select at least one member.";
  return null;
}

interface MemberMultiSelectProps {
  members: Member[];
  selected: string[];
  onToggle: (email: string) => void;
  disabled?: boolean;
}

function MemberMultiSelect({ members, selected, onToggle, disabled }: MemberMultiSelectProps) {
  const [open, setOpen] = useState(false);
  if (members.length === 0) {
    return <span className="text-[11px] text-muted-foreground">No members</span>;
  }
  const label =
    selected.length === 0
      ? "Select…"
      : selected.length === 1
        ? members.find((m) => m.email === selected[0])?.name ?? "1 member"
        : `${selected.length} members`;
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-between gap-1 w-full text-[12px] px-2 py-1 rounded-md border border-input bg-background disabled:opacity-50 ${selected.length === 0 ? "text-muted-foreground" : "text-foreground"}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
      </button>
      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-44 max-h-56 overflow-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 p-1">
            {members.map((m) => {
              const checked = selected.includes(m.email);
              return (
                <button
                  key={m.email}
                  type="button"
                  onClick={() => onToggle(m.email)}
                  className="flex items-center gap-2 w-full text-left text-[12px] px-2 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground"
                >
                  <span
                    className={`flex items-center justify-center w-3.5 h-3.5 rounded-[4px] border ${checked ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}
                  >
                    {checked && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className="truncate">{m.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function ImportPage({ members, onImported }: ImportPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ImportRowError[]>([]);
  const [deadlineColor, setDeadlineColor] = useState("red");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [imported, setImported] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(f: File | null) {
    setFile(f);
    setRows([]);
    setParseErrors([]);
    setSelected(new Set());
    setImported(new Set());
    setResult(null);
    setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const preview = await previewCsv(f);
      const editRows = preview.rows.map((data) => ({ data, cfg: defaultConfig() }));
      setRows(editRows);
      setParseErrors(preview.errors);
      const valid = new Set<number>();
      editRows.forEach((r, i) => {
        if (rowValid(r)) valid.add(i);
      });
      setSelected(valid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read CSV");
    } finally {
      setBusy(false);
    }
  }

  function updateRow(i: number, patch: Partial<RowConfig>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, cfg: { ...r.cfg, ...patch } } : r)));
  }

  function toggleRowMember(i: number, email: string) {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        const has = r.cfg.member_emails.includes(email);
        const member_emails = has
          ? r.cfg.member_emails.filter((e) => e !== email)
          : [...r.cfg.member_emails, email];
        return { ...r, cfg: { ...r.cfg, member_emails } };
      }),
    );
  }

  function toggleRow(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // Importable = valid config AND not already committed. Selection is intersected
  // with this at every use site, so a row that becomes invalid after editing is
  // simply ignored (no need to prune the selected set on each edit).
  const isImportable = (i: number) => rowValid(rows[i]!) && !imported.has(i);
  const isChecked = (i: number) => selected.has(i) && isImportable(i);
  const selectableIndices = rows.reduce<number[]>((acc, _r, i) => {
    if (isImportable(i)) acc.push(i);
    return acc;
  }, []);
  const selectedImportable = selectableIndices.filter((i) => selected.has(i));
  const allSelected = selectableIndices.length > 0 && selectedImportable.length === selectableIndices.length;
  const hasDeadlineRows = rows.some((r, i) => r.cfg.kind === "deadline" && !imported.has(i));

  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableIndices));
  }

  async function runImport(indices: number[]) {
    const targets = indices.filter((i) => isImportable(i));
    if (targets.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const events: Omit<CalendarEvent, "id">[] = [];
    const deadlines: Omit<Deadline, "id">[] = [];
    for (const i of targets) {
      const r = rows[i]!;
      if (r.cfg.kind === "deadline") {
        deadlines.push({ title: r.data.title, date: r.data.start_date, color: deadlineColor });
      } else {
        events.push({
          member_emails: r.cfg.scope === "team" ? [] : r.cfg.member_emails,
          scope: r.cfg.scope,
          type: r.cfg.type,
          title: r.data.title,
          start_date: r.data.start_date,
          end_date: r.data.end_date,
          counts_as_working_day: r.cfg.counts_as_working_day,
        });
      }
    }
    try {
      const res = await commitImport({ events, deadlines });
      setResult(res);
      setImported((prev) => {
        const next = new Set(prev);
        for (const i of targets) next.add(i);
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const i of targets) next.delete(i);
        return next;
      });
      if (res.imported_events + res.imported_deadlines > 0) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-card flex-wrap">
        <h2 className="text-[13px] font-semibold tracking-tight">Import</h2>
        <Button variant="outline" size="sm" onClick={downloadSample}>
          <FileDown />
          Sample CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <FileText />
          {file ? file.name : "Choose CSV file…"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        {hasDeadlineRows && (
          <div className="flex items-center gap-2 ml-auto">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Deadline color</Label>
            <div className="flex gap-1.5">
              {colorOptions.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setDeadlineColor(c.value)}
                  className={`w-5 h-5 rounded-full ${c.className} transition-all ${deadlineColor === c.value ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-60 hover:opacity-100"}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Selection bar */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-1.5">
            <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} disabled={selectableIndices.length === 0} />
            <Label className="text-[11px] cursor-pointer">Select all</Label>
          </div>
          <Badge variant="secondary" className="text-[11px]">
            {selectedImportable.length} of {selectableIndices.length}
          </Badge>
          <div className="ml-auto flex gap-1.5">
            <Button
              variant="outline"
              size="xs"
              onClick={() => runImport([...selected])}
              disabled={busy || selectedImportable.length === 0}
              className="text-[11px]"
            >
              <Upload />
              Import Selected ({selectedImportable.length})
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => runImport(rows.map((_, i) => i))}
              disabled={busy || selectableIndices.length === 0}
              className="text-[11px]"
            >
              Import All ({selectableIndices.length})
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-2 bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">{error}</div>
      )}
      {result && (
        <div className="mx-4 mt-2 bg-emerald-500/10 text-emerald-700 text-[12px] px-3 py-2 rounded-lg">
          Imported {result.imported_events} event{result.imported_events === 1 ? "" : "s"},{" "}
          {result.imported_deadlines} deadline{result.imported_deadlines === 1 ? "" : "s"}
          {result.skipped_duplicates > 0
            ? ` · ${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? "" : "s"} skipped`
            : ""}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Upload className="size-6 text-muted-foreground" />
            </div>
            <p className="text-[13px] text-muted-foreground font-medium">No file loaded</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Choose a CSV (columns: title, start_date, end_date) to preview rows.
            </p>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
              <tr className="border-b text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-2 w-[40px]"></th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2 w-[150px]">Dates</th>
                <th className="px-3 py-2 w-[120px]">Kind</th>
                <th className="px-3 py-2 w-[120px]">Scope</th>
                <th className="px-3 py-2 w-[110px]">Type</th>
                <th className="px-3 py-2 w-[80px]">Work-day</th>
                <th className="px-3 py-2 w-[150px]">Members</th>
                <th className="px-3 py-2 w-[180px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isDone = imported.has(i);
                const valid = rowValid(r);
                const hint = rowHint(r);
                const isEvent = r.cfg.kind === "event";
                const isPersonal = isEvent && r.cfg.scope === "personal";
                return (
                  <tr
                    key={i}
                    className={`border-b transition-colors ${
                      isDone ? "bg-emerald-50/40" : isChecked(i) ? "bg-accent/60" : "hover:bg-muted/30"
                    }`}
                  >
                    <td className="px-3 py-1.5 align-top">
                      <Checkbox checked={isChecked(i)} disabled={isDone || !valid} onCheckedChange={() => toggleRow(i)} />
                    </td>
                    <td className="px-3 py-1.5 align-top font-medium text-foreground">
                      <div className="break-words">{r.data.title}</div>
                    </td>
                    <td className="px-3 py-1.5 align-top text-muted-foreground whitespace-nowrap">
                      {r.data.start_date}
                      {r.data.end_date ? ` → ${r.data.end_date}` : ""}
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      <Select value={r.cfg.kind} onValueChange={(v) => updateRow(i, { kind: v as RowKind })} disabled={isDone}>
                        <SelectTrigger size="sm" className="w-full text-[12px]">
                          <SelectValue>{(v) => (v === "deadline" ? "Deadline" : "Event")}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="event">Event</SelectItem>
                          <SelectItem value="deadline">Deadline</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      {isEvent ? (
                        <Select value={r.cfg.scope} onValueChange={(v) => updateRow(i, { scope: v as EventScope })} disabled={isDone}>
                          <SelectTrigger size="sm" className="w-full text-[12px]">
                            <SelectValue>{(v) => (v === "team" ? "Team" : "Personal")}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="personal">Personal</SelectItem>
                            <SelectItem value="team">Team</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      {isEvent ? (
                        <Select value={r.cfg.type} onValueChange={(v) => updateRow(i, { type: v as EventType })} disabled={isDone}>
                          <SelectTrigger size="sm" className="w-full text-[12px]">
                            <SelectValue>
                              {(value) => eventTypes.find((t) => t.value === value)?.label ?? String(value ?? "")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {eventTypes.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      {isEvent ? (
                        <Checkbox
                          checked={r.cfg.counts_as_working_day}
                          disabled={isDone}
                          onCheckedChange={(c) => updateRow(i, { counts_as_working_day: c === true })}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      {isPersonal ? (
                        <MemberMultiSelect
                          members={members}
                          selected={r.cfg.member_emails}
                          onToggle={(email) => toggleRowMember(i, email)}
                          disabled={isDone}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      {isDone ? (
                        <span className="text-[10px] text-emerald-600 font-semibold">Imported</span>
                      ) : hint ? (
                        <span className="text-[11px] text-destructive">{hint}</span>
                      ) : (
                        <span className="text-[11px] text-emerald-600">Ready</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {parseErrors.length > 0 && (
          <div className="px-4 py-3 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {parseErrors.length} row{parseErrors.length === 1 ? "" : "s"} skipped
            </p>
            {parseErrors.map((e) => (
              <div key={e.row} className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">
                Line {e.row}: {e.reason}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run (from `frontend/`): `npm run build`
Expected: PASS — `tsc -b` reports no type errors and `vite build` completes. (The component is not yet imported anywhere; that is fine — tsc still type-checks it.)

- [ ] **Step 3: Lint**

Run (from `frontend/`): `npm run lint`
Expected: PASS — no eslint errors in `ImportPage.tsx`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ImportPage.tsx
git commit -m "feat: ImportPage with inline-editable table and per-row selection"
```

---

### Task A2: Wire ImportPage into App; remove the import slide-over

**Files:**
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/components/ImportPanel.tsx`

**Interfaces:**
- Consumes: `ImportPage` from Task A1 (`{ members, onImported }`).
- Produces: the **Import** page reachable from the top nav; the `panel === "import"` slide-over no longer exists.

- [ ] **Step 1: Swap the import — `ImportPanel` → `ImportPage`**

In `frontend/src/App.tsx`, replace:

```tsx
import { ImportPanel } from "@/components/ImportPanel";
```

with:

```tsx
import { ImportPage } from "@/components/ImportPage";
```

- [ ] **Step 2: Move "Import" from the panel group to the page group**

Change the `PageView` type from:

```tsx
type PageView = "timeline" | "tasks" | "jira";
type SlidePanel = "members" | "events" | "deadlines" | "import" | null;
```

to:

```tsx
type PageView = "timeline" | "tasks" | "jira" | "import";
type SlidePanel = "members" | "events" | "deadlines" | null;
```

Add Import to `pageItems`:

```tsx
const pageItems: { key: PageView; label: string; icon: typeof Users }[] = [
  { key: "timeline", label: "Timeline", icon: GanttChartSquare },
  { key: "tasks", label: "Tasks", icon: ClipboardCheck },
  { key: "jira", label: "Jira Sync", icon: RefreshCw },
  { key: "import", label: "Import", icon: Upload },
];
```

And remove the import entry from `panelItems`, updating its type union:

```tsx
const panelItems: { key: "members" | "events" | "deadlines"; label: string; icon: typeof Users }[] = [
  { key: "members", label: "Members", icon: Users },
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "deadlines", label: "Deadlines", icon: Flag },
];
```

(The `Upload` icon import stays — it's now used by the `pageItems` Import entry.)

- [ ] **Step 3: Render `ImportPage` in `<main>`**

In the `<main>` block, change the page switch from:

```tsx
        {page === "tasks" ? (
          <TaskPage
            ...
          />
        ) : page === "jira" ? (
          <JiraSyncPage
            ...
          />
        ) : (
          <GanttChart
            ...
          />
        )}
```

to add an `import` branch before the `GanttChart` fallback:

```tsx
        ) : page === "jira" ? (
          <JiraSyncPage
            members={members}
            tasks={tasks}
            onTasksChange={setTasks}
            onMembersChange={setMembers}
          />
        ) : page === "import" ? (
          <ImportPage
            members={members}
            onImported={() => {
              Promise.all([fetchEvents(), fetchDeadlines()])
                .then(([e, d]) => {
                  setEvents(e);
                  setDeadlines(d);
                })
                .catch(() => {});
            }}
          />
        ) : (
          <GanttChart
            ...
          />
        )}
```

(Keep the existing `TaskPage`, `JiraSyncPage`, and `GanttChart` props exactly as they are — only the `import` branch is inserted.)

- [ ] **Step 4: Delete the import slide-over block**

Remove this entire block near the bottom of `App.tsx`:

```tsx
      {panel === "import" && (
        <ImportPanel
          members={members}
          onImported={() => {
            Promise.all([fetchEvents(), fetchDeadlines()])
              .then(([e, d]) => {
                setEvents(e);
                setDeadlines(d);
              })
              .catch(() => {});
          }}
          onClose={() => setPanel(null)}
        />
      )}
```

- [ ] **Step 5: Delete the old component file**

```bash
git rm frontend/src/components/ImportPanel.tsx
```

- [ ] **Step 6: Build & lint**

Run (from `frontend/`): `npm run build` then `npm run lint`
Expected: both PASS. No remaining references to `ImportPanel` (a stale reference would surface as a tsc error).

- [ ] **Step 7: Playwright behavioral verification**

With the dev servers running (see Setup → Verification environment), use Playwright MCP:
1. Navigate to `http://localhost:5173`; click the **Import** nav button → the Import page renders with the "No file loaded" empty state.
2. Create a local CSV file `phase1-test.csv` with:
   ```
   title,start_date,end_date
   Regression,2026-05-25,2026-05-29
   Sprint kickoff,2026-06-01,2026-06-02
   Release 1%,2026-08-03,
   ```
   and upload it via the "Choose CSV file…" input (`browser_file_upload`).
3. Assert: three rows appear; "Regression" and "Sprint kickoff" default to Event/Personal and show the **"Select at least one member."** hint with a **disabled** checkbox; "Release 1%" (no end date) also shows a hint. Select-all count reads `0 of 0`.
4. On the "Regression" row open the **Members** popover and pick a member → its Status flips to "Ready" and its row checkbox becomes enabled. (Editing a row to validity does not auto-select it — tick the checkbox to include it.)
5. Set "Release 1%" Kind → **Deadline**; the toolbar **Deadline color** picker appears and the row becomes Ready; pick a color.
6. Give "Sprint kickoff" a member too, then **deselect** it. Click **Import Selected** → only Regression + Release 1% import; assert the result banner shows `Imported 1 event, 1 deadline`, those two rows flip to **"Imported"** (disabled), and Sprint kickoff stays selectable.
7. Navigate to **Timeline** and confirm the imported Regression event bar and the colored Release 1% deadline marker are present.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: move Import to a page; remove import slide-over"
```

---

# Part B — Gantt scroll-sync fix

### Task B1: Unify the Gantt into one scroll container; simplify PNG export

The DOM restructure, ref changes, scroll-math update, and PNG-export change are interdependent (they share the same refs and must compile together), so they land as one task.

**Files:**
- Modify: `frontend/src/lib/exportPng.ts`
- Modify: `frontend/src/components/gantt/GanttChart.tsx`

**Interfaces:**
- Produces (`exportPng.ts`): `exportTimelineToPng(refs: { container: HTMLElement; scroller: HTMLElement }): Promise<void>`.
- `GanttChart.tsx` keeps its existing props (`GanttChartProps`) — no signature change. `GanttHeader` and `GanttTeamEventStrip` are rendered unchanged.

- [ ] **Step 1: Rewrite `exportPng.ts` for single-container capture**

Replace the entire contents of `frontend/src/lib/exportPng.ts` with:

```ts
import { toPng } from "html-to-image";

/**
 * The timeline is now a single scroll container with a sticky header and sticky
 * sidebar. To screenshot the whole thing we reset its scroll to 0,0 (so the
 * sticky chrome sits at its natural top-left position), un-clip the scroller,
 * snapshot the full-size inner content wrapper, then restore the live layout.
 */
export interface PngCaptureRefs {
  /** Inner content wrapper sized to (sidebar + chart) — the node we screenshot. */
  container: HTMLElement;
  /** The single scroll container that clips the timeline on screen. */
  scroller: HTMLElement;
}

export async function exportTimelineToPng(refs: PngCaptureRefs): Promise<void> {
  const { container, scroller } = refs;

  const originalCss = scroller.style.cssText;
  const prevLeft = scroller.scrollLeft;
  const prevTop = scroller.scrollTop;

  scroller.scrollLeft = 0;
  scroller.scrollTop = 0;
  scroller.style.overflow = "visible";

  try {
    // Force reflow so the expanded dimensions are measurable.
    const captureWidth = container.scrollWidth;
    const captureHeight = container.scrollHeight;

    const dataUrl = await toPng(container, {
      width: captureWidth,
      height: captureHeight,
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
      // Web fonts already render in the clone; skip html-to-image's font
      // inlining, which only logs cross-origin SecurityErrors.
      skipFonts: true,
    });

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "timeline.png";
    a.click();
  } finally {
    scroller.style.cssText = originalCss;
    scroller.scrollLeft = prevLeft;
    scroller.scrollTop = prevTop;
  }
}
```

- [ ] **Step 2: Swap the refs in `GanttChart.tsx`**

Replace this ref block:

```tsx
  const chartRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const bodyWrapperRef = useRef<HTMLDivElement>(null);
```

with:

```tsx
  const scrollRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 3: Fix the initial-scroll effect**

The chart's day offsets are measured from the chart's own left edge (day 0). In the unified container the sticky sidebar overlays the left `SIDEBAR_WIDTH` of the viewport, so the *visible* chart width is `scroller.clientWidth - SIDEBAR_WIDTH`; the `scrollLeft` math is otherwise identical (the sidebar offset cancels out). Replace:

```tsx
  useEffect(() => {
    const clientWidth = chartRef.current?.clientWidth ?? 0;
    let scrollLeft: number;
    if (firstTaskOffset !== null && firstTaskOffset > todayOffset + clientWidth * 0.6) {
      scrollLeft = Math.min(todayOffset, firstTaskOffset) - clientWidth * 0.15;
    } else {
      scrollLeft = todayOffset - clientWidth / 3;
    }
    scrollLeft = Math.max(0, scrollLeft);
    if (chartRef.current) chartRef.current.scrollLeft = scrollLeft;
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = scrollLeft;
  }, [rangeStartStr, rangeEndStr, todayOffset, firstTaskOffset]);
```

with:

```tsx
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const viewW = scroller.clientWidth - SIDEBAR_WIDTH; // visible chart width
    let scrollLeft: number;
    if (firstTaskOffset !== null && firstTaskOffset > todayOffset + viewW * 0.6) {
      scrollLeft = Math.min(todayOffset, firstTaskOffset) - viewW * 0.15;
    } else {
      scrollLeft = todayOffset - viewW / 3;
    }
    scrollLeft = Math.max(0, scrollLeft);
    scroller.scrollLeft = scrollLeft;
  }, [rangeStartStr, rangeEndStr, todayOffset, firstTaskOffset]);
```

- [ ] **Step 4: Fix `scrollToToday`**

Replace:

```tsx
  const scrollToToday = useCallback(() => {
    const scrollLeft = todayOffset - (chartRef.current?.clientWidth ?? 0) / 3;
    chartRef.current?.scrollTo({ left: scrollLeft, behavior: "smooth" });
    headerScrollRef.current?.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }, [todayOffset]);
```

with:

```tsx
  const scrollToToday = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const viewW = scroller.clientWidth - SIDEBAR_WIDTH;
    const scrollLeft = Math.max(0, todayOffset - viewW / 3);
    scroller.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }, [todayOffset]);
```

- [ ] **Step 5: Delete the JS scroll-sync handler**

Remove this function entirely:

```tsx
  function handleChartScroll() {
    if (chartRef.current && sidebarRef.current) sidebarRef.current.scrollTop = chartRef.current.scrollTop;
    if (chartRef.current && headerScrollRef.current) headerScrollRef.current.scrollLeft = chartRef.current.scrollLeft;
  }
```

- [ ] **Step 6: Point PNG export at the new refs**

Replace the body of `handlePngExport`:

```tsx
  async function handlePngExport() {
    const container = timelineRef.current;
    const headerScroll = headerScrollRef.current;
    const bodyWrapper = bodyWrapperRef.current;
    const sidebar = sidebarRef.current;
    const chart = chartRef.current;
    if (!container || !headerScroll || !bodyWrapper || !sidebar || !chart) return;
    setExportingPng(true);
    try {
      await exportTimelineToPng({
        container,
        headerScroll,
        bodyWrapper,
        sidebar,
        chart,
        sidebarWidth: SIDEBAR_WIDTH,
        totalWidth,
        totalBodyHeight,
      });
    } finally {
      setExportingPng(false);
    }
  }
```

with:

```tsx
  async function handlePngExport() {
    const container = captureRef.current;
    const scroller = scrollRef.current;
    if (!container || !scroller) return;
    setExportingPng(true);
    try {
      await exportTimelineToPng({ container, scroller });
    } finally {
      setExportingPng(false);
    }
  }
```

- [ ] **Step 7: Restructure the timeline JSX into one scroll container**

Replace the **entire** outer timeline block — the element that currently opens with `<div ref={timelineRef} className="flex-1 overflow-hidden flex flex-col">` and its matching closing `</div>` (the whole Header + Body region, ending just before the `{hoveredEvent && createPortal(` block) — with the structure below.

**Keep the two inner regions verbatim** (current line numbers in `GanttChart.tsx` as of this plan, for orientation — confirm by content, not line number):
- **(SIDEBAR ROWS)** = the existing `{rows.map((row) => { ... })}` block that renders member/task sidebar rows (≈ lines 416–491, currently inside `<div ref={sidebarRef} className="h-full overflow-hidden">`). Move it unchanged.
- **(CHART INNER)** = the existing `<div className="relative" style={{ width: totalWidth, minHeight: totalBodyHeight }}> ... </div>` block containing the background grid, team overlays, personal overlays, deadline markers, today marker, and the `{/* Row content */}` block (≈ lines 497–602). Move it unchanged.

New structure:

```tsx
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div ref={captureRef} className="relative" style={{ width: SIDEBAR_WIDTH + totalWidth }}>
          {/* Header — pinned to the top while scrolling down */}
          <div className="sticky top-0 z-30 flex" style={{ width: SIDEBAR_WIDTH + totalWidth }}>
            <div
              className="sticky left-0 z-40 flex-shrink-0 border-r border-b bg-card flex items-end px-3 pb-1"
              style={{ width: SIDEBAR_WIDTH }}
            >
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Member / Task</span>
            </div>
            <div style={{ width: totalWidth }}>
              <GanttHeader dates={dates} columnWidth={columnWidth} />
              {team.length > 0 && (
                <GanttTeamEventStrip
                  teamEvents={team}
                  rangeStart={rangeStart}
                  columnWidth={columnWidth}
                  totalWidth={totalWidth}
                  onEventUpdate={onEventUpdate}
                  onEventDelete={onEventDelete}
                />
              )}
            </div>
          </div>

          {/* Body */}
          <div className="flex" style={{ width: SIDEBAR_WIDTH + totalWidth }}>
            {/* Sidebar — pinned to the left while scrolling right */}
            <div className="sticky left-0 z-20 flex-shrink-0 border-r bg-card" style={{ width: SIDEBAR_WIDTH }}>
              {/* (SIDEBAR ROWS) — paste the existing rows.map(...) block here, unchanged */}
            </div>

            {/* Chart area */}
            {/* (CHART INNER) — paste the existing <div className="relative" style={{ width: totalWidth, minHeight: totalBodyHeight }}>…</div> block here, unchanged */}
          </div>
        </div>
      </div>
```

Notes:
- The old `<div ref={chartRef} className="flex-1 overflow-auto" onScroll={handleChartScroll}>` wrapper and the old `<div ref={sidebarRef} className="h-full overflow-hidden">` wrapper are **removed** — their children move directly into the new sticky sidebar / flex body as shown.
- z-index ladder (already encoded above): corner `z-40` > header `z-30` > sidebar `z-20` > the today marker (`z-10`) and deadline/event overlays inside (CHART INNER), which keep their existing classes. The sticky sidebar's opaque `bg-card` hides bars sliding under it.
- Do not modify (SIDEBAR ROWS) or (CHART INNER) internals — only their wrappers change.

- [ ] **Step 8: Build & lint**

Run (from `frontend/`): `npm run build` then `npm run lint`
Expected: both PASS. tsc will flag any leftover reference to the removed refs (`chartRef`, `headerScrollRef`, `sidebarRef`, `timelineRef`, `bodyWrapperRef`, `handleChartScroll`) or any unbalanced JSX tag — fix until clean. Confirm none of those identifiers remain (grep): `git grep -nE "chartRef|headerScrollRef|sidebarRef|timelineRef|bodyWrapperRef|handleChartScroll" frontend/src/components/gantt/GanttChart.tsx` returns nothing.

- [ ] **Step 9: Playwright behavioral verification**

With the dev servers running, use Playwright MCP on the **Timeline** page (ensure there is enough data to overflow horizontally — the seeded data dir should; otherwise widen the date range via the From/To inputs):
1. **Scroll right** inside the timeline (`browser_evaluate` to set the scroll container's `scrollLeft`, or drag/scroll): assert the date header numbers and the team-event caps stay column-aligned with the body grid — capture a screenshot and visually confirm no horizontal offset between header and body.
2. **Scroll down**: assert the date header and the member/task sidebar both stay pinned (header at top, sidebar at left).
3. Click **Today**: assert the view recenters on the today marker and the today dashed line aligns with the same column in header and body.
4. Spot-check a **deadline marker** column-aligns with its header date after scrolling.
5. Click **PNG**: assert a `timeline.png` download is produced; open/inspect it (or screenshot the in-progress capture) and confirm it contains the **full** timeline — header row on top, member/task sidebar on the left, all rows and the full date range — with nothing clipped.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/exportPng.ts frontend/src/components/gantt/GanttChart.tsx
git commit -m "fix: unify Gantt into one scroll container so header stays synced"
```

---

## Finalization (after both parts)

- [ ] Run `npm run build` and `npm run lint` once more from `frontend/` — both clean.
- [ ] Remove the throwaway data dir (`rm -rf /tmp/tp-phase1-data`).
- [ ] Use superpowers:finishing-a-development-branch to decide how to integrate (merge to `master` / PR).

---

## Self-review notes (coverage check against the spec)

- Spec §A2 (nav move, `PageView`/`SlidePanel`, render branch, remove slide-over) → Task A2 steps 1–4.
- Spec §A3 (ImportPage: state, toolbar, selection bar, table columns, members popover, pre-select valid, Import Selected/All, imported lock, result/error, parse errors) → Task A1 component.
- Spec §A4 (delete `ImportPanel.tsx`) → Task A2 step 5.
- Spec §A (deadline color global, shown when ≥1 deadline row) → `hasDeadlineRows` + toolbar picker in Task A1.
- Spec §B2/B3 (single scroller, sticky header+sidebar, remove refs/handler, scroll math) → Task B1 steps 2–7.
- Spec §B4 (single-container PNG capture + call site) → Task B1 steps 1, 6.
- Spec §3 testing (build, lint, Playwright for both parts) → Task A2 step 7, Task B1 step 9.
- Reused unchanged (no task, by design): `api/import.ts`, `types/index.ts`, `GanttHeader.tsx`, `GanttTeamEventStrip.tsx`, backend.
