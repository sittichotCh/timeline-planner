import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseDate, diffDays } from "@/lib/dates";
import type { EventType } from "@/types";
import { EventTooltip } from "./EventTooltip";

interface TeamEvent {
  key: string;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}

interface GanttTeamEventStripProps {
  teamEvents: TeamEvent[];
  rangeStart: Date;
  columnWidth: number;
  totalWidth: number;
}

const pillStyles: Record<string, string> = {
  leave: "bg-orange-100 text-orange-700 border-orange-200",
  oncall: "bg-red-100 text-red-700 border-red-200",
  holiday: "bg-amber-100 text-amber-700 border-amber-200",
  other: "bg-gray-100 text-gray-600 border-gray-200",
};

const LANE_HEIGHT = 20;
const LANE_GAP = 2;

// A horizontal lane of team-event pills pinned above the chart. Pills are
// positioned by date and greedily packed into lanes so overlapping events stack
// downward instead of colliding. Lives inside the (horizontally-synced) header
// scroll area so it stays column-aligned and fixed while the body scrolls.
export function GanttTeamEventStrip({ teamEvents, rangeStart, columnWidth, totalWidth }: GanttTeamEventStripProps) {
  const [hovered, setHovered] = useState<TeamEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const laid = (() => {
    const items = teamEvents
      .map((ev) => {
        const start = parseDate(ev.start_date);
        const end = parseDate(ev.end_date);
        const left = diffDays(start, rangeStart) * columnWidth;
        const width = (diffDays(end, start) + 1) * columnWidth;
        return { ev, left, width, right: left + width };
      })
      .filter((it) => it.right > 0 && it.left < totalWidth)
      .sort((a, b) => a.left - b.left);

    const laneRight: number[] = [];
    return items.map((it) => {
      let lane = 0;
      while (lane < laneRight.length && laneRight[lane]! > it.left) lane++;
      laneRight[lane] = it.right;
      return { ...it, lane };
    });
  })();

  const laneCount = laid.reduce((m, it) => Math.max(m, it.lane + 1), 0);
  const height = laneCount * (LANE_HEIGHT + LANE_GAP) + 4;

  return (
    <div className="relative border-b border-border bg-card/60" style={{ width: totalWidth, height }}>
      {laid.map((it) => {
        const clippedLeft = Math.max(0, it.left);
        const clippedWidth = Math.min(it.right, totalWidth) - clippedLeft;
        const style = pillStyles[it.ev.type] ?? pillStyles.other;
        return (
          <div
            key={it.ev.key}
            className={`absolute flex items-center rounded-md border text-[10px] font-medium px-1.5 overflow-hidden whitespace-nowrap cursor-pointer ${style}`}
            style={{
              left: clippedLeft,
              width: clippedWidth,
              top: it.lane * (LANE_HEIGHT + LANE_GAP) + 2,
              height: LANE_HEIGHT,
            }}
            onMouseEnter={(e) => {
              if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
              const rect = e.currentTarget.getBoundingClientRect();
              setTooltipPos({ x: rect.left, y: rect.bottom });
              setHovered(it.ev);
            }}
            onMouseLeave={() => {
              hoverTimeout.current = setTimeout(() => setHovered(null), 150);
            }}
          >
            {it.ev.title || it.ev.type}
          </div>
        );
      })}

      {hovered && createPortal(
        <div
          className="fixed z-50"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          }}
          onMouseLeave={() => setHovered(null)}
        >
          <EventTooltip
            event={{ id: hovered.key, member_emails: [], scope: "team", type: hovered.type, title: hovered.title, start_date: hovered.start_date, end_date: hovered.end_date }}
            position={{ x: 0, y: 0 }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
