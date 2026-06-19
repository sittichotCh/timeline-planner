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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileDown, FileText, User, Users } from "lucide-react";

interface ImportPanelProps {
  members: Member[];
  onImported: () => void;
  onClose: () => void;
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
  if (!row.data.end_date) return "Needs an end date to be an event — set this row to Deadline.";
  if (row.data.end_date < row.data.start_date) return "End date is before start date.";
  if (row.cfg.scope === "personal" && row.cfg.member_emails.length === 0)
    return "Select at least one member.";
  return null;
}

export function ImportPanel({ members, onImported, onClose }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ImportRowError[]>([]);
  const [deadlineColor, setDeadlineColor] = useState("red");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(f: File | null) {
    setFile(f);
    setRows([]);
    setParseErrors([]);
    setResult(null);
    setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const preview = await previewCsv(f);
      setRows(preview.rows.map((data) => ({ data, cfg: defaultConfig() })));
      setParseErrors(preview.errors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read CSV");
    } finally {
      setBusy(false);
    }
  }

  function updateRow(i: number, patch: Partial<RowConfig>) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, cfg: { ...r.cfg, ...patch } } : r)),
    );
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

  const hasDeadlineRows = rows.some((r) => r.cfg.kind === "deadline");
  const allValid = rows.length > 0 && rows.every(rowValid);
  const canImport = allValid && !busy;

  async function handleImport() {
    if (!canImport) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const events: Omit<CalendarEvent, "id">[] = [];
    const deadlines: Omit<Deadline, "id">[] = [];
    for (const r of rows) {
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
      if (res.imported_events + res.imported_deadlines > 0) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" style={{ maxWidth: 560 }}>
        <SheetHeader>
          <SheetTitle>Import CSV</SheetTitle>
          <SheetDescription>
            Upload a CSV (columns: title, start_date, end_date), then set up each row below.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadSample} className="flex-1">
              <FileDown />
              Sample CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 justify-start"
              onClick={() => inputRef.current?.click()}
            >
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
          </div>

          {hasDeadlineRows && (
            <div className="rounded-lg border p-2.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Deadline color (all deadline rows)
              </Label>
              <div className="flex gap-2 mt-1.5">
                {colorOptions.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setDeadlineColor(c.value)}
                    className={`w-6 h-6 rounded-full ${c.className} transition-all ${deadlineColor === c.value ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-60 hover:opacity-100"}`}
                  />
                ))}
              </div>
            </div>
          )}

          {rows.map((r, i) => {
            const hint = rowHint(r);
            return (
              <div key={i} className="rounded-xl border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium break-words">{r.data.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.data.start_date}{r.data.end_date ? ` → ${r.data.end_date}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-1 p-0.5 bg-muted rounded-lg shrink-0">
                    <button
                      type="button"
                      className={`text-[12px] font-medium px-2 py-1 rounded-md transition-colors ${r.cfg.kind === "event" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => updateRow(i, { kind: "event" })}
                    >
                      Event
                    </button>
                    <button
                      type="button"
                      className={`text-[12px] font-medium px-2 py-1 rounded-md transition-colors ${r.cfg.kind === "deadline" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => updateRow(i, { kind: "deadline" })}
                    >
                      Deadline
                    </button>
                  </div>
                </div>

                {r.cfg.kind === "event" ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
                        <button
                          type="button"
                          className={`flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-md transition-colors ${r.cfg.scope === "personal" ? "bg-orange-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => updateRow(i, { scope: "personal" })}
                        >
                          <User className="w-3 h-3" />
                          Personal
                        </button>
                        <button
                          type="button"
                          className={`flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-md transition-colors ${r.cfg.scope === "team" ? "bg-blue-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => updateRow(i, { scope: "team" })}
                        >
                          <Users className="w-3 h-3" />
                          Team
                        </button>
                      </div>
                      <Select value={r.cfg.type} onValueChange={(val) => updateRow(i, { type: val as EventType })}>
                        <SelectTrigger className="h-7 text-[12px] w-28">
                          <SelectValue>
                            {(value) => eventTypes.find((t) => t.value === value)?.label ?? String(value ?? "")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {eventTypes.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-indigo-600"
                          checked={r.cfg.counts_as_working_day}
                          onChange={(e) => updateRow(i, { counts_as_working_day: e.target.checked })}
                        />
                        working day
                      </label>
                    </div>

                    {r.cfg.scope === "personal" && (
                      <div className="flex flex-wrap gap-1.5">
                        {members.map((m) => {
                          const selected = r.cfg.member_emails.includes(m.email);
                          return (
                            <button
                              key={m.email}
                              type="button"
                              onClick={() => toggleRowMember(i, m.email)}
                              className={`text-[12px] font-medium px-2.5 py-1 rounded-full border transition-colors ${selected ? "bg-orange-500 text-white border-orange-500" : "bg-background text-muted-foreground border-border hover:border-orange-300 hover:text-foreground"}`}
                            >
                              {m.name}
                            </button>
                          );
                        })}
                        {members.length === 0 && (
                          <span className="text-[11px] text-muted-foreground">No members — add members first.</span>
                        )}
                      </div>
                    )}

                    {hint && <p className="text-[11px] text-destructive">{hint}</p>}
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Deadline on {r.data.start_date}; end date ignored. Color set above.
                  </p>
                )}
              </div>
            );
          })}

          {parseErrors.length > 0 && (
            <div className="space-y-1">
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

          {error && (
            <div className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-emerald-500/10 text-emerald-700 text-[12px] px-3 py-2 rounded-lg">
              Imported {result.imported_events} event{result.imported_events === 1 ? "" : "s"},{" "}
              {result.imported_deadlines} deadline{result.imported_deadlines === 1 ? "" : "s"}
              {result.skipped_duplicates > 0
                ? ` · ${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? "" : "s"} skipped`
                : ""}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button onClick={handleImport} disabled={!canImport} className="w-full">
            <Upload />
            {busy ? "Working…" : rows.length > 0 ? `Import ${rows.length} row${rows.length === 1 ? "" : "s"}` : "Import"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
