##############################################################################
# Timeline Planner — Day 1 Setup (Windows PowerShell)
# Run:  .\setup.ps1
##############################################################################

$ErrorActionPreference = "Stop"

Write-Host "`n=== Timeline Planner — Day 1 Setup ===" -ForegroundColor Cyan

# ── Prerequisites ──────────────────────────────────────────────────────────
Write-Host "`n[1/5] Checking prerequisites..." -ForegroundColor Yellow

$missing = @()

try { $goVer = (go version) -replace 'go version ','' } catch { $missing += "Go (https://go.dev/dl/)" }
try { $nodeVer = node -v } catch { $missing += "Node.js (https://nodejs.org/)" }
try { $npmVer = npm -v } catch { $missing += "npm (comes with Node.js)" }

if ($missing.Count -gt 0) {
    Write-Host "Missing tools:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "Install them and re-run this script." -ForegroundColor Red
    exit 1
}

Write-Host "  Go:   $goVer" -ForegroundColor Green
Write-Host "  Node: $nodeVer" -ForegroundColor Green
Write-Host "  npm:  $npmVer" -ForegroundColor Green

# ── Backend .env ───────────────────────────────────────────────────────────
Write-Host "`n[2/5] Setting up backend/.env..." -ForegroundColor Yellow

$envFile = Join-Path $PSScriptRoot "backend\.env"
if (-not (Test-Path $envFile)) {
    @"
PORT=8080
DATA_DIR=./data

# Jira integration (optional — leave blank to skip)
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_TOKEN=
"@ | Out-File -FilePath $envFile -Encoding utf8
    Write-Host "  Created backend/.env (Jira fields left blank)" -ForegroundColor Green
} else {
    Write-Host "  backend/.env already exists — skipped" -ForegroundColor DarkGray
}

# ── Backend dependencies ───────────────────────────────────────────────────
Write-Host "`n[3/5] Installing backend Go dependencies..." -ForegroundColor Yellow

Push-Location (Join-Path $PSScriptRoot "backend")
go mod download
Pop-Location

Write-Host "  Done" -ForegroundColor Green

# ── Frontend dependencies ──────────────────────────────────────────────────
Write-Host "`n[4/5] Installing frontend npm dependencies..." -ForegroundColor Yellow

Push-Location (Join-Path $PSScriptRoot "frontend")
npm install
Pop-Location

Write-Host "  Done" -ForegroundColor Green

# ── Summary ────────────────────────────────────────────────────────────────
Write-Host "`n[5/5] Setup complete!" -ForegroundColor Green
Write-Host @"

  To start developing, open two terminals:

    Terminal 1 — Backend API:
      cd backend
      go run ./cmd/server

    Terminal 2 — Frontend dev server:
      cd frontend
      npm run dev

  Then open http://localhost:5173 in your browser.

  Optional: edit backend/.env to configure Jira sync.
"@ -ForegroundColor Cyan
