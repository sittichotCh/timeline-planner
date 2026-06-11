import { parseDate, diffDays } from "@/lib/dates";
import type { EventType } from "@/types";

interface MergedEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}

interface GanttMergedEventRowProps {
  mergedEvents: MergedEvent[];
  totalHeight: number;
  dates: Date[];
  columnWidth: number;
  rangeStart: Date;
}

// Faint full-height tints — these sit BEHIND the task bars (z-0) purely to mark
// the date range a team-wide event covers. The readable label + tooltip live in
// the top strip (GanttTeamEventStrip), so the band itself is decoration only.
const eventBandStyles: Record<string, string> = {
  leave: "bg-orange-200/25 border-orange-300/40",
  oncall: "bg-red-200/25 border-red-300/40",
  holiday: "bg-amber-200/30 border-amber-300/40",
  other: "bg-gray-200/25 border-gray-300/40",
};

export function GanttMergedEventRow({
  mergedEvents,
  totalHeight,
  dates,
  columnWidth,
  rangeStart,
}: GanttMergedEventRowProps) {
  const totalWidth = dates.length * columnWidth;

  return (
    <div className="absolute inset-0 z-0 pointer-events-none" style={{ width: totalWidth, height: totalHeight }}>
      {mergedEvents.map((event) => {
        const start = parseDate(event.start_date);
        const end = parseDate(event.end_date);
        const left = diffDays(start, rangeStart) * columnWidth;
        const width = (diffDays(end, start) + 1) * columnWidth;
        if (left + width < 0 || left > totalWidth) return null;
        const style = eventBandStyles[event.type] ?? eventBandStyles.other;
        return (
          <div
            key={event.key}
            className={`absolute top-0 border-x border-dashed ${style}`}
            style={{
              left: Math.max(0, left),
              width: Math.min(left + width, totalWidth) - Math.max(0, left),
              height: totalHeight,
            }}
          />
        );
      })}
    </div>
  );
}
