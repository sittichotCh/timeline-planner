import { useCallback, useEffect, useState } from "react";

export interface DayDrag {
  /** True while a drag is in progress. */
  dragging: boolean;
  /** Horizontal pixels moved since drag start (0 when not dragging). */
  dragOffset: number;
  /** dragOffset snapped to whole day columns. */
  daysMoved: number;
  /** Current cursor position, for positioning a floating indicator. */
  dragPos: { x: number; y: number };
  /** Attach to the draggable element's onMouseDown. */
  onMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Horizontal day-snapped drag. On release, if the cursor moved a non-zero
 * number of day-columns, `onCommit(daysMoved)` fires; otherwise `onClick` fires
 * (a plain click). Listeners live on window so the drag keeps tracking even if
 * the cursor leaves the element.
 */
export function useDayDrag(
  columnWidth: number,
  onCommit: (daysMoved: number) => void,
  onClick?: () => void,
): DayDrag {
  const [startX, setStartX] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });

  const handleMove = useCallback(
    (e: MouseEvent) => {
      if (startX === null) return;
      setDragOffset(e.clientX - startX);
      setDragPos({ x: e.clientX, y: e.clientY });
    },
    [startX],
  );

  const handleUp = useCallback(
    (e: MouseEvent) => {
      if (startX === null) return;
      // Read the final offset from the release event, not from dragOffset state:
      // mouseup can fire before React re-renders the last mousemove, which would
      // otherwise drop a day off.
      const finalOffset = e.clientX - startX;
      const daysMoved = Math.round(finalOffset / columnWidth);
      if (daysMoved !== 0) onCommit(daysMoved);
      else onClick?.();
      setStartX(null);
      setDragOffset(0);
    },
    [startX, columnWidth, onCommit, onClick],
  );

  useEffect(() => {
    if (startX === null) return;
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [startX, handleMove, handleUp]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setStartX(e.clientX);
    setDragOffset(0);
    setDragPos({ x: e.clientX, y: e.clientY });
  }, []);

  return {
    dragging: startX !== null,
    dragOffset,
    daysMoved: Math.round(dragOffset / columnWidth),
    dragPos,
    onMouseDown,
  };
}
