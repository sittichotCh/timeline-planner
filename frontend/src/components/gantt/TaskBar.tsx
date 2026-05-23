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
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      setDragOffset(e.clientX - dragging.startX);
    },
    [dragging],
  );

  const handleMouseUp = useCallback(() => {
    if (!dragging) return;
    const daysMoved = Math.round(dragOffset / columnWidth);
    if (daysMoved !== 0) {
      onTaskUpdate?.({ ...task, start_date: formatDate(addDays(parseDate(task.start_date), daysMoved)) });
    } else {
      onOpenTask?.(task.task_id);
    }
    setDragging(null);
    setDragOffset(0);
  }, [dragging, dragOffset, columnWidth, onTaskUpdate, onOpenTask, task]);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  const start = parseDate(task.start_date);
  const effortDays = task.effort;
  const segments = computeWorkingSegments(start, effortDays, skipDays);

  const isOverdue = (() => {
    if (!task.deadline_id) return false;
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
    </>
  );
}
