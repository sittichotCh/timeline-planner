import { parseDate, diffDays } from "@/lib/dates";
import type { EventType } from "@/types";
import { hatchBackground } from "@/lib/eventHatch";

interface MergedEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
  counts_as_working_day: boolean;
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
const bandFill: Record<string, string> = {
  leave: "bg-orange-200/25",
  oncall: "bg-red-200/25",
  holiday: "bg-amber-200/25",
  other: "bg-gray-200/25",
};

const bandBorder: Record<string, string> = {
  leave: "border-orange-500/70",
  oncall: "border-red-500/70",
  holiday: "border-amber-500/70",
  other: "border-gray-500/70",
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
        const border = bandBorder[event.type] ?? bandBorder.other;
        const working = event.counts_as_working_day;
        const fill = working ? "" : (bandFill[event.type] ?? bandFill.other);
        return (
          <div
            key={event.key}
            className={`absolute top-0 border-2 border-dashed ${border} ${fill}`}
            style={{
              left: Math.max(0, left),
              width: Math.min(left + width, totalWidth) - Math.max(0, left),
              height: totalHeight,
              ...(working ? { backgroundImage: hatchBackground(event.type) } : {}),
            }}
          />
        );
      })}
    </div>
  );
}
