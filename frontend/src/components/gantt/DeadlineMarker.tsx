import type { Deadline } from "@/types";
import { addDays, parseDate, shiftISODate } from "@/lib/dates";
import { useDayDrag } from "./useDayDrag";
import { DragDatePill } from "./DragDatePill";

const deadlineColorMap: Record<string, { line: string; bg: string; text: string }> = {
  red: { line: "bg-red-500", bg: "bg-red-50", text: "text-red-700" },
  orange: { line: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700" },
  amber: { line: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
  emerald: { line: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  blue: { line: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  violet: { line: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-700" },
};

interface DeadlineMarkerProps {
  deadline: Deadline;
  /** Px from the left of the body to the deadline's day-center line. */
  offset: number;
  /** Vertical stacking lane (avoids label collisions). */
  lane: number;
  /** Full body height, so the line spans every row. */
  totalHeight: number;
  columnWidth: number;
  onUpdate?: (deadline: Deadline) => void;
}

export function DeadlineMarker({ deadline, offset, lane, totalHeight, columnWidth, onUpdate }: DeadlineMarkerProps) {
  const colors = deadlineColorMap[deadline.color] ?? deadlineColorMap.red!;
  const { dragging, dragOffset, daysMoved, dragPos, onMouseDown } = useDayDrag(
    columnWidth,
    (days) => onUpdate?.({ ...deadline, date: shiftISODate(deadline.date, days) }),
  );
  const liveOffset = offset + (dragging ? dragOffset : 0);

  return (
    <div className="absolute top-0 z-[8] pointer-events-none" style={{ left: liveOffset, height: totalHeight }}>
      <div className={`w-0.5 h-full ${colors.line} opacity-60`} style={{ marginLeft: -1 }} />
      <div className={`absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${colors.line} ring-2 ring-white shadow-sm`} />
      <div
        className={`absolute left-1 whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shadow-sm pointer-events-auto cursor-grab select-none ${dragging ? "cursor-grabbing ring-1 ring-indigo-400" : ""}`}
        style={{ top: 12 + lane * 18 }}
        onMouseDown={onMouseDown}
      >
        {deadline.title}
      </div>
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(parseDate(deadline.date), daysMoved)} daysMoved={daysMoved} />
      )}
    </div>
  );
}
