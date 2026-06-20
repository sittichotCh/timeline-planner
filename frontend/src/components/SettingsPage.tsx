import { useEffect, useRef, useState } from "react";
import type { CalendarSource, CalendarSyncResult, EventType } from "@/types";
import {
  fetchCalendarSources,
  createCalendarSource,
  updateCalendarSource,
  deleteCalendarSource,
  syncCalendars,
} from "@/api/calendarSources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, RefreshCw } from "lucide-react";

interface SettingsPageProps {
  onEventsChanged: () => void;
}

const eventTypes: EventType[] = ["oncall", "leave", "holiday", "other"];

interface DraftRow {
  id?: string;
  _clientId?: string;   // stable client-side key for unsaved rows
  name: string;
  url: string;
  event_type: EventType;
  last_synced_at?: string;
}

function toDraft(src: CalendarSource): DraftRow {
  return { id: src.id, name: src.name, url: src.url, event_type: src.event_type, last_synced_at: src.last_synced_at };
}

export function SettingsPage({ onEventsChanged }: SettingsPageProps) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const clientIdSeq = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalendarSyncResult | null>(null);

  useEffect(() => {
    fetchCalendarSources()
      .then((sources) => setRows(sources.map(toDraft)))
      .catch(() => setError("Failed to load calendar sources"));
  }, []);

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { _clientId: `new-${clientIdSeq.current++}`, name: "", url: "", event_type: "oncall" },
    ]);
  }

  async function saveRow(index: number) {
    const row = rows[index];
    if (!row) return;
    if (!row.name.trim() || !row.url.trim()) {
      setError("Name and URL are required");
      return;
    }
    setError(null);
    try {
      if (row.id) {
        const saved = await updateCalendarSource(row.id, {
          id: row.id,
          name: row.name,
          url: row.url,
          event_type: row.event_type,
          last_synced_at: row.last_synced_at,
        });
        updateRow(index, toDraft(saved));
      } else {
        const saved = await createCalendarSource({
          name: row.name,
          url: row.url,
          event_type: row.event_type,
        });
        updateRow(index, toDraft(saved));
      }
    } catch {
      setError("Failed to save calendar source");
    }
  }

  async function removeRow(index: number) {
    const row = rows[index];
    if (!row) return;
    if (row.id) {
      try {
        await deleteCalendarSource(row.id);
      } catch {
        setError("Failed to delete calendar source");
        return;
      }
    }
    setRows((prev) => prev.filter((_, i) => i !== index));
    onEventsChanged();
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await syncCalendars();
      setResult(res);
      // Refresh saved sources to pick up last_synced_at stamps.
      const sources = await fetchCalendarSources();
      setRows(sources.map(toDraft));
      onEventsChanged();
    } catch {
      setError("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="h-full overflow-auto p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Google Calendar Sync</h2>
          <p className="text-[12px] text-muted-foreground">
            Register public Google Calendar links. Events are matched to members by the email in each event's title.
          </p>
        </div>
        <Button size="sm" onClick={handleSync} disabled={syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Sync now
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-[12px]">
          {result.added} added · {result.updated} updated · {result.removed} removed · {result.skipped} skipped
          {result.sources.some((s) => s.error) && (
            <ul className="mt-1 text-red-700">
              {result.sources.filter((s) => s.error).map((s) => (
                <li key={s.source_id}>{s.name}: {s.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={row.id ?? row._clientId ?? `idx-${i}`} className="rounded-lg border p-3 space-y-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</Label>
                <Input
                  value={row.name}
                  placeholder="On-call calendar"
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  className="h-8 !text-[12px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Type</Label>
                <Select value={row.event_type} onValueChange={(v) => updateRow(i, { event_type: v as EventType })}>
                  <SelectTrigger className="h-8 !text-[12px] w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {eventTypes.map((t) => (
                      <SelectItem key={t} value={t} className="text-[12px]">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Calendar URL</Label>
              <Input
                value={row.url}
                placeholder="https://calendar.google.com/calendar/u/0?cid=…"
                onChange={(e) => updateRow(i, { url: e.target.value })}
                className="h-8 !text-[12px]"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {row.last_synced_at ? `Last synced ${new Date(row.last_synced_at).toLocaleString()}` : "Not synced yet"}
              </span>
              <div className="flex gap-2">
                <Button size="xs" variant="outline" onClick={() => saveRow(i)}>Save</Button>
                <Button size="xs" variant="ghost" onClick={() => removeRow(i)}>
                  <Trash2 className="text-red-600" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button size="sm" variant="outline" className="mt-3" onClick={addRow}>
        <Plus /> Add calendar
      </Button>
    </div>
  );
}
