# Team-Event Background Opacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower the opacity of team-event background tints — the full-height body band (`/40`→`/25`) and the header cap fill (solid→`/60`).

**Architecture:** Frontend-only Tailwind class edits in two `Record<string, string>` literals. No logic, layout, or type changes.

**Tech Stack:** React 19 + TypeScript + Tailwind v4.

## Global Constraints

- Strict TypeScript — NO `any` (not at risk here; only string-literal class values change).
- No frontend unit-test runner. Verification: from `frontend/`, `npm run build` (`tsc -b` + `vite build`) and `npm run lint` both clean, then **Playwright MCP** in a real browser (controller-run).
- **Scope is `GanttMergedEventRow.tsx` + `GanttTeamEventStrip.tsx` only.** Change ONLY the background-fill class maps (`bandFill`, `capFill`). Do NOT touch borders (`bandBorder`/`capBase`), text colors, the working-day hatch branches, or any other component.
- Spec: `docs/superpowers/specs/2026-06-20-team-event-bg-opacity-design.md`.

---

## Setup (before Task 1)

- [ ] **Create a feature branch off `master`:**

```bash
git checkout -b feat/team-event-bg-opacity
```

### Verification environment (for the Playwright step)

The seed data has team events (releases, cutoffs, smoke tests). Run against an isolated copy:

```bash
cp -r backend/data /tmp/tp-teo-data
cd backend && DATA_DIR=/tmp/tp-teo-data PORT=8080 go run ./cmd/server   # terminal 1
cd frontend && npm run dev                                              # terminal 2 → http://localhost:5173
```

---

### Task 1: Lower team-event background opacity

**Files:**
- Modify: `frontend/src/components/gantt/GanttMergedEventRow.tsx`
- Modify: `frontend/src/components/gantt/GanttTeamEventStrip.tsx`

**Interfaces:** None changed — only the values inside two existing `Record<string, string>` constants are edited.

- [ ] **Step 1: `GanttMergedEventRow.tsx` — band fill `/40` → `/25`**

Find:

```ts
const bandFill: Record<string, string> = {
  leave: "bg-orange-200/40",
  oncall: "bg-red-200/40",
  holiday: "bg-amber-200/40",
  other: "bg-gray-200/40",
};
```

Replace with:

```ts
const bandFill: Record<string, string> = {
  leave: "bg-orange-200/25",
  oncall: "bg-red-200/25",
  holiday: "bg-amber-200/25",
  other: "bg-gray-200/25",
};
```

(`bandBorder` directly below is unchanged.)

- [ ] **Step 2: `GanttTeamEventStrip.tsx` — cap fill add `/60`**

Find:

```ts
const capFill: Record<string, string> = {
  leave: "bg-orange-100",
  oncall: "bg-red-100",
  holiday: "bg-amber-100",
  other: "bg-gray-100",
};
```

Replace with:

```ts
const capFill: Record<string, string> = {
  leave: "bg-orange-100/60",
  oncall: "bg-red-100/60",
  holiday: "bg-amber-100/60",
  other: "bg-gray-100/60",
};
```

(`capBase` — text + dashed-border colors — is unchanged. The working-day branch sets `fill = ""` and uses `hatchBackground`, so it never reads `capFill` and is unaffected.)

- [ ] **Step 3: Build & lint**

Run (from `frontend/`): `npm run build` then `npm run lint`
Expected: both PASS. (Tailwind v4 generates these opacity-modified utilities on demand; the eight classes are standard `bg-{color}-{shade}/{opacity}` forms already used elsewhere in the file set.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/gantt/GanttMergedEventRow.tsx frontend/src/components/gantt/GanttTeamEventStrip.tsx
git commit -m "style: lower team-event background opacity (band /40->/25, caps +/60)"
```

- [ ] **Step 5 (controller-run): Playwright verification**

With the dev servers running (see Setup), use Playwright MCP on the **Timeline** (team events present in seed data):
1. Confirm the full-height band tints behind the rows are visibly fainter than before, and the header cap chips are lighter but their labels remain readable.
2. Confirm a **working-day** team event (diagonal hatch) is unchanged — it doesn't use these fills.
3. Confirm the dashed borders and label text are intact (only the fill opacity changed).
4. Spot-check via `browser_evaluate` that a non-working band element's class includes `/25` and a non-working cap includes `/60`.

---

## Finalization

- [ ] `npm run build` + `npm run lint` clean once more from `frontend/`.
- [ ] Remove the throwaway data dir (`rm -rf /tmp/tp-teo-data`).
- [ ] Use superpowers:finishing-a-development-branch to integrate (merge to `master`).

---

## Self-review notes (coverage check against the spec)

- Spec §3.1 (band `/40`→`/25`, all four; `bandBorder` unchanged) → Step 1.
- Spec §3.2 (cap add `/60`, all four; `capBase` unchanged; working-day branch unaffected) → Step 2.
- Spec §2.4/§6 (working-day hatch untouched) → not modified; verified in Step 5.2.
- Spec §4 (build, lint, Playwright) → Steps 3, 5.
