import type { CalendarEvent } from "@/types";
import { addDays, diffDays, parseDate, shiftISODate } from "@/lib/dates";
import { hatchBackground } from "@/lib/eventHatch";
import { useDayDrag } from "./useDayDrag";
import { DragDatePill } from "./DragDatePill";

interface PersonalEventBarsProps {
  event: CalendarEvent;
  /** Per-member vertical placement on the timeline. */
  memberYRanges: Map<string, { top: number; height: number }>;
  rangeStart: Date;
  columnWidth: number;
  totalWidth: number;
  onUpdate?: (event: CalendarEvent) => void;
  onShowTooltip: (event: CalendarEvent, x: number, y: number) => void;
  onHideTooltip: () => void;
}

export function PersonalEventBars({
  event,
  memberYRanges,
  rangeStart,
  columnWidth,
  totalWidth,
  onUpdate,
  onShowTooltip,
  onHideTooltip,
}: PersonalEventBarsProps) {
  const { dragging, dragOffset, daysMoved, dragPos, onMouseDown } = useDayDrag(
    columnWidth,
    (days) =>
      onUpdate?.({
        ...event,
        start_date: shiftISODate(event.start_date, days),
        end_date: shiftISODate(event.end_date, days),
      }),
  );

  const start = parseDate(event.start_date);
  const end = parseDate(event.end_date);
  const baseLeft = diffDays(start, rangeStart) * columnWidth;
  const width = (diffDays(end, start) + 1) * columnWidth;
  const left = baseLeft + (dragging ? dragOffset : 0);
  if (left + width < 0 || left > totalWidth) return null;
  const clippedLeft = Math.max(0, left);
  const clippedWidth = Math.min(left + width, totalWidth) - clippedLeft;

  // Synced (Google Calendar) events are owned by sync — a drag would just be
  // reverted on the next sync, so lock them (no drag, no grab cursor).
  const locked = event.source === "google";

  return (
    <>
      {event.member_emails.map((email) => {
        const range = memberYRanges.get(email);
        if (!range) return null;
        const working = event.counts_as_working_day;
        const fillStyle = working
          ? { backgroundImage: hatchBackground(event.type), border: "1px dashed rgba(107, 114, 128, 0.6)" }
          : { backgroundColor: "rgba(186, 0, 0, 0.15)", border: "1px solid rgba(186, 0, 0, 0.4)" };
        return (
          <div
            key={`${event.id}-${email}`}
            className={`absolute z-[3] flex items-center justify-center overflow-hidden select-none ${locked ? "cursor-default" : "cursor-grab"} ${dragging ? "opacity-90 cursor-grabbing z-20" : ""}`}
            style={{
              left: clippedLeft,
              width: clippedWidth,
              top: range.top,
              height: range.height,
              ...fillStyle,
            }}
            onMouseDown={locked ? undefined : onMouseDown}
            onMouseEnter={(e) => {
              if (dragging) return;
              const rect = e.currentTarget.getBoundingClientRect();
              onShowTooltip(event, rect.left, rect.bottom);
            }}
            onMouseLeave={() => {
              if (dragging) return;
              onHideTooltip();
            }}
          >
            <span className={`text-[10px] font-medium truncate px-1 pointer-events-none ${working ? "text-foreground bg-background/85 rounded" : "text-red-900/60"}`}>
              {event.title}
            </span>
          </div>
        );
      })}
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(start, daysMoved)} daysMoved={daysMoved} />
      )}
    </>
  );
}
