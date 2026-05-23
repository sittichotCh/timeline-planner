# Timeline Planner

A team timeline planning tool with Gantt chart visualization and Jira integration. Built with React + TypeScript frontend and Go (Gin) backend. No external database — all data is stored as flat YAML files.

## Prerequisites

- **Go** 1.23+
- **Node.js** 18+ and **npm**

## Installation

### 1. Clone the repository

```bash
git clone <repo-url>
cd timeline-planner
```

### 2. Backend setup

```bash
cd backend
cp .env.example .env   # or create .env manually (see Configuration below)
go mod download
```

### 3. Frontend setup

```bash
cd frontend
npm install
```

## Configuration

Create `backend/.env` with the following variables:

```env
PORT=8080
DATA_DIR=./data
STATIC_DIR=../frontend/dist

# Jira integration (optional)
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_TOKEN=your-jira-api-token
```

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Backend listen port | `8080` |
| `DATA_DIR` | Path to YAML data files | `./data` |
| `STATIC_DIR` | Path to built frontend assets | `../frontend/dist` |
| `JIRA_BASE_URL` | Jira Cloud instance URL | — |
| `JIRA_EMAIL` | Jira auth email | — |
| `JIRA_TOKEN` | Jira API token | — |

Jira variables are optional. Without them, Jira Sync features are disabled but everything else works.

## Running

### Development (two terminals)

**Terminal 1 — Backend:**

```bash
cd backend
go run ./cmd/server
```

**Terminal 2 — Frontend:**

```bash
cd frontend
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` requests to the backend on port 8080.

### Production

```bash
# Build frontend
cd frontend
npm run build

# Run backend (serves frontend from dist/)
cd ../backend
go run ./cmd/server
```

Open http://localhost:8080.

## Project Structure

```
timeline-planner/
  backend/
    cmd/server/       # Entry point
    internal/
      config/         # Env var loading
      handler/        # HTTP handlers (members, events, tasks, deadlines, jira)
      jira/           # Jira Cloud REST API client (read-only)
      model/          # Data models
      store/          # YAML file-backed persistence
    data/             # YAML data files (auto-created)
  frontend/
    src/
      api/            # Fetch wrappers per resource
      components/     # React components
        gantt/        # GanttChart, GanttHeader, TaskBar, TaskTooltip
      lib/            # Utility functions (dates, etc.)
      types/          # TypeScript interfaces
```
