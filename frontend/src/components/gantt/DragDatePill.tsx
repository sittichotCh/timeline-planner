import { createPortal } from "react-dom";

interface DragDatePillProps {
  /** Cursor position to anchor the pill to. */
  cursor: { x: number; y: number };
  /** The prospective date to display. */
  date: Date;
  /** Day delta, for the "+3d" / "no change" suffix. */
  daysMoved: number;
}

/** Floating indicator shown while dragging a timeline item. */
export function DragDatePill({ cursor, date, daysMoved }: DragDatePillProps) {
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const deltaLabel = daysMoved === 0 ? "no change" : `${daysMoved > 0 ? "+" : ""}${daysMoved}d`;
  return createPortal(
    <div
      className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full rounded-md bg-indigo-600 text-white shadow-lg px-2 py-1 flex items-center gap-1.5 whitespace-nowrap"
      style={{ left: cursor.x, top: cursor.y - 14 }}
    >
      <span className="text-[11px] font-semibold">{dateLabel}</span>
      <span className="text-[10px] font-medium text-indigo-200">{deltaLabel}</span>
    </div>,
    document.body,
  );
}
