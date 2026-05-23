import type { JiraIssue } from "@/types";

export interface JiraConfig {
  baseUrl: string;
}

export async function fetchJiraConfig(): Promise<JiraConfig> {
  const res = await fetch("/api/jira/config");
  if (!res.ok) throw new Error("Failed to fetch Jira config");
  return res.json() as Promise<JiraConfig>;
}

export interface JiraSyncResponse {
  issues: JiraIssue[];
  total: number;
  nextPageToken?: string;
}

export async function syncJira(
  jql: string,
  maxResults: number,
  nextPageToken?: string
): Promise<JiraSyncResponse> {
  const body: Record<string, unknown> = { jql, maxResults };
  if (nextPageToken) body.nextPageToken = nextPageToken;

  const res = await fetch("/api/jira/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to sync Jira issues");
  return res.json() as Promise<JiraSyncResponse>;
}
