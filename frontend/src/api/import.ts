import type { ImportResult } from "@/types";

export async function importCsv(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/import", { method: "POST", body: form });
  if (!res.ok) {
    let message = "Failed to import CSV";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // response had no JSON body; keep the default message
    }
    throw new Error(message);
  }
  return (await res.json()) as ImportResult;
}
