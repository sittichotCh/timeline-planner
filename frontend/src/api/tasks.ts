import type { TaskSetting } from "@/types";

export async function fetchTasks(): Promise<TaskSetting[]> {
  const res = await fetch("/api/tasks");
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return (await res.json()) ?? [];
}

export async function fetchTasksByMember(
  email: string
): Promise<TaskSetting[]> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json() as Promise<TaskSetting[]>;
}

export async function upsertTask(task: TaskSetting): Promise<TaskSetting> {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  if (!res.ok) throw new Error("Failed to save task");
  return res.json() as Promise<TaskSetting>;
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete task");
}

export async function reorderTasks(
  ranks: { task_id: string; rank: number }[]
): Promise<void> {
  const res = await fetch("/api/tasks/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ranks),
  });
  if (!res.ok) throw new Error("Failed to reorder tasks");
}
