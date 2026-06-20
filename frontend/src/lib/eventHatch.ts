// Diagonal-hatch background for an event that "counts as a working day": the
// event is shown but does NOT block task scheduling, so it is drawn as a
// see-through hatch rather than a solid band. Keyed by event type so it keeps
// the type's colour.
const HATCH_STRIPE: Record<string, string> = {
  leave: "rgba(249, 115, 22, 0.20)",
  oncall: "rgba(239, 68, 68, 0.20)",
  holiday: "rgba(245, 158, 11, 0.20)",
  other: "rgba(107, 114, 128, 0.20)",
};

export function hatchBackground(type: string): string {
  const stripe = HATCH_STRIPE[type] ?? HATCH_STRIPE.other;
  return `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 4px, transparent 4px, transparent 9px)`;
}
