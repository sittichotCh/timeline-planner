import type { CalendarEvent } from "@/types";

export async function fetchEvents(): Promise<CalendarEvent[]> {
  const res = await fetch("/api/events");
  if (!res.ok) throw new Error("Failed to fetch events");
  return (await res.json()) ?? [];
}

export async function fetchEventsByMember(
  email: string
): Promise<CalendarEvent[]> {
  const res = await fetch(`/api/events/${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json() as Promise<CalendarEvent[]>;
}

export async function createEvent(
  event: CalendarEvent
): Promise<CalendarEvent> {
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error("Failed to create event");
  return res.json() as Promise<CalendarEvent>;
}

export async function updateEvent(
  id: string,
  event: CalendarEvent
): Promise<CalendarEvent> {
  const res = await fetch(`/api/events/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error("Failed to update event");
  return res.json() as Promise<CalendarEvent>;
}

export async function deleteEvent(id: string): Promise<void> {
  const res = await fetch(`/api/events/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete event");
}
