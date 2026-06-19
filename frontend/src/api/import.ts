import type { CalendarEvent, Deadline, ImportResult, ImportRowError } from "@/types";

export interface ImportRow {
  title: string;
  start_date: string;
  end_date: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  errors: ImportRowError[];
}

export interface ImportCommit {
  events: Omit<CalendarEvent, "id">[];
  deadlines: Omit<Deadline, "id">[];
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // response had no JSON body; keep the fallback
  }
  return fallback;
}

export async function previewCsv(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/import/preview", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Failed to read CSV"));
  }
  return (await res.json()) as ImportPreview;
}

export async function commitImport(payload: ImportCommit): Promise<ImportResult> {
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Failed to import"));
  }
  return (await res.json()) as ImportResult;
}
