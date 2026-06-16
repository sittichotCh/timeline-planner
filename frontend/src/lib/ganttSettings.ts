import { formatDate } from "@/lib/dates";

/** localStorage key under which the Gantt range + zoom settings are persisted. */
export const STORAGE_KEY = "gantt-settings";

/** First day of the current month, as an ISO YYYY-MM-DD string. */
export function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Last day of next month, as an ISO YYYY-MM-DD string. */
export function nextMonthEnd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return formatDate(last);
}

export interface GanttRange {
  rangeStart: string;
  rangeEnd: string;
}

/**
 * Read the persisted timeline From/To range, falling back to the default
 * window (current month start → next month end) when nothing is saved or the
 * stored value is unreadable. Returns ISO YYYY-MM-DD strings.
 *
 * This is the single source of truth for the range defaults; both GanttChart
 * (which writes the range) and the Events/Deadlines panels (which read it to
 * filter their lists) resolve through this function so they always agree.
 */
export function loadGanttRange(): GanttRange {
  let saved: { rangeStart?: string; rangeEnd?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    // leave saved as the default empty object already set above
  }
  return {
    rangeStart: saved.rangeStart ?? currentMonthStart(),
    rangeEnd: saved.rangeEnd ?? nextMonthEnd(),
  };
}
