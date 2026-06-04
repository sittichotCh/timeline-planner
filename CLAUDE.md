# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Backend (Go/Gin)
```bash
cd backend
go run ./cmd/server        # Start the API server (default :8080)
go build ./cmd/server      # Build binary
go test ./...              # Run all tests
go test ./internal/store   # Run tests for a single package
```

### Frontend (React/Vite)
```bash
cd frontend
npm install                # Install dependencies (first time)
npm run dev                # Start dev server (localhost:5173, proxies /api to :8080)
npm run build              # Type-check + production build
npm run lint               # ESLint
```

### Environment Variables (backend `.env` or shell)
| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Backend listen port | `8080` |
| `DATA_DIR` | Path to YAML data files | `./data` |
| `JIRA_BASE_URL` | Jira Cloud instance URL | — |
| `JIRA_EMAIL` | Jira auth email | — |
| `JIRA_TOKEN` | Jira API token | — |

## Architecture

### Overview
A two-tier app: React SPA frontend talks to a Go REST API backend. No external database — all state is persisted as flat YAML files on disk.

### Backend (`backend/`)
- **Framework:** Gin with CORS middleware allowing the Vite dev server origin.
- **Entry point:** `cmd/server/main.go` — wires config, store, routes.
- **Config:** `internal/config/` — loads from env vars (with `.env` file support via godotenv).
- **Store layer:** `internal/store/` — CSV file-backed persistence with a single `sync.RWMutex`. Files live in `DATA_DIR` (`members.csv`, `events.csv`, `tasks.csv`, `deadlines.csv`).
- **Handlers:** `internal/handler/` — one file per resource (members, events, tasks, jira).
- **Jira client:** `internal/jira/` — read-only search via Jira Cloud REST API v3 using resty. Never writes back to Jira.

### Frontend (`frontend/`)
- **React 19 + TypeScript + Vite + Tailwind CSS v4.**
- **Path alias:** `@/` maps to `src/`.
- **API layer:** `src/api/` — thin fetch wrappers per resource; dev proxy forwards `/api` to backend.
- **Types:** `src/types/index.ts` — shared domain interfaces (`Member`, `CalendarEvent`, `TaskSetting`, `JiraIssue`).
- **Gantt chart:** `src/components/gantt/` — `GanttChart`, `GanttHeader`, `GanttRow`, `TimeScaleToggle`.
- **CRUD panels:** `MemberPanel`, `EventPanel`, `TaskPanel`, `JiraSyncPanel` — slide-over panels controlled from `App.tsx`.

### API Routes
All under `/api`:
- `GET/POST /members`, `PUT/DELETE /members/:email`
- `GET /events`, `GET /events/:email`, `POST /events`, `PUT/DELETE /events/:id`
- `GET /tasks`, `GET /tasks/:email`, `POST /tasks` (upsert), `DELETE /tasks/:task_id`
- `GET /jira/config`, `POST /jira/sync`

## MCP & Tools
- **Context7:** Use Context7 to resolve up-to-date library documentation before answering questions or writing code that depends on React, Tailwind CSS, Vite, Gin, or any other dependency. Always prefer Context7 docs over training data when available.
- **Playwright:** Use Playwright MCP to verify UI changes in a real browser — navigate, click, screenshot, and inspect the DOM before reporting a frontend task as complete.

## Key Constraints
- **Jira is read-only.** Never send mutation requests to Jira. The system only fetches issues via JQL search.
- **Frontend must use strict TypeScript.** No `any` types.
- **Data files are CSV.** Task settings store only `task_id` references, not full Jira payloads. CSV format chosen for future Google Sheets sync compatibility.
- **Members are keyed by email.** Events and tasks reference members via `member_email`.
