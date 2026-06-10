/**
 * Map a Jira "Dev points" custom-field value to a task's effort (in days).
 * Half values are preserved as-is (e.g. 1.5 stays 1.5) — the chart rounds up
 * to whole days only for rendering. Returns null when the issue has no Dev
 * points value, letting callers fall back to a default.
 */
export function devPointsToEffort(devPoints: number | null | undefined): number | null {
  if (devPoints == null) return null;
  return devPoints;
}

/**
 * Tailwind classes for a Jira issue-type badge, keyed by type name. Unknown
 * types fall back to a neutral style via issueTypeBadgeStyle().
 */
export const issueTypeBadgeClass: Record<string, string> = {
  Story: "bg-green-50 text-green-700 border-green-200",
  Bug: "bg-red-50 text-red-700 border-red-200",
  Task: "bg-blue-50 text-blue-700 border-blue-200",
  "Sub-task": "bg-sky-50 text-sky-700 border-sky-200",
  Subtask: "bg-sky-50 text-sky-700 border-sky-200",
  Epic: "bg-purple-50 text-purple-700 border-purple-200",
  Improvement: "bg-teal-50 text-teal-700 border-teal-200",
  "New Feature": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function issueTypeBadgeStyle(issueType: string): string {
  return issueTypeBadgeClass[issueType] ?? "bg-muted text-muted-foreground border-border";
}
