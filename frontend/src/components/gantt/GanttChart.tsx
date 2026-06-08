import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Member, TaskSetting, CalendarEvent, Deadline } from "@/types";
import { diffDays, generateDateRange, parseDate, formatDate, isWeekend } from "@/lib/dates";
import { GanttHeader } from "./GanttHeader";
import { GanttMergedEventRow } from "./GanttMergedEventRow";
import { TaskBar } from "./TaskBar";
import { EventTooltip } from "./EventTooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Download, ZoomIn } from "lucide-react";
import { exportTimelineToXlsx } from "@/lib/exportXlsx";

interface GanttChartProps {
  members: Member[];
  tasks: TaskSetting[];
  events: CalendarEvent[];
  deadlines?: Deadline[];
  jiraBaseUrl?: string;
  onTaskUpdate?: (task: TaskSetting) => void;
  onOpenTask?: (taskId: string) => void;
}

const MEMBER_HEADER_HEIGHT = 40;
const TASK_ROW_HEIGHT = 44;
const BAR_HEIGHT = 28;
const SIDEBAR_WIDTH = 260;
const BASE_COLUMN_WIDTH = 42;

const ZOOM_LEVELS = [
  { label: "50%", scale: 0.5 },
  { label: "100%", scale: 1 },
  { label: "125%", scale: 1.25 },
  { label: "150%", scale: 1.5 },
] as const;

const STORAGE_KEY = "gantt-settings";

function loadSettings(): { rangeStart?: string; rangeEnd?: string; zoom?: number } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSettings(patch: Record<string, string | number>) {
  const current = loadSettings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
}

const memberPalettes = [
  { bar: "bg-green-400", text: "text-green-700", headerBg: "bg-green-50/60", accent: "bg-green-400" },
  { bar: "bg-blue-400", text: "text-blue-700", headerBg: "bg-blue-50/60", accent: "bg-blue-400" },
  { bar: "bg-amber-400", text: "text-amber-700", headerBg: "bg-amber-50/60", accent: "bg-amber-400" },
  { bar: "bg-rose-400", text: "text-rose-700", headerBg: "bg-rose-50/60", accent: "bg-rose-400" },
  { bar: "bg-violet-400", text: "text-violet-700", headerBg: "bg-violet-50/60", accent: "bg-violet-400" },
  { bar: "bg-cyan-400", text: "text-cyan-700", headerBg: "bg-cyan-50/60", accent: "bg-cyan-400" },
  { bar: "bg-orange-400", text: "text-orange-700", headerBg: "bg-orange-50/60", accent: "bg-orange-400" },
  { bar: "bg-pink-400", text: "text-pink-700", headerBg: "bg-pink-50/60", accent: "bg-pink-400" },
];

interface TeamEvent {
  key: string;
  type: CalendarEvent["type"];
  title: string;
  start_date: string;
  end_date: string;
}

function splitEvents(events: CalendarEvent[]): { team: TeamEvent[]; personal: CalendarEvent[] } {
  const team: TeamEvent[] = [];
  const personal: CalendarEvent[] = [];
  for (const ev of events) {
    if (ev.scope === "team") {
      team.push({ key: ev.id, type: ev.type, title: ev.title, start_date: ev.start_date, end_date: ev.end_date });
    } else {
      personal.push(ev);
    }
  }
  return { team, personal };
}

