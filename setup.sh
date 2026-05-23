#!/usr/bin/env bash
##############################################################################
# Timeline Planner — Day 1 Setup (macOS / Linux)
# Run:  chmod +x setup.sh && ./setup.sh
##############################################################################

set -euo pipefail
cd "$(dirname "$0")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

echo -e "\n${CYAN}=== Timeline Planner — Day 1 Setup ===${NC}"

# ── Prerequisites ──────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[1/5] Checking prerequisites...${NC}"

missing=()
go_ver=$(go version 2>/dev/null | sed 's/go version //') || missing+=("Go (https://go.dev/dl/)")
node_ver=$(node -v 2>/dev/null) || missing+=("Node.js (https://nodejs.org/)")
npm_ver=$(npm -v 2>/dev/null) || missing+=("npm (comes with Node.js)")

if [ ${#missing[@]} -gt 0 ]; then
    echo -e "${RED}Missing tools:${NC}"
    for tool in "${missing[@]}"; do
        echo -e "  ${RED}- $tool${NC}"
    done
    echo -e "${RED}Install them and re-run this script.${NC}"
    exit 1
fi

echo -e "  ${GREEN}Go:   $go_ver${NC}"
echo -e "  ${GREEN}Node: $node_ver${NC}"
echo -e "  ${GREEN}npm:  $npm_ver${NC}"

# ── Backend .env ───────────────────────────────────────────────────────────
echo -e "\n${YELLOW}[2/5] Setting up backend/.env...${NC}"

if [ ! -f backend/.env ]; then
    cat > backend/.env <<'EOF'
PORT=8080
DATA_DIR=./data

# Jira integration (optional — leave blank to skip)
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_TOKEN=
EOF
    echo -e "  ${GREEN}Created backend/.env (Jira fields left blank)${NC}"
else
    echo -e "  ${DIM}backend/.env already exists — skipped${NC}"
fi

# ── Backend dependencies ───────────────────────────────────────────────────
echo -e "\n${YELLOW}[3/5] Installing backend Go dependencies...${NC}"

(cd backend && go mod download)

echo -e "  ${GREEN}Done${NC}"

# ── Frontend dependencies ──────────────────────────────────────────────────
echo -e "\n${YELLOW}[4/5] Installing frontend npm dependencies...${NC}"

(cd frontend && npm install)

echo -e "  ${GREEN}Done${NC}"

# ── Summary ────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}[5/5] Setup complete!${NC}"
cat <<EOF

  To start developing, open two terminals:

    Terminal 1 — Backend API:
      cd backend
      go run ./cmd/server

    Terminal 2 — Frontend dev server:
      cd frontend
      npm run dev

  Then open http://localhost:5173 in your browser.

  Optional: edit backend/.env to configure Jira sync.

EOF
