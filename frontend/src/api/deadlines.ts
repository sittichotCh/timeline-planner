import type { Deadline } from "@/types";

export async function fetchDeadlines(): Promise<Deadline[]> {
  const res = await fetch("/api/deadlines");
  if (!res.ok) throw new Error("Failed to fetch deadlines");
  return (await res.json()) ?? [];
}

export async function createDeadline(deadline: Omit<Deadline, "id">): Promise<Deadline> {
  const res = await fetch("/api/deadlines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deadline),
  });
  if (!res.ok) throw new Error("Failed to create deadline");
  return res.json() as Promise<Deadline>;
}

export async function updateDeadline(id: string, deadline: Deadline): Promise<Deadline> {
  const res = await fetch(`/api/deadlines/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deadline),
  });
  if (!res.ok) throw new Error("Failed to update deadline");
  return res.json() as Promise<Deadline>;
}

export async function deleteDeadline(id: string): Promise<void> {
  const res = await fetch(`/api/deadlines/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete deadline");
}
