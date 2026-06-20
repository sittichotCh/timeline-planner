import type { CalendarSource, CalendarSyncResult } from "@/types";

export async function fetchCalendarSources(): Promise<CalendarSource[]> {
  const res = await fetch("/api/calendar-sources");
  if (!res.ok) throw new Error("Failed to fetch calendar sources");
  return (await res.json()) ?? [];
}

export async function createCalendarSource(
  input: Omit<CalendarSource, "id" | "last_synced_at">
): Promise<CalendarSource> {
  const res = await fetch("/api/calendar-sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create calendar source");
  return res.json() as Promise<CalendarSource>;
}

export async function updateCalendarSource(
  id: string,
  src: CalendarSource
): Promise<CalendarSource> {
  const res = await fetch(`/api/calendar-sources/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(src),
  });
  if (!res.ok) throw new Error("Failed to update calendar source");
  return res.json() as Promise<CalendarSource>;
}

export async function deleteCalendarSource(id: string): Promise<void> {
  const res = await fetch(`/api/calendar-sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete calendar source");
}

export async function syncCalendars(): Promise<CalendarSyncResult> {
  const res = await fetch("/api/calendar-sources/sync", { method: "POST" });
  if (!res.ok) throw new Error("Failed to sync calendars");
  return res.json() as Promise<CalendarSyncResult>;
}
