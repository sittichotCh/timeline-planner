import { useState } from "react";
import type { CalendarEvent, EventScope, EventType, Member } from "@/types";
import { createEvent, updateEvent, deleteEvent } from "@/api/events";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Calendar, Users, User } from "lucide-react";

interface EventPanelProps {
  events: CalendarEvent[];
  members: Member[];
  onEventsChange: (events: CalendarEvent[]) => void;
  onClose: () => void;
}

interface EventFormData {
  scope: EventScope;
  member_emails: string[];
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}

const emptyForm: EventFormData = {
  scope: "personal",
  member_emails: [],
  type: "leave",
  title: "",
  start_date: "",
  end_date: "",
};

const eventTypes: { value: EventType; label: string; color: string }[] = [
  { value: "leave", label: "Leave", color: "bg-orange-400" },
  { value: "oncall", label: "Oncall", color: "bg-red-400" },
  { value: "holiday", label: "Holiday", color: "bg-amber-400" },
  { value: "other", label: "Other", color: "bg-gray-400" },
];

function titleForType(type: EventType, customTitle: string): string {
  const t = eventTypes.find((e) => e.value === type);
  if (type === "other") return customTitle;
  return t?.label ?? type;
}

export function EventPanel({ events, members, onEventsChange, onClose }: EventPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<EventFormData>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startAdd() {
    setEditing(null);
    setForm({ ...emptyForm, member_emails: [] });
    setShowForm(true);
    setError(null);
  }

  function startEdit(event: CalendarEvent) {
    setEditing(event.id);
    setForm({
      scope: event.scope,
      member_emails: [...event.member_emails],
      type: event.type,
      title: event.title,
      start_date: event.start_date,
      end_date: event.end_date,
    });
    setShowForm(true);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.scope === "personal" && form.member_emails.length === 0) {
      setError("At least one member is required for personal events");
      return;
    }
    if (!form.start_date || !form.end_date) {
      setError("Start date and end date are required");
      return;
    }
    if (form.type === "other" && !form.title.trim()) {
      setError("Title is required for Other events");
      return;
    }
    try {
      const payload: CalendarEvent = {
        id: editing ?? "",
        scope: form.scope,
        member_emails: form.scope === "team" ? [] : form.member_emails,
        type: form.type,
        title: titleForType(form.type, form.title),
        start_date: form.start_date,
        end_date: form.end_date,
      };
      if (editing) {
        const updated = await updateEvent(editing, payload);
        onEventsChange(events.map((ev) => (ev.id === editing ? updated : ev)));
      } else {
        const created = await createEvent(payload);
        onEventsChange([...events, created]);
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
      await deleteEvent(id);
      onEventsChange(events.filter((ev) => ev.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function getMemberName(email: string): string {
    return members.find((m) => m.email === email)?.name ?? email;
  }

  function toggleMember(email: string) {
    setForm((prev) => {
      const has = prev.member_emails.includes(email);
      return {
        ...prev,
        member_emails: has
          ? prev.member_emails.filter((e) => e !== email)
          : [...prev.member_emails, email],
      };
    });
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" style={{ maxWidth: 420 }}>
        <SheetHeader>
          <SheetTitle>Calendar Events</SheetTitle>
          <SheetDescription>{events.length} events</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          {error && (
            <div className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">{error}</div>
          )}

          {events.map((event) => {
            const typeInfo = eventTypes.find((t) => t.value === event.type);
            return (
              <div key={event.id} className="group flex items-center justify-between p-3 rounded-xl border hover:shadow-sm transition-all">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-8 rounded-full flex-shrink-0 ${typeInfo?.color ?? "bg-gray-400"}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium truncate">
                        {event.title || event.type}
                      </span>
                      <Badge variant={event.scope === "team" ? "default" : "secondary"} className="text-[10px]">
                        {event.scope === "team" ? "Team" : "Personal"}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {event.scope === "team"
                        ? "All Members"
                        : event.member_emails.map((e) => getMemberName(e)).join(", ")}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {event.start_date} &rarr; {event.end_date}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="xs" onClick={() => startEdit(event)}>Edit</Button>
                  <Button variant="destructive" size="xs" onClick={() => handleDelete(event.id)}>Delete</Button>
                </div>
              </div>
            );
          })}

          {events.length === 0 && !showForm && (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <Calendar className="size-6 text-muted-foreground" />
              </div>
              <p className="text-[13px] text-muted-foreground font-medium">No events yet</p>
              <p className="text-[11px] text-muted-foreground mt-1">Add holidays, vacations, or busy periods.</p>
            </div>
          )}
        </div>

        {showForm ? (
          <form onSubmit={handleSubmit} className="border-t p-4 space-y-3">
            <p className="text-[13px] font-semibold">{editing ? "Edit Event" : "Add Event"}</p>
            <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
              <button
                type="button"
                className={`flex-1 flex items-center justify-center gap-1.5 text-[13px] font-medium py-1.5 rounded-md transition-colors ${
                  form.scope === "personal"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setForm({ ...form, scope: "personal" })}
              >
                <User className="w-3.5 h-3.5" />
                Personal
              </button>
              <button
                type="button"
                className={`flex-1 flex items-center justify-center gap-1.5 text-[13px] font-medium py-1.5 rounded-md transition-colors ${
                  form.scope === "team"
                    ? "bg-blue-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setForm({ ...form, scope: "team" })}
              >
                <Users className="w-3.5 h-3.5" />
                Team
              </button>
            </div>
            {form.scope === "personal" && (
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Members</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const selected = form.member_emails.includes(m.email);
                    return (
                      <button
                        key={m.email}
                        type="button"
                        onClick={() => toggleMember(m.email)}
                        className={`text-[12px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                          selected
                            ? "bg-orange-500 text-white border-orange-500"
                            : "bg-background text-muted-foreground border-border hover:border-orange-300 hover:text-foreground"
                        }`}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <Select value={form.type} onValueChange={(val) => setForm({ ...form, type: val as EventType })}>
              <SelectTrigger className="w-full h-8 text-[12px]">
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
            {form.type === "other" && (
              <Input placeholder="Title" className="h-8 !text-[12px]" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Start</Label>
                <Input type="date" className="h-8 !text-[12px] mt-1" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">End</Label>
                <Input type="date" className="h-8 !text-[12px] mt-1" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" className="flex-1">{editing ? "Update" : "Add Event"}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <SheetFooter>
            <Button onClick={startAdd} className="w-full">
              <Plus />
              Add Event
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
