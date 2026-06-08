import ExcelJS from "exceljs";
import type { Member, TaskSetting, CalendarEvent, Deadline } from "@/types";
import { parseDate, formatDate, generateDateRange, getWorkingDays, isWeekend } from "./dates";

const EVENT_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF4CCCC" },
};

const EFFORT_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF00FF00" },
};

const WEEKEND_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFD1DC" },
};

const DEADLINE_COLOR_MAP: Record<string, string> = {
  red: "FFDC2626",
  orange: "FFEA580C",
  amber: "FFD97706",
  emerald: "FF059669",
  blue: "FF2563EB",
  violet: "FF7C3AED",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const THIN_BORDER: ExcelJS.Border = { style: "thin", color: { argb: "FF000000" } };

function buildEventDays(
  members: Member[],
  events: CalendarEvent[],
): Map<string, Set<string>> {
  const teamEvents = events.filter((e) => e.scope === "team");
  const personalEvents = events.filter((e) => e.scope === "personal");
  const map = new Map<string, Set<string>>();

  for (const member of members) {
    const set = new Set<string>();
    const relevant = [
      ...personalEvents.filter((e) => e.member_emails.includes(member.email)),
      ...teamEvents,
    ];
    for (const ev of relevant) {
      const start = parseDate(ev.start_date);
      const end = parseDate(ev.end_date);
      const cur = new Date(start);
      while (cur <= end) {
        set.add(formatDate(cur));
        cur.setDate(cur.getDate() + 1);
      }
    }
    map.set(member.email, set);
  }
  return map;
}

interface MemberGroup {
  memberRow: number;
  lastTaskRow: number;
}

export async function exportTimelineToXlsx(
  members: Member[],
  tasks: TaskSetting[],
  events: CalendarEvent[],
  deadlines: Deadline[],
  rangeStart: string,
  rangeEnd: string,
  jiraBaseUrl = "",
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Timeline");

  const startDate = parseDate(rangeStart);
  const endDate = parseDate(rangeEnd);
  const dates = generateDateRange(startDate, endDate);
  const dateColStart = 2;
  const lastDateCol = dateColStart + dates.length - 1;

  const eventDaysMap = buildEventDays(members, events);

  // --- Column widths ---
  ws.getColumn(1).width = 20;
  for (let i = 0; i < dates.length; i++) {
    ws.getColumn(dateColStart + i).width = 4;
  }

  // --- Row 1: Month headers (merged per month group) ---
  const row1 = ws.getRow(1);
  let monthGroupStart = 0;
  for (let i = 0; i <= dates.length; i++) {
    const prev = i > 0 ? dates[i - 1]! : null;
    const curr = i < dates.length ? dates[i]! : null;
    const changed =
      !prev ||
      !curr ||
      prev.getMonth() !== curr.getMonth() ||
      prev.getFullYear() !== curr.getFullYear();

    if (changed && prev) {
      const startCol = dateColStart + monthGroupStart;
      const endCol = dateColStart + i - 1;
      if (endCol > startCol) {
        ws.mergeCells(1, startCol, 1, endCol);
      }
      const cell = row1.getCell(startCol);
      cell.value = `${MONTH_NAMES[prev.getMonth()]} ${prev.getFullYear()}`;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: "center" };
      cell.border = {
        left: THIN_BORDER,
        right: THIN_BORDER,
        top: THIN_BORDER,
        bottom: THIN_BORDER,
      };
      // Inner merged cells need top/bottom borders
      for (let c = startCol + 1; c <= endCol; c++) {
        const inner = row1.getCell(c);
        inner.border = {
          top: THIN_BORDER,
          bottom: THIN_BORDER,
          ...(c === endCol ? { right: THIN_BORDER } : {}),
        };
      }
      monthGroupStart = i;
    }
  }

  // --- Row 2: Day numbers with full borders ---
  const row2 = ws.getRow(2);
  for (let i = 0; i < dates.length; i++) {
    const cell = row2.getCell(dateColStart + i);
    cell.value = dates[i]!.getDate();
    cell.alignment = { horizontal: "center" };
    cell.font = { size: 8 };
    if (isWeekend(dates[i]!)) {
      cell.fill = WEEKEND_FILL;
    }
    cell.border = {
      left: THIN_BORDER,
      right: THIN_BORDER,
      top: THIN_BORDER,
      bottom: THIN_BORDER,
    };
  }

  let currentRow = 3;
  const memberGroups: MemberGroup[] = [];

  // --- Member + task rows ---
  const scheduledTasks = tasks.filter((t) => t.start_date);

  for (const member of members) {
    const memberTasks = scheduledTasks
      .filter((t) => t.member_email === member.email)
      .sort((a, b) => a.rank - b.rank);
    const eventDays = eventDaysMap.get(member.email) ?? new Set<string>();

    const groupStartRow = currentRow;

    // Member header row
    const memberRow = ws.getRow(currentRow);
    memberRow.getCell(1).value = member.name;
    memberRow.getCell(1).font = { bold: true, size: 10 };
    memberRow.getCell(1).border = {
      left: THIN_BORDER,
      right: THIN_BORDER,
      top: THIN_BORDER,
    };
    for (let i = 0; i < dates.length; i++) {
      const cell = memberRow.getCell(dateColStart + i);
      if (eventDays.has(formatDate(dates[i]!))) {
        cell.fill = EVENT_FILL;
      } else if (isWeekend(dates[i]!)) {
        cell.fill = WEEKEND_FILL;
      }
      cell.border = {
        top: THIN_BORDER,
        ...(dateColStart + i === lastDateCol ? { right: THIN_BORDER } : {}),
      };
    }
    currentRow++;

    // Task rows
    for (let tIdx = 0; tIdx < memberTasks.length; tIdx++) {
      const task = memberTasks[tIdx]!;
      const isLast = tIdx === memberTasks.length - 1;
      const taskRow = ws.getRow(currentRow);
      const taskIdCell = taskRow.getCell(1);
      if (jiraBaseUrl) {
        taskIdCell.value = {
          text: task.task_id,
          hyperlink: `${jiraBaseUrl}/browse/${task.task_id}`,
          tooltip: `Open ${task.task_id} in Jira`,
        };
        taskIdCell.font = { size: 9, color: { argb: "FF0563C1" }, underline: true };
      } else {
        taskIdCell.value = task.task_id;
        taskIdCell.font = { size: 9 };
      }
      taskIdCell.border = {
        left: THIN_BORDER,
        right: THIN_BORDER,
        ...(isLast ? { bottom: THIN_BORDER } : {}),
      };

      const workingDays = getWorkingDays(
        parseDate(task.start_date),
        task.effort,
        eventDays,
      );
      for (let i = 0; i < dates.length; i++) {
        const dateStr = formatDate(dates[i]!);
        const cell = taskRow.getCell(dateColStart + i);
        if (workingDays.has(dateStr)) {
          cell.fill = EFFORT_FILL;
        } else if (eventDays.has(dateStr)) {
          cell.fill = EVENT_FILL;
        } else if (isWeekend(dates[i]!)) {
          cell.fill = WEEKEND_FILL;
        }
        if (isLast || dateColStart + i === lastDateCol) {
          cell.border = {
            ...(isLast ? { bottom: THIN_BORDER } : {}),
            ...(dateColStart + i === lastDateCol ? { right: THIN_BORDER } : {}),
          };
        }
      }
      currentRow++;
    }

    // If member has no tasks, the member row is also the last row
    if (memberTasks.length === 0) {
      memberRow.getCell(1).border = {
        left: THIN_BORDER,
        right: THIN_BORDER,
        top: THIN_BORDER,
        bottom: THIN_BORDER,
      };
      for (let i = 0; i < dates.length; i++) {
        const cell = memberRow.getCell(dateColStart + i);
        const existing = cell.border ?? {};
        cell.border = {
          ...existing,
          top: THIN_BORDER,
          bottom: THIN_BORDER,
          ...(dateColStart + i === lastDateCol ? { right: THIN_BORDER } : {}),
        };
      }
    }

    memberGroups.push({
      memberRow: groupStartRow,
      lastTaskRow: currentRow - 1,
    });
  }

  // --- Deadline columns (merge vertically at the deadline date) ---
  const dataStartRow = 3;
  const dataEndRow = currentRow - 1;
  if (dataEndRow >= dataStartRow) {
    const sortedDeadlines = [...deadlines].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    for (const dl of sortedDeadlines) {
      const dateIdx = dates.findIndex((d) => formatDate(d) === dl.date);
      if (dateIdx < 0) continue;

      const col = dateColStart + dateIdx;
      ws.mergeCells(dataStartRow, col, dataEndRow, col);
      const cell = ws.getRow(dataStartRow).getCell(col);
      cell.value = dl.title;
      cell.alignment = {
        textRotation: 90,
        horizontal: "center",
        vertical: "middle",
      };
      cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: DEADLINE_COLOR_MAP[dl.color] ?? DEADLINE_COLOR_MAP.red!,
        },
      };
      cell.border = {
        left: THIN_BORDER,
        right: THIN_BORDER,
        top: THIN_BORDER,
        bottom: THIN_BORDER,
      };
    }
  }

  // --- Download ---
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "timeline.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
