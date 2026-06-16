import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, parseDate, diffDays, shiftISODate } from "@/lib/dates";
import type { CalendarEvent, EventType } from "@/types";
import { EventTooltip } from "./EventTooltip";
import { useDayDrag } from "./useDayDrag";
import { DragDatePill } from "./DragDatePill";

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
  onEventUpdate?: (event: CalendarEvent) => void;
}

// Cap styles mirror the dashed band below (GanttMergedEventRow): saturated fill
// + matching dashed border colour, so each label reads as the top of the band's
// box rather than a separate pill.
const capStyles: Record<string, string> = {
  leave: "bg-orange-100 text-orange-700 border-orange-500/70",
  oncall: "bg-red-100 text-red-700 border-red-500/70",
  holiday: "bg-amber-100 text-amber-700 border-amber-500/70",
  other: "bg-gray-100 text-gray-600 border-gray-500/70",
};

const LANE_HEIGHT = 20;
const LANE_GAP = 2;

// A row of team-event "caps" pinned directly beneath the date header. Each cap
// spans its event's full date range and carries a rounded-top dashed border that
// is open at the bottom, so it merges into the matching dashed band in the chart
// body — label + band form one connected box. Lane 0 is anchored to the bottom
// so it sits flush against the band; overlapping events stack upward. Lives in
// the (horizontally-synced) header scroll area so it stays column-aligned.
export function GanttTeamEventStrip({ teamEvents, rangeStart, columnWidth, totalWidth, onEventUpdate }: GanttTeamEventStripProps) {
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
  const height = laneCount * (LANE_HEIGHT + LANE_GAP);

  return (
    <div className="relative bg-card" style={{ width: totalWidth, height }}>
      {laid.map((it) => (
        <TeamEventCap
          key={it.ev.key}
          item={it}
          height={height}
          columnWidth={columnWidth}
          totalWidth={totalWidth}
          onEventUpdate={onEventUpdate}
          onHover={(ev, x, y) => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            setTooltipPos({ x, y });
            setHovered(ev);
          }}
          onLeave={() => {
            hoverTimeout.current = setTimeout(() => setHovered(null), 150);
          }}
        />
      ))}

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

interface LaidTeamEvent {
  ev: TeamEvent;
  left: number;
  width: number;
  right: number;
  lane: number;
}

interface TeamEventCapProps {
  item: LaidTeamEvent;
  height: number;
  columnWidth: number;
  totalWidth: number;
  onEventUpdate?: (event: CalendarEvent) => void;
  onHover: (ev: TeamEvent, x: number, y: number) => void;
  onLeave: () => void;
}

function TeamEventCap({ item, height, columnWidth, totalWidth, onEventUpdate, onHover, onLeave }: TeamEventCapProps) {
  const { dragging, dragOffset, daysMoved, dragPos, onMouseDown } = useDayDrag(
    columnWidth,
    (days) =>
      onEventUpdate?.({
        id: item.ev.key,
        member_emails: [],
        scope: "team",
        type: item.ev.type,
        title: item.ev.title,
        start_date: shiftISODate(item.ev.start_date, days),
        end_date: shiftISODate(item.ev.end_date, days),
      }),
  );

  const offset = dragging ? dragOffset : 0;
  const left = item.left + offset;
  const right = item.right + offset;
  const clippedLeft = Math.max(0, left);
  const clippedWidth = Math.min(right, totalWidth) - clippedLeft;
  // lane 0 sits flush at the bottom (capping the band); extra lanes stack upward
  const top = height - (item.lane + 1) * LANE_HEIGHT - item.lane * LANE_GAP;
  const style = capStyles[item.ev.type] ?? capStyles.other;

  return (
    <>
      <div
        className={`absolute flex items-center border-2 border-b-0 border-dashed text-[10px] font-medium px-1.5 overflow-hidden whitespace-nowrap cursor-grab select-none ${dragging ? "cursor-grabbing z-20 opacity-90" : ""} ${style}`}
        style={{ left: clippedLeft, width: clippedWidth, top, height: LANE_HEIGHT }}
        onMouseDown={onMouseDown}
        onMouseEnter={(e) => {
          if (dragging) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onHover(item.ev, rect.left, rect.bottom);
        }}
        onMouseLeave={() => {
          if (dragging) return;
          onLeave();
        }}
      >
        {item.ev.title || item.ev.type}
      </div>
      {dragging && (
        <DragDatePill cursor={dragPos} date={addDays(parseDate(item.ev.start_date), daysMoved)} daysMoved={daysMoved} />
      )}
    </>
  );
}
