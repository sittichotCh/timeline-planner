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
