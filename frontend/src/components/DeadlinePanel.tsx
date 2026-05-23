import { useState } from "react";
import type { Deadline } from "@/types";
import { createDeadline, updateDeadline, deleteDeadline } from "@/api/deadlines";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Flag } from "lucide-react";

interface DeadlinePanelProps {
  deadlines: Deadline[];
  onDeadlinesChange: (deadlines: Deadline[]) => void;
  onClose: () => void;
}

interface DeadlineFormData {
  title: string;
  date: string;
  color: string;
}

const emptyForm: DeadlineFormData = { title: "", date: "", color: "red" };

const colorOptions = [
  { value: "red", label: "Red", className: "bg-red-500" },
  { value: "orange", label: "Orange", className: "bg-orange-500" },
  { value: "amber", label: "Amber", className: "bg-amber-500" },
  { value: "emerald", label: "Green", className: "bg-emerald-500" },
  { value: "blue", label: "Blue", className: "bg-blue-500" },
  { value: "violet", label: "Violet", className: "bg-violet-500" },
];

export function DeadlinePanel({ deadlines, onDeadlinesChange, onClose }: DeadlinePanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<DeadlineFormData>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startAdd() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
    setError(null);
  }

  function startEdit(deadline: Deadline) {
    setEditing(deadline.id);
    setForm({ title: deadline.title, date: deadline.date, color: deadline.color });
    setShowForm(true);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.title || !form.date) {
      setError("Title and date are required");
      return;
    }
    try {
      if (editing) {
        const updated = await updateDeadline(editing, { id: editing, ...form });
        onDeadlinesChange(deadlines.map((d) => (d.id === editing ? updated : d)));
      } else {
        const created = await createDeadline(form);
        onDeadlinesChange([...deadlines, created]);
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDeadline(id);
      onDeadlinesChange(deadlines.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function getColorClass(color: string): string {
    return colorOptions.find((c) => c.value === color)?.className ?? "bg-red-500";
  }

  const sorted = [...deadlines].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" style={{ maxWidth: 420 }}>
        <SheetHeader>
          <SheetTitle>Deadlines</SheetTitle>
          <SheetDescription>{deadlines.length} deadlines</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          {error && (
            <div className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">{error}</div>
          )}

          {sorted.map((deadline) => {
            const isPast = deadline.date < new Date().toISOString().slice(0, 10);
            return (
              <div key={deadline.id} className="group flex items-center justify-between p-3 rounded-xl border hover:shadow-sm transition-all">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-3 h-10 rounded-full flex-shrink-0 ${getColorClass(deadline.color)}`} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{deadline.title}</div>
                    <div className={`text-[11px] mt-0.5 ${isPast ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {deadline.date}{isPast ? " (past)" : ""}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="xs" onClick={() => startEdit(deadline)}>Edit</Button>
                  <Button variant="destructive" size="xs" onClick={() => handleDelete(deadline.id)}>Delete</Button>
                </div>
              </div>
            );
          })}

          {deadlines.length === 0 && !showForm && (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <Flag className="size-6 text-muted-foreground" />
              </div>
              <p className="text-[13px] text-muted-foreground font-medium">No deadlines yet</p>
              <p className="text-[11px] text-muted-foreground mt-1">Add milestones and release dates to track.</p>
            </div>
          )}
        </div>

        {showForm ? (
          <form onSubmit={handleSubmit} className="border-t p-4 space-y-3">
            <p className="text-[13px] font-semibold">{editing ? "Edit Deadline" : "Add Deadline"}</p>
            <Input placeholder="Title (e.g., Sprint 10 Release)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Date</Label>
              <Input type="date" className="mt-1" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Color</Label>
              <div className="flex gap-2 mt-1.5">
                {colorOptions.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm({ ...form, color: c.value })}
                    className={`w-7 h-7 rounded-full ${c.className} transition-all ${form.color === c.value ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-60 hover:opacity-100"}`}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1">{editing ? "Update" : "Add Deadline"}</Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <SheetFooter>
            <Button onClick={startAdd} className="w-full">
              <Plus />
              Add Deadline
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