const deadlineColorMap: Record<string, { line: string; bg: string; text: string }> = {
  red: { line: "bg-red-500", bg: "bg-red-50", text: "text-red-700" },
  orange: { line: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700" },
  amber: { line: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
  emerald: { line: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  blue: { line: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  violet: { line: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-700" },
};

type RowItem =
  | { kind: "header"; member: Member; colorIdx: number; taskCount: number }
  | { kind: "task"; task: TaskSetting; colorIdx: number; memberEmail: string };

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function nextMonthEnd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return formatDate(last);
}

export function GanttChart({ members, tasks, events, deadlines = [], jiraBaseUrl = "", onTaskUpdate, onOpenTask }: GanttChartProps) {
  const saved = useMemo(() => loadSettings(), []);
  const [rangeStartStr, setRangeStartStr] = useState(() => saved.rangeStart ?? currentMonthStart());
  const [rangeEndStr, setRangeEndStr] = useState(() => saved.rangeEnd ?? nextMonthEnd());
  const [zoomIndex, setZoomIndex] = useState(() => {
    const idx = ZOOM_LEVELS.findIndex((z) => z.scale === saved.zoom);
    return idx >= 0 ? idx : 1;
  });
  const [hoveredMember, setHoveredMember] = useState<string | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<CalendarEvent | null>(null);
  const [eventTooltipPos, setEventTooltipPos] = useState({ x: 0, y: 0 });
  const eventHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeStart = parseDate(rangeStartStr);
  const rangeEnd = parseDate(rangeEndStr);
  const dates = generateDateRange(rangeStart, rangeEnd);
  const columnWidth = Math.round(BASE_COLUMN_WIDTH * ZOOM_LEVELS[zoomIndex]!.scale);
  const totalWidth = dates.length * columnWidth;
  const todayOffset = (diffDays(today, rangeStart) + 0.5) * columnWidth;

  const { team, personal } = useMemo(() => splitEvents(events), [events]);
  // DONE tasks drop off the timeline entirely — both their rows and their
  // contribution to member workload totals.
  const visibleTasks = useMemo(() => tasks.filter((t) => t.plan_status !== "DONE"), [tasks]);
  const scheduledTasks = useMemo(() => visibleTasks.filter((t) => t.start_date), [visibleTasks]);
  const unscheduledTasks = useMemo(() => visibleTasks.filter((t) => !t.start_date), [visibleTasks]);

  const rows = useMemo((): RowItem[] => {
    const result: RowItem[] = [];
    members.forEach((member, idx) => {
      const colorIdx = idx % memberPalettes.length;
      const memberTasks = scheduledTasks.filter((t) => t.member_email === member.email);
      result.push({ kind: "header", member, colorIdx, taskCount: memberTasks.length });
      memberTasks.forEach((task) => {
        result.push({ kind: "task", task, colorIdx, memberEmail: member.email });
      });
    });
    return result;
  }, [members, scheduledTasks]);

  const totalBodyHeight = useMemo(() => {
    return rows.reduce((sum, row) => sum + (row.kind === "header" ? MEMBER_HEADER_HEIGHT : TASK_ROW_HEIGHT), 0);
  }, [rows]);

  const memberYRanges = useMemo(() => {
    const ranges = new Map<string, { top: number; height: number }>();
    let y = 0;
    let currentEmail: string | null = null;
    let currentTop = 0;
    for (const row of rows) {
      if (row.kind === "header") {
        if (currentEmail !== null) {
          ranges.set(currentEmail, { top: currentTop, height: y - currentTop });
        }
        currentEmail = row.member.email;
        currentTop = y;
        y += MEMBER_HEADER_HEIGHT;
      } else {
        y += TASK_ROW_HEIGHT;
      }
    }
    if (currentEmail !== null) {
      ranges.set(currentEmail, { top: currentTop, height: y - currentTop });
    }
    return ranges;
  }, [rows]);

  const skipDaysMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const member of members) {
      const set = new Set<string>();
      const memberEvents = [...personal.filter((e) => e.member_emails.includes(member.email)), ...team];
      for (const event of memberEvents) {
        const start = parseDate(event.start_date);
        const end = parseDate(event.end_date);
        const days = diffDays(end, start) + 1;
        for (let d = 0; d < days; d++) {
          const date = new Date(start);
          date.setDate(date.getDate() + d);
          set.add(formatDate(date));
        }
      }
      map.set(member.email, set);
    }
    return map;
  }, [members, personal, team]);

  const memberWorkloads = useMemo(() => {
    const map = new Map<string, { taskCount: number; totalDays: number }>();
    for (const member of members) {
      const memberTasks = scheduledTasks.filter((t) => t.member_email === member.email);
      const backlogTasks = unscheduledTasks.filter((t) => t.member_email === member.email);
      const totalDays = memberTasks.reduce((s, t) => s + t.effort, 0)
        + backlogTasks.reduce((s, t) => s + t.effort, 0);
      map.set(member.email, { taskCount: memberTasks.length + backlogTasks.length, totalDays });
    }
    return map;
  }, [members, scheduledTasks, unscheduledTasks]);

  const firstTaskOffset = useMemo(() => {
    if (scheduledTasks.length === 0) return null;
    let earliest = Infinity;
    for (const t of scheduledTasks) {
      const d = diffDays(parseDate(t.start_date), rangeStart);
      if (d < earliest) earliest = d;
    }
    return earliest * columnWidth;
  }, [scheduledTasks, rangeStart, columnWidth]);

  useEffect(() => {
    const clientWidth = chartRef.current?.clientWidth ?? 0;
    let scrollLeft: number;
    if (firstTaskOffset !== null && firstTaskOffset > todayOffset + clientWidth * 0.6) {
      scrollLeft = Math.min(todayOffset, firstTaskOffset) - clientWidth * 0.15;
    } else {
      scrollLeft = todayOffset - clientWidth / 3;
    }
    scrollLeft = Math.max(0, scrollLeft);
    if (chartRef.current) chartRef.current.scrollLeft = scrollLeft;
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = scrollLeft;
  }, [rangeStartStr, rangeEndStr, todayOffset, firstTaskOffset]);

  const scrollToToday = useCallback(() => {
    const scrollLeft = todayOffset - (chartRef.current?.clientWidth ?? 0) / 3;
    chartRef.current?.scrollTo({ left: scrollLeft, behavior: "smooth" });
    headerScrollRef.current?.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }, [todayOffset]);

  function handleRangeStartChange(value: string) {
    setRangeStartStr(value);
    saveSettings({ rangeStart: value });
  }

  function handleRangeEndChange(value: string) {
    setRangeEndStr(value);
    saveSettings({ rangeEnd: value });
  }

  function handleZoomChange(idx: number) {
    setZoomIndex(idx);
    saveSettings({ zoom: ZOOM_LEVELS[idx]!.scale });
  }

  function handleChartScroll() {
    if (chartRef.current && sidebarRef.current) sidebarRef.current.scrollTop = chartRef.current.scrollTop;
    if (chartRef.current && headerScrollRef.current) headerScrollRef.current.scrollLeft = chartRef.current.scrollLeft;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold tracking-tight">Timeline</h2>
          <Badge variant="secondary" className="text-[11px]">{members.length} members</Badge>
          <Button variant="destructive" size="xs" onClick={scrollToToday}>
            <CalendarDays />
            Today
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              exportTimelineToXlsx(members, visibleTasks, events, deadlines, rangeStartStr, rangeEndStr, jiraBaseUrl)
            }
          >
            <Download />
            Export
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 border rounded-md bg-muted/50 p-0.5">
            <ZoomIn className="w-3.5 h-3.5 text-muted-foreground ml-1.5" />
            {ZOOM_LEVELS.map((level, idx) => (
              <button
                key={level.label}
                onClick={() => handleZoomChange(idx)}
                className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
                  idx === zoomIndex
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground font-medium">From</label>
            <input
              type="date"
              value={rangeStartStr}
              onChange={(e) => handleRangeStartChange(e.target.value)}
              className="text-[12px] border rounded-md px-2 py-1 bg-background"
            />
            <label className="text-[11px] text-muted-foreground font-medium">To</label>
            <input
              type="date"
              value={rangeEndStr}
              onChange={(e) => handleRangeEndChange(e.target.value)}
              className="text-[12px] border rounded-md px-2 py-1 bg-background"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex flex-shrink-0">
          <div className="flex-shrink-0 border-r border-b bg-card flex items-end px-3 pb-1" style={{ width: SIDEBAR_WIDTH }}>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Member / Task</span>
          </div>
          <div ref={headerScrollRef} className="flex-1 overflow-hidden">
            <GanttHeader dates={dates} columnWidth={columnWidth} />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="flex-shrink-0 border-r bg-card" style={{ width: SIDEBAR_WIDTH }}>
            <div ref={sidebarRef} className="h-full overflow-hidden">
              {rows.map((row) => {
                if (row.kind === "header") {
                  const palette = memberPalettes[row.colorIdx]!;
                  const workload = memberWorkloads.get(row.member.email);
                  return (
                    <div
                      key={`h-${row.member.email}`}
                      className={`flex items-center gap-2.5 px-3 border-b ${palette.headerBg} ${hoveredMember === row.member.email ? "brightness-95" : ""}`}
                      style={{ height: MEMBER_HEADER_HEIGHT }}
                      onMouseEnter={() => setHoveredMember(row.member.email)}
                      onMouseLeave={() => setHoveredMember(null)}
                    >
                      <div className={`w-1 h-5 rounded-full flex-shrink-0 ${palette.accent}`} />
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <span className={`text-[13px] font-semibold italic truncate ${palette.text}`}>
                          {row.member.name}
                        </span>
                        {row.member.role && (
                          <span className="text-[10px] text-muted-foreground truncate hidden xl:inline">
                            {row.member.role}
                          </span>
                        )}
                      </div>
                      {workload && workload.taskCount > 0 && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap flex-shrink-0">
                          {workload.taskCount}t
                        </span>
                      )}
                    </div>
                  );
                }
                return (
                  <div
                    key={`t-${row.task.task_id}`}
                    className={`flex items-center gap-2 pl-6 pr-3 border-b border-border/30 cursor-pointer hover:bg-muted/50 transition-colors ${hoveredMember === row.memberEmail ? "bg-muted/30" : ""}`}
                    style={{ height: TASK_ROW_HEIGHT }}
                    onClick={() => onOpenTask?.(row.task.task_id)}
                    onMouseEnter={() => setHoveredMember(row.memberEmail)}
                    onMouseLeave={() => setHoveredMember(null)}
                  >
                    <span className="text-[10px] font-mono font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded flex-shrink-0">
                      {row.task.task_id}
                    </span>
                    <span className="text-[12px] text-foreground truncate">
                      {row.task.summary}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chart area */}
          <div ref={chartRef} className="flex-1 overflow-auto" onScroll={handleChartScroll}>
            <div className="relative" style={{ width: totalWidth, minHeight: totalBodyHeight }}>
              {/* Background grid */}
              <div className="absolute inset-0 pointer-events-none flex" style={{ height: totalBodyHeight }}>
                {dates.map((date) => (
                  <div
                    key={formatDate(date)}
                    className={`flex-shrink-0 border-r border-border/20 ${isWeekend(date) ? "bg-[#991700]/10" : ""}`}
                    style={{ width: columnWidth }}
                  />
                ))}
              </div>

              {/* Team event overlays */}
              {team.length > 0 && (
                <GanttMergedEventRow
                  mergedEvents={team}
                  totalHeight={totalBodyHeight}
                  dates={dates}
                  columnWidth={columnWidth}
                  rangeStart={rangeStart}
                />
              )}

              {/* Personal event overlays — merged across a member's rows */}
              {personal.flatMap((ev) => {
                const start = parseDate(ev.start_date);
                const end = parseDate(ev.end_date);
                const left = diffDays(start, rangeStart) * columnWidth;
                const width = (diffDays(end, start) + 1) * columnWidth;
                if (left + width < 0 || left > totalWidth) return [];
                const clippedLeft = Math.max(0, left);
                const clippedWidth = Math.min(left + width, totalWidth) - clippedLeft;
                return ev.member_emails.flatMap((email) => {
                  const range = memberYRanges.get(email);
                  if (!range) return [];
                  return [(
                    <div
                      key={`${ev.id}-${email}`}
                      className="absolute z-[3] flex items-center justify-center overflow-hidden cursor-pointer"
                      style={{ left: clippedLeft, width: clippedWidth, top: range.top, height: range.height, backgroundColor: "rgba(186, 0, 0, 0.15)", border: "1px solid rgba(186, 0, 0, 0.4)" }}
                      onMouseEnter={(e) => {
                        if (eventHoverTimeout.current) clearTimeout(eventHoverTimeout.current);
                        const rect = e.currentTarget.getBoundingClientRect();
                        setEventTooltipPos({ x: rect.left, y: rect.bottom });
                        setHoveredEvent(ev);
                      }}
                      onMouseLeave={() => {
                        eventHoverTimeout.current = setTimeout(() => setHoveredEvent(null), 150);
                      }}
                    >
                      <span className="text-[10px] font-medium text-red-900/60 truncate px-1 pointer-events-none">
                        {ev.title}
                      </span>
                    </div>
                  )];
                });
              })}

              {/* Deadline markers */}
              {deadlines.map((dl) => {
                const dlDate = parseDate(dl.date);
                const offset = (diffDays(dlDate, rangeStart) + 0.5) * columnWidth;
                if (offset < 0 || offset > totalWidth) return null;
                const colors = deadlineColorMap[dl.color] ?? deadlineColorMap.red!;
                return (
                  <div key={dl.id} className="absolute top-0 z-[8] pointer-events-none" style={{ left: offset, height: totalBodyHeight }}>
                    <div className={`w-0.5 h-full ${colors.line} opacity-60`} style={{ marginLeft: -1 }} />
                    <div className={`absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${colors.line} ring-2 ring-white shadow-sm`} />
                    <div className={`absolute top-3 left-1 whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shadow-sm`}>
                      {dl.title}
                    </div>
                  </div>
                );
              })}

              {/* Today marker */}
              {todayOffset >= 0 && todayOffset <= totalWidth && (
                <div className="absolute top-0 z-10 pointer-events-none" style={{ left: todayOffset, height: totalBodyHeight }}>
                  <div className="w-px h-full border-l-2 border-dashed border-indigo-400/50" />
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-2 ring-white shadow" />
                </div>
              )}

              {/* Row content */}
              <div className="relative z-[1]">
                {rows.map((row) => {
                  if (row.kind === "header") {
                    const palette = memberPalettes[row.colorIdx]!;
                    return (
                      <div
                        key={`ch-${row.member.email}`}
                        className={`relative border-b ${palette.headerBg} ${hoveredMember === row.member.email ? "brightness-95" : ""}`}
                        style={{ height: MEMBER_HEADER_HEIGHT }}
                        onMouseEnter={() => setHoveredMember(row.member.email)}
                        onMouseLeave={() => setHoveredMember(null)}
                      />
                    );
                  }

                  const skipDays = skipDaysMap.get(row.memberEmail) ?? new Set<string>();
                  const palette = memberPalettes[row.colorIdx]!;

                  return (
                    <div
                      key={`ct-${row.task.task_id}`}
                      className={`relative border-b border-border/30 ${hoveredMember === row.memberEmail ? "bg-muted/30" : ""}`}
                      style={{ height: TASK_ROW_HEIGHT }}
                      onMouseEnter={() => setHoveredMember(row.memberEmail)}
                      onMouseLeave={() => setHoveredMember(null)}
                    >
                      <TaskBar
                        task={row.task}
                        skipDays={skipDays}
                        columnWidth={columnWidth}
                        rangeStart={rangeStart}
                        totalWidth={totalWidth}
                        jiraBaseUrl={jiraBaseUrl}
                        onTaskUpdate={onTaskUpdate}
                        onOpenTask={onOpenTask}
                        rowHeight={TASK_ROW_HEIGHT}
                        barHeight={BAR_HEIGHT}
                        barColor={palette.bar}
                        deadlines={deadlines}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {hoveredEvent && createPortal(
        <div
          className="fixed z-50"
          style={{ left: eventTooltipPos.x, top: eventTooltipPos.y }}
          onMouseEnter={() => {
            if (eventHoverTimeout.current) clearTimeout(eventHoverTimeout.current);
          }}
          onMouseLeave={() => {
            eventHoverTimeout.current = setTimeout(() => setHoveredEvent(null), 150);
          }}
        >
          <EventTooltip event={hoveredEvent} position={{ x: 0, y: 0 }} />
        </div>,
        document.body,
      )}
    </div>
  );
}
