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
