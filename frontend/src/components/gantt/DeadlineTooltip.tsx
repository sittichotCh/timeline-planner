import type { Deadline } from "@/types";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface DeadlineTooltipProps {
  deadline: Deadline;
  position: { x: number; y: number };
  onDelete?: () => void;
}

const colorDot: Record<string, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
};

export function DeadlineTooltip({ deadline, position, onDelete }: DeadlineTooltipProps) {
  return (
    <div
      className="pt-2"
      style={{ marginLeft: position.x, marginTop: position.y }}
    >
    <div className="bg-white rounded-xl shadow-xl ring-1 ring-black/5 p-4 w-64 backdrop-blur-sm">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${colorDot[deadline.color] ?? "bg-red-500"}`} />
          <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Deadline</span>
        </div>
        <p className="text-[13px] text-gray-900 font-medium leading-snug">{deadline.title}</p>
        <div className="flex items-center gap-1 text-[11px] text-gray-500">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
            <path fillRule="evenodd" d="M4 1.75a.75.75 0 01.75.75V3h6.5V2.5a.75.75 0 011.5 0V3h.25A1.75 1.75 0 0114.75 4.75v8.5A1.75 1.75 0 0113 15H3A1.75 1.75 0 011.25 13.25v-8.5A1.75 1.75 0 013 3h.25V2.5A.75.75 0 014 1.75z" clipRule="evenodd" />
          </svg>
          {deadline.date}
        </div>
        {onDelete && (
          <Button variant="destructive" size="xs" className="w-full mt-1" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </Button>
        )}
      </div>
    </div>
    </div>
  );
}
