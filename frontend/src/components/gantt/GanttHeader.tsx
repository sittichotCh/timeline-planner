import { formatDate, isWeekend } from "@/lib/dates";

interface GanttHeaderProps {
  dates: Date[];
  columnWidth: number;
}

interface MonthGroup {
  label: string;
  span: number;
}

const monthColors = [
  "bg-indigo-50/80 text-indigo-600",
  "bg-emerald-50/80 text-emerald-600",
  "bg-violet-50/80 text-violet-600",
  "bg-amber-50/80 text-amber-600",
  "bg-rose-50/80 text-rose-600",
  "bg-cyan-50/80 text-cyan-600",
  "bg-orange-50/80 text-orange-600",
  "bg-blue-50/80 text-blue-600",
  "bg-teal-50/80 text-teal-600",
  "bg-pink-50/80 text-pink-600",
  "bg-lime-50/80 text-lime-600",
  "bg-fuchsia-50/80 text-fuchsia-600",
];

function getMonthGroups(dates: Date[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let current: MonthGroup | null = null;
  for (const date of dates) {
    const label = date.toLocaleDateString("en", { month: "short", year: "numeric" });
    if (current && current.label === label) {
      current.span++;
    } else {
      current = { label, span: 1 };
      groups.push(current);
    }
  }
  return groups;
}

export function GanttHeader({ dates, columnWidth }: GanttHeaderProps) {
  const monthGroups = getMonthGroups(dates);

  return (
    <div className="border-b border-border bg-card">
      <div className="flex border-b border-border/50">
        {monthGroups.map((group, i) => (
          <div
            key={`${group.label}-${i}`}
            className={`flex-shrink-0 text-center text-[11px] font-semibold py-1.5 tracking-wide uppercase ${monthColors[i % monthColors.length]}`}
            style={{ width: group.span * columnWidth }}
          >
            {group.label}
          </div>
        ))}
      </div>
      <div className="flex">
        {dates.map((date) => {
          const weekend = isWeekend(date);
          const isFirst = date.getDate() === 1;
          const dayName = date.toLocaleDateString("en", { weekday: "short" });
          return (
            <div
              key={formatDate(date)}
              className={`flex-shrink-0 border-r border-border/30 text-center text-[10px] leading-tight py-1 ${
                weekend ? "bg-[#991700]/10 text-[#991700]" : "text-muted-foreground"
              } ${isFirst ? "font-semibold" : ""}`}
              style={{ width: columnWidth }}
            >
              <div className="font-medium">{date.getDate()}</div>
              <div className="text-[8px] opacity-70">{dayName}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
