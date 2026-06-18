import { useRef, useState } from "react";
import type { ImportResult } from "@/types";
import { importCsv } from "@/api/import";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Upload, FileDown, FileText } from "lucide-react";

interface ImportPanelProps {
  onImported: () => void;
  onClose: () => void;
}

const SAMPLE_CSV =
  "event_type,title,start_date,end_date,member_emails,scope,type,color,counts_as_working_day\n" +
  "event,Regression,2026-05-25,2026-05-29,alice@co.com|bob@co.com,personal,other,,false\n" +
  "event,On-call,2026-06-01,2026-06-05,carol@co.com,personal,oncall,,true\n" +
  "deadline,Release 1%,2026-08-03,,,,,red,\n";

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportPanel({ onImported, onClose }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await importCsv(file);
      setResult(res);
      if (res.imported_events + res.imported_deadlines > 0) {
        onImported();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" style={{ maxWidth: 420 }}>
        <SheetHeader>
          <SheetTitle>Import CSV</SheetTitle>
          <SheetDescription>
            Bulk-add events and deadlines from one CSV file.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-3">
          <div className="text-[12px] text-muted-foreground leading-relaxed">
            Each row needs an <code className="text-foreground">event_type</code> of{" "}
            <code className="text-foreground">event</code> or{" "}
            <code className="text-foreground">deadline</code>. Columns are matched by
            header name, so order doesn&rsquo;t matter.
          </div>

          <Button variant="outline" size="sm" onClick={downloadSample} className="w-full">
            <FileDown />
            Download sample CSV
          </Button>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => inputRef.current?.click()}
          >
            <FileText />
            {file ? file.name : "Choose CSV file…"}
          </Button>

          {error && (
            <div className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="bg-emerald-500/10 text-emerald-700 text-[12px] px-3 py-2 rounded-lg">
                Imported {result.imported_events} event{result.imported_events === 1 ? "" : "s"},{" "}
                {result.imported_deadlines} deadline{result.imported_deadlines === 1 ? "" : "s"}
                {result.skipped_duplicates > 0
                  ? ` · ${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? "" : "s"} skipped`
                  : ""}
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped
                  </p>
                  {result.errors.map((e) => (
                    <div
                      key={e.row}
                      className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg"
                    >
                      Line {e.row}: {e.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button onClick={handleImport} disabled={!file || busy} className="w-full">
            <Upload />
            {busy ? "Importing…" : "Import"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
