#!/usr/bin/env bash

# List all orchestration runs with their metadata

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${CYAN}📋 Orchestration Runs${NC}\n"

# Check database
if [ -f ".orc/orc.db" ]; then
    echo -e "${GREEN}Database:${NC} .orc/orc.db"
    DB_SIZE=$(du -h .orc/orc.db | cut -f1)
    echo -e "${GREEN}Size:${NC} ${DB_SIZE}"

    # Query database for runs
    if command -v sqlite3 &> /dev/null; then
        echo -e "\n${BLUE}Recent Runs from Database:${NC}"
        sqlite3 .orc/orc.db "SELECT id, status, created_at FROM runs ORDER BY created_at DESC LIMIT 10" 2>/dev/null | while IFS='|' read -r id status created; do
            echo -e "  ${CYAN}$id${NC} - Status: ${status} - Created: ${created}"
        done
    fi
fi

# Check worktrees
if [ -d ".orc/worktrees" ]; then
    WORKTREE_COUNT=$(ls -1 .orc/worktrees 2>/dev/null | wc -l)
    echo -e "\n${GREEN}Worktrees:${NC} ${WORKTREE_COUNT} total"

    if [ "$WORKTREE_COUNT" -gt 0 ]; then
        echo -e "\n${BLUE}Recent Worktrees:${NC}"
        ls -1t .orc/worktrees | head -10 | while read -r wt; do
            SIZE=$(du -sh .orc/worktrees/"$wt" 2>/dev/null | cut -f1)
            echo -e "  ${CYAN}$wt${NC} - ${SIZE}"
        done
    fi
fi

# Check run metadata files
if [ -d ".orc/runs" ]; then
    META_COUNT=$(find .orc/runs -name "*.meta.json" 2>/dev/null | wc -l)
    if [ "$META_COUNT" -gt 0 ]; then
        echo -e "\n${BLUE}Tagged Runs (with metadata):${NC}"
        find .orc/runs -name "*.meta.json" -type f 2>/dev/null | sort -r | head -10 | while read -r meta; do
            if command -v jq &> /dev/null; then
                TAG=$(jq -r '.versionTag' "$meta" 2>/dev/null)
                GOAL=$(jq -r '.goal' "$meta" 2>/dev/null | head -c 50)
                STARTED=$(jq -r '.startedAt' "$meta" 2>/dev/null)
                echo -e "  ${CYAN}Tag: ${TAG}${NC}"
                echo -e "    Goal: ${GOAL}"
                echo -e "    Started: ${STARTED}"
            else
                BASENAME=$(basename "$meta" .meta.json)
                echo -e "  ${CYAN}${BASENAME}${NC}"
            fi
        done
    fi
fi

# Git worktrees
echo -e "\n${BLUE}Git Worktrees:${NC}"
git worktree list | tail -n +2 | while read -r line; do
    echo -e "  ${CYAN}${line}${NC}"
done

# Disk usage
echo -e "\n${GREEN}Total .orc Directory Size:${NC}"
du -sh .orc 2>/dev/null || echo "  No .orc directory"

echo ""
