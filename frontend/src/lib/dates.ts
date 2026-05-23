export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function diffDays(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

export function parseDate(str: string): Date {
  return new Date(str + "T00:00:00");
}

export function generateDateRange(
  start: Date,
  end: Date
): Date[] {
  const dates: Date[] = [];
  let current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current = addDays(current, 1);
  }
  return dates;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export interface DateSegment {
  start: Date;
  days: number;
}

export function computeWorkingSegments(
  startDate: Date,
  effortDays: number,
  skipDays: Set<string>,
): DateSegment[] {
  const segments: DateSegment[] = [];
  let remaining = effortDays;
  let current = new Date(startDate);
  let segStart: Date | null = null;
  let segLen = 0;

  while (remaining > 0) {
    const key = formatDate(current);
    const skip = isWeekend(current) || skipDays.has(key);

    if (skip) {
      if (segStart) {
        segments.push({ start: segStart, days: segLen });
        segStart = null;
        segLen = 0;
      }
    } else {
      if (!segStart) segStart = new Date(current);
      segLen++;
      remaining--;
    }
    current = addDays(current, 1);
  }

  if (segStart) {
    segments.push({ start: segStart, days: segLen });
  }

  return segments;
}

export function getWorkingDays(
  startDate: Date,
  effortDays: number,
  skipDays: Set<string>,
): Set<string> {
  const days = new Set<string>();
  let remaining = effortDays;
  let current = new Date(startDate);

  while (remaining > 0) {
    const key = formatDate(current);
    if (!isWeekend(current) && !skipDays.has(key)) {
      days.add(key);
      remaining--;
    }
    current = addDays(current, 1);
  }

  return days;
}
