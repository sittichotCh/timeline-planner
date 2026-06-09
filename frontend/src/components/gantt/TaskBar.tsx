import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { TaskSetting, Deadline } from "@/types";
import { parseDate, diffDays, formatDate, addDays, computeWorkingSegments, getWorkingDays } from "@/lib/dates";
import { TaskTooltip } from "./TaskTooltip";

interface TaskBarProps {
  task: TaskSetting;
  skipDays: Set<string>;
  columnWidth: number;
  rangeStart: Date;
  totalWidth: number;
  jiraBaseUrl: string;
  onTaskUpdate?: (task: TaskSetting) => void;
  onOpenTask?: (taskId: string) => void;
  rowHeight: number;
  barHeight: number;
  barColor: string;
  deadlines: Deadline[];
}

export function TaskBar({
  task,
  skipDays,
  columnWidth,
  rangeStart,
  totalWidth,
  jiraBaseUrl,
  onTaskUpdate,
  onOpenTask,
  rowHeight,
  barHeight,
  barColor,
  deadlines,
}: TaskBarProps) {
  const [dragging, setDragging] = useState<{ startX: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      setDragOffset(e.clientX - dragging.startX);
      setDragPos({ x: e.clientX, y: e.clientY });
    },
    [dragging],
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      // Compute the offset from the actual release position rather than from
      // dragOffset state: the mouseup can fire before React re-renders after
      // the final mousemove, leaving the state (and this closure) one move
      // stale — which made the drop land a day off from the indicator.
      const finalOffset = e.clientX - dragging.startX;
      const daysMoved = Math.round(finalOffset / columnWidth);
      if (daysMoved !== 0) {
        onTaskUpdate?.({ ...task, start_date: formatDate(addDays(parseDate(task.start_date), daysMoved)) });
      } else {
        onOpenTask?.(task.task_id);
      }
      setDragging(null);
      setDragOffset(0);
    },
    [dragging, columnWidth, onTaskUpdate, onOpenTask, task],
  );

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  const isScheduled = Boolean(task.start_date);
  // Effort can carry half days (from Jira "Dev points"); the bar always spans
  // whole working days, so round fractional effort up for rendering.
  const effortDays = Math.ceil(task.effort);
  const start = isScheduled ? parseDate(task.start_date) : null;
  const segments = start ? computeWorkingSegments(start, effortDays, skipDays) : [];

  const isOverdue = (() => {
    if (!start || !task.deadline_id) return false;
    const dl = deadlines.find((d) => d.id === task.deadline_id);
    if (!dl) return false;
    const workingDays = getWorkingDays(start, effortDays, skipDays);
    const lastDay = Array.from(workingDays).sort().pop();
    return lastDay !== undefined && lastDay > dl.date;
  })();

  const topOffset = (rowHeight - barHeight) / 2;

  return (
    <>
      {segments.map((seg, si) => {
        const left = diffDays(seg.start, rangeStart) * columnWidth + (dragging ? dragOffset : 0);
        const width = seg.days * columnWidth;
        if (left + width < 0 || left > totalWidth) return null;
        const isFirst = si === 0;
        const isLast = si === segments.length - 1;
        return (
          <div
            key={si}
            className={`absolute flex items-center px-3 text-[11px] text-black font-medium cursor-grab select-none shadow-sm hover:shadow-md transition-shadow ${barColor} ${dragging ? "opacity-80 cursor-grabbing z-20 shadow-lg" : ""} ${isOverdue ? "ring-2 ring-red-500/80 ring-offset-1" : ""}`}
            style={{
              left: Math.max(0, left),
              width: Math.min(left + width, totalWidth) - Math.max(0, left),
              top: topOffset,
              height: barHeight,
              borderRadius: `${isFirst ? barHeight / 2 : 4}px ${isLast ? barHeight / 2 : 4}px ${isLast ? barHeight / 2 : 4}px ${isFirst ? barHeight / 2 : 4}px`,
            }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              setHovered(false);
              setDragging({ startX: e.clientX });
              setDragOffset(0);
              setDragPos({ x: e.clientX, y: e.clientY });
            }}
            onMouseEnter={(e) => {
              if (dragging) return;
              if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
              const rect = e.currentTarget.getBoundingClientRect();
              setTooltipPos({ x: rect.left, y: rect.bottom });
              setHovered(true);
            }}
            onMouseLeave={() => {
              if (dragging) return;
              hoverTimeout.current = setTimeout(() => setHovered(false), 150);
            }}
          >
            {isFirst && (
              <span className="truncate pointer-events-none drop-shadow-sm">
                <span className="font-bold opacity-80">{task.task_id}</span>{task.summary ? ` ${task.summary}` : ""}
              </span>
            )}
            {isOverdue && isLast && (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 ml-auto flex-shrink-0 drop-shadow-md">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            )}
          </div>
        );
      })}

      {hovered && !dragging && createPortal(
        <div
          className="fixed z-50"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          }}
          onMouseLeave={() => setHovered(false)}
        >
          <TaskTooltip task={task} jiraBaseUrl={jiraBaseUrl} position={{ x: 0, y: 8 }} deadlines={deadlines} />
        </div>,
        document.body,
      )}

      {dragging && start && createPortal((() => {
        const daysMoved = Math.round(dragOffset / columnWidth);
        const previewStart = addDays(start, daysMoved);
        const dateLabel = previewStart.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const deltaLabel = daysMoved === 0 ? "no change" : `${daysMoved > 0 ? "+" : ""}${daysMoved}d`;
        return (
          <div
            className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full rounded-md bg-indigo-600 text-white shadow-lg px-2 py-1 flex items-center gap-1.5 whitespace-nowrap"
            style={{ left: dragPos.x, top: dragPos.y - 14 }}
          >
            <span className="text-[11px] font-semibold">{dateLabel}</span>
            <span className="text-[10px] font-medium text-indigo-200">{deltaLabel}</span>
          </div>
        );
      })(), document.body)}
    </>
  );
}
