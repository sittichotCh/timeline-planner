import type { CalendarEvent } from "@/types";

interface EventTooltipProps {
  event: CalendarEvent;
  position: { x: number; y: number };
}

const typeLabels: Record<string, string> = {
  leave: "Leave",
  oncall: "Oncall",
  holiday: "Holiday",
  other: "Other",
};

const scopeStyles: Record<string, string> = {
  personal: "bg-red-50 text-red-700 ring-1 ring-red-200",
  team: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
};

const typeStyles: Record<string, string> = {
  leave: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  oncall: "bg-red-50 text-red-700 ring-1 ring-red-200",
  holiday: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  other: "bg-gray-50 text-gray-600 ring-1 ring-gray-200",
};

export function EventTooltip({ event, position }: EventTooltipProps) {
  return (
    <div
      className="pt-2"
      style={{ marginLeft: position.x, marginTop: position.y }}
    >
    <div className="bg-white rounded-xl shadow-xl ring-1 ring-black/5 p-4 w-64 backdrop-blur-sm">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${scopeStyles[event.scope] ?? "bg-gray-50 text-gray-600 ring-1 ring-gray-200"}`}>
            {event.scope === "team" ? "Team" : "Personal"}
          </span>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${typeStyles[event.type] ?? "bg-gray-50 text-gray-600 ring-1 ring-gray-200"}`}>
            {typeLabels[event.type] ?? event.type}
          </span>
        </div>
        <p className="text-[13px] text-gray-900 font-medium leading-snug">{event.title}</p>
        <div className="flex gap-4 text-[11px] text-gray-500">
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
              <path fillRule="evenodd" d="M4 1.75a.75.75 0 01.75.75V3h6.5V2.5a.75.75 0 011.5 0V3h.25A1.75 1.75 0 0114.75 4.75v8.5A1.75 1.75 0 0113 15H3A1.75 1.75 0 011.25 13.25v-8.5A1.75 1.75 0 013 3h.25V2.5A.75.75 0 014 1.75z" clipRule="evenodd" />
            </svg>
            {event.start_date}
          </div>
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
              <path fillRule="evenodd" d="M2 8a.75.75 0 01.75-.75h8.69L8.22 4.03a.75.75 0 011.06-1.06l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06l3.22-3.22H2.75A.75.75 0 012 8z" clipRule="evenodd" />
            </svg>
            {event.end_date}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
