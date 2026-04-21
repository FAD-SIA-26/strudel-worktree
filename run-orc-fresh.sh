#!/usr/bin/env bash

# Fresh start script - clears all state before running
# Use this during development/testing to ensure clean slate

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}🧹 WorkTree Orchestrator - Fresh Start${NC}\n"

# Check if orchestrator is running
if pgrep -f "orc.cjs run" > /dev/null; then
    echo -e "${YELLOW}⚠️  Orchestrator is currently running${NC}"
    echo -n "Kill running processes? (y/N): "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        pkill -f "orc.cjs run" || true
        pkill -f "next dev" || true
        sleep 2
        echo -e "${GREEN}✓ Processes stopped${NC}"
    else
        echo -e "${RED}✗ Cannot start fresh with processes running${NC}"
        exit 1
    fi
fi

# Clean state
echo -e "${YELLOW}Cleaning state...${NC}"

# Remove old databases
if [ -f ".orc/orc.db" ]; then
    rm -f .orc/orc.db .orc/orc.db-shm .orc/orc.db-wal
    echo -e "${GREEN}✓ Removed .orc/orc.db${NC}"
fi

if [ -f "apps/api/orc.db" ]; then
    rm -f apps/api/orc.db
    echo -e "${GREEN}✓ Removed apps/api/orc.db${NC}"
fi

# Remove worktrees
if [ -d ".orc/worktrees" ]; then
    WORKTREE_COUNT=$(ls -1 .orc/worktrees | wc -l)
    rm -rf .orc/worktrees/*
    echo -e "${GREEN}✓ Cleaned $WORKTREE_COUNT worktrees${NC}"
fi

# Remove run directories
if [ -d ".orc/runs" ]; then
    RUN_COUNT=$(ls -1 .orc/runs | wc -l)
    rm -rf .orc/runs/*
    echo -e "${GREEN}✓ Cleaned $RUN_COUNT run directories${NC}"
fi

# Clean git worktrees that might be stale
echo -e "${YELLOW}Checking git worktrees...${NC}"
STALE_WORKTREES=$(git worktree list --porcelain | grep -c "^worktree" || echo "0")
if [ "$STALE_WORKTREES" -gt 1 ]; then
    echo -e "${YELLOW}Found $((STALE_WORKTREES - 1)) git worktrees (excluding main)${NC}"
    # Prune any missing worktrees
    git worktree prune 2>/dev/null || true
    echo -e "${GREEN}✓ Pruned stale git worktrees${NC}"
fi

echo -e "\n${GREEN}✨ State cleaned! Starting fresh orchestration...${NC}\n"

# Generate unique run ID with timestamp
RUN_ID="fresh-$(date +%Y%m%d-%H%M%S)"

# Now run with the wrapper script
exec ./run-orc.sh run "$@" --run-id "$RUN_ID"
