import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { parseDate, diffDays } from "@/lib/dates";
import type { EventType } from "@/types";
import { EventTooltip } from "./EventTooltip";

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

const eventStyles: Record<string, string> = {
  leave: "bg-orange-100 border-orange-200",
  oncall: "bg-red-100 border-red-200",
  holiday: "bg-amber-100 border-amber-200",
  other: "bg-gray-100 border-gray-200",
};

export function GanttMergedEventRow({
  mergedEvents,
  totalHeight,
  dates,
  columnWidth,
  rangeStart,
}: GanttMergedEventRowProps) {
  const totalWidth = dates.length * columnWidth;
  const [hoveredEvent, setHoveredEvent] = useState<MergedEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div className="absolute inset-0 z-[5] pointer-events-none" style={{ width: totalWidth, height: totalHeight }}>
      {mergedEvents.map((event) => {
        const start = parseDate(event.start_date);
        const end = parseDate(event.end_date);
        const left = diffDays(start, rangeStart) * columnWidth;
        const width = (diffDays(end, start) + 1) * columnWidth;
        if (left + width < 0 || left > totalWidth) return null;
        const style = eventStyles[event.type] ?? "bg-gray-150/20 border-gray-200";
        return (
          <div
            key={event.key}
            className={`absolute top-0 rounded-lg border border-dashed flex items-center justify-center text-[13px] font-medium text-gray-500/70 overflow-hidden cursor-pointer pointer-events-auto ${style}`}
            style={{
              left: Math.max(0, left),
              width: Math.min(left + width, totalWidth) - Math.max(0, left),
              height: totalHeight,
            }}
            onMouseEnter={(e) => {
              if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
              const rect = e.currentTarget.getBoundingClientRect();
              setTooltipPos({ x: rect.left, y: rect.top + 30 });
              setHoveredEvent(event);
            }}
            onMouseLeave={() => {
              hoverTimeout.current = setTimeout(() => setHoveredEvent(null), 150);
            }}
          >
            <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap pointer-events-none">{event.title || event.type}</span>
          </div>
        );
      })}

      {hoveredEvent && createPortal(
        <div
          className="fixed z-50"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          }}
          onMouseLeave={() => {
            hoverTimeout.current = setTimeout(() => setHoveredEvent(null), 150);
          }}
        >
          <EventTooltip
            event={{ id: hoveredEvent.key, member_emails: [], scope: "team", type: hoveredEvent.type, title: hoveredEvent.title, start_date: hoveredEvent.start_date, end_date: hoveredEvent.end_date }}
            position={{ x: 0, y: 0 }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
