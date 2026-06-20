# Team-Event Background Opacity — Design

- **Date:** 2026-06-20
- **Status:** Approved (design)
- **Branch (suggested):** `feat/team-event-bg-opacity` (off `master`)
- **Scope:** Frontend only — Tailwind class tweaks in two Gantt components. No backend, API, type, data, or logic changes.

## 1. Goal

Lower the opacity of the team-event background tints so they read as fainter:

- **Body band** (the full-height color tint behind the rows marking a team event's date range): `/40` → `/25`.
- **Header cap** (the small label box at the top carrying the event name): currently a solid `bg-{color}-100` with no opacity → add `/60` so the chip is lighter but the label stays legible.

Visual-only change; nothing about layout, scheduling, drag, tooltips, or which events render is affected.

## 2. Decisions (locked during brainstorming)

1. **Both surfaces** change (body band + header cap).
2. **Body band → `/25`** (from `/40`).
3. **Header cap → `/60`** (from solid `bg-{color}-100`). `/60` chosen over the band's `/25` because `-100` is already a very light shade; `/25` there would nearly erase the cap chip. The label box must stay visible.
4. **Working-day variants untouched.** Both the band and the cap apply these fills **only when `counts_as_working_day` is false**; working-day events use a diagonal hatch (`hatchBackground`) instead, which is out of scope.
5. **Borders and text colors untouched.** Only the `*Fill` background classes change; dashed border colors (`bandBorder`/`capBase`) and text colors stay.

## 3. Changes

### 3.1 `frontend/src/components/gantt/GanttMergedEventRow.tsx` — `bandFill`

```ts
const bandFill: Record<string, string> = {
  leave: "bg-orange-200/25",
  oncall: "bg-red-200/25",
  holiday: "bg-amber-200/25",
  other: "bg-gray-200/25",
};
```

(Only the opacity suffix changes: `/40` → `/25` on all four. `bandBorder` is unchanged.)

### 3.2 `frontend/src/components/gantt/GanttTeamEventStrip.tsx` — `capFill`

```ts
const capFill: Record<string, string> = {
  leave: "bg-orange-100/60",
  oncall: "bg-red-100/60",
  holiday: "bg-amber-100/60",
  other: "bg-gray-100/60",
};
```

(Add `/60` to all four. `capBase` — the text + dashed border colors — is unchanged. The working-day branch, which yields `fill = ""` and uses a hatch background, is unaffected because it never reads `capFill`.)

## 4. Testing & verification

- `npm run build` (tsc strict) + `npm run lint` clean.
- Playwright (real browser) on the Timeline with team events present: confirm the full-height band tints are visibly fainter than before and the header caps are lighter but their labels remain readable; confirm a working-day team event (hatch) is unchanged; confirm borders/labels are intact.

## 5. Anticipated file changes

- `frontend/src/components/gantt/GanttMergedEventRow.tsx` — `bandFill` opacity `/40` → `/25`.
- `frontend/src/components/gantt/GanttTeamEventStrip.tsx` — `capFill` add `/60`.

## 6. Out of scope

- The working-day hatch variants (caps and bands).
- Dashed border colors, text colors, the today marker, personal event bars, deadlines.
- Any non-color/opacity change (layout, sizing, logic).
