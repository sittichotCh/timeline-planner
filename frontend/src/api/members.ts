import type { Member } from "@/types";

export async function fetchMembers(): Promise<Member[]> {
  const res = await fetch("/api/members");
  if (!res.ok) throw new Error("Failed to fetch members");
  return (await res.json()) ?? [];
}

export async function createMember(
  member: Omit<Member, "created_at" | "seq">
): Promise<Member> {
  const res = await fetch("/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(member),
  });
  if (!res.ok) throw new Error("Failed to create member");
  return res.json() as Promise<Member>;
}

export async function updateMember(
  email: string,
  member: Partial<Member>
): Promise<Member> {
  const res = await fetch(`/api/members/${encodeURIComponent(email)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(member),
  });
  if (!res.ok) throw new Error("Failed to update member");
  return res.json() as Promise<Member>;
}

export async function deleteMember(email: string): Promise<void> {
  const res = await fetch(`/api/members/${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete member");
}

export async function reorderMembers(
  seqs: { email: string; seq: number }[]
): Promise<void> {
  const res = await fetch("/api/members/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seqs),
  });
  if (!res.ok) throw new Error("Failed to reorder members");
}
