# Run Management Guide

The orchestrator maintains state across runs in the `.orc/` directory. This guide explains how to manage runs, clean state, and use tagged versions.

## 📊 Understanding State

The orchestrator stores:
- **Database**: `.orc/orc.db` - SQLite database with run history, tasks, events
- **Worktrees**: `.orc/worktrees/` - Git worktrees for each worker (can accumulate)
- **Run Plans**: `.orc/runs/` - Plan files and metadata for each run
- **Git Worktrees**: Managed by git, tracked in `.git/worktrees/`

## 🔄 Three Ways to Run

### 1. Standard Run (State Accumulates)

```bash
./run-orc.sh run "Create a track" --template strudel-track
```

**Behavior:**
- ✅ Keeps all previous runs in database
- ✅ Worktrees accumulate (47 currently!)
- ✅ Can resume previous runs
- ❌ No clear versioning
- ❌ State grows over time

**Use when:**
- You want to keep history
- Debugging requires previous runs
- Comparing multiple attempts

---

### 2. Fresh Start (Clean Slate)

```bash
./run-orc-fresh.sh "Create a track" --template strudel-track
```

**Behavior:**
- ✅ Cleans ALL state before running
- ✅ Removes old databases
- ✅ Cleans all worktrees
- ✅ Prunes git worktrees
- ✅ Auto-generates timestamped run ID
- ❌ Loses all previous runs

**Use when:**
- Testing/development
- Ensuring clean environment
- Debugging issues
- Don't need previous runs

**What it cleans:**
- `.orc/orc.db` (and WAL files)
- `apps/api/orc.db`
- `.orc/worktrees/*`
- `.orc/runs/*`
- Stale git worktrees

---

### 3. Tagged Run (Best for Production)

```bash
./run-orc-tagged.sh <version-tag> "goal" --template strudel-track
```

**Examples:**
```bash
# Semantic versioning
./run-orc-tagged.sh v1.0-cyberpunk "Epic cyberpunk track" --template strudel-track

# Date-based
./run-orc-tagged.sh demo-2024-04-21 "Demo for client meeting" --template strudel-track

# Experiment tracking
./run-orc-tagged.sh experiment-bass-heavy "Test heavy bass variations" --template strudel-track

# Feature branches
./run-orc-tagged.sh feature-new-chords "Test new chord progressions" --template strudel-track
```

**Behavior:**
- ✅ Creates semantic run ID: `<tag>-<timestamp>`
- ✅ Saves metadata JSON file
- ✅ Easy to identify and track
- ✅ State persists (can compare versions)
- ✅ Perfect for tracking iterations

**Run ID Format:**
```
v1.0-cyberpunk-20240421-103045
└─────┬──────┘ └─────┬─────────┘
    tag          timestamp
```

**Metadata saved to:**
```json
.orc/runs/<tag>-<timestamp>.meta.json
{
  "runId": "v1.0-cyberpunk-20240421-103045",
  "versionTag": "v1.0-cyberpunk",
  "timestamp": "20240421-103045",
  "startedAt": "2024-04-21T10:30:45+02:00",
  "goal": "Epic cyberpunk track",
  "command": "./run-orc-tagged.sh v1.0-cyberpunk ..."
}
```

**Use when:**
- Production tracks
- Client deliverables
- A/B testing variations
- Need to reference specific versions
- Tracking improvements over time

---

## 🔍 View All Runs

```bash
./list-runs.sh
```

Shows:
- Recent runs from database
- Worktree count and sizes
- Tagged runs with metadata
- Git worktrees
- Total disk usage

**Example output:**
```
📋 Orchestration Runs

Database: .orc/orc.db
Size: 392K

Recent Runs from Database:
  test-fix-1776762077 - Status: running - Created: 2024-04-21 11:01:15
  run-1776686857537 - Status: review_ready - Created: 2024-04-20 14:08:17

Worktrees: 47 total

Tagged Runs (with metadata):
  Tag: v1.0-cyberpunk
    Goal: Epic cyberpunk track
    Started: 2024-04-21T10:30:45+02:00
```

---

## 🧹 Manual Cleanup

### Clean Everything
```bash
# Stop any running processes
pkill -f "orc.cjs run"
pkill -f "next dev"

# Remove databases
rm -f .orc/orc.db .orc/orc.db-shm .orc/orc.db-wal
rm -f apps/api/orc.db

# Remove worktrees
rm -rf .orc/worktrees/*

# Remove run directories
rm -rf .orc/runs/*

# Prune git worktrees
git worktree prune
```

### Clean Just Worktrees (Keep Database)
```bash
rm -rf .orc/worktrees/*
git worktree prune
```

### Clean Old Runs (Keep Last 5)
```bash
ls -1t .orc/worktrees | tail -n +6 | xargs -I {} rm -rf .orc/worktrees/{}
```

---

## 📈 Recommended Workflow

### For Development/Testing
Use **fresh start** for each test:
```bash
./run-orc-fresh.sh "Test feature X" --template strudel-track
```

### For Production/Tracking
Use **tagged runs** with semantic versions:
```bash
# First version
./run-orc-tagged.sh v1.0-initial "First cyberpunk track" --template strudel-track

# Iterate with improvements
./run-orc-tagged.sh v1.1-better-bass "Improved bass line" --template strudel-track
./run-orc-tagged.sh v1.2-faster-tempo "Increased tempo to 95 BPM" --template strudel-track

# Final version
./run-orc-tagged.sh v2.0-final "Production ready track" --template strudel-track
```

### For Experiments
Use descriptive tags:
```bash
./run-orc-tagged.sh exp-ambient "Test ambient style" --template strudel-track
./run-orc-tagged.sh exp-aggressive "Test aggressive drums" --template strudel-track
```

---

## 💡 Tag Naming Conventions

**Semantic Versioning:**
- `v1.0`, `v1.1`, `v2.0` - Major/minor versions
- `v1.0-beta`, `v1.0-rc1` - Pre-release versions

**Date-Based:**
- `2024-04-21`, `20240421` - Date stamps
- `demo-2024-04-21` - Demos for specific dates
- `meeting-apr21` - Event-based

**Feature/Experiment:**
- `feature-<name>` - Feature branches
- `exp-<name>` - Experiments
- `test-<name>` - Test runs
- `fix-<issue>` - Bug fix tracking

**Client/Project:**
- `client-acme-v1` - Client deliverables
- `project-cyberpunk-final` - Project-specific

---

## 🎯 Quick Reference

| Goal | Command | State |
|------|---------|-------|
| Keep history | `./run-orc.sh` | Accumulates |
| Clean slate | `./run-orc-fresh.sh` | Wipes all |
| Track version | `./run-orc-tagged.sh <tag>` | Persists with ID |
| View runs | `./list-runs.sh` | Read-only |
| Manual clean | See cleanup section | Manual |

---

## 🔧 Advanced: Database Queries

If you have `sqlite3` installed:

```bash
# View all runs
sqlite3 .orc/orc.db "SELECT id, status, created_at FROM runs;"

# View tasks for a specific run
sqlite3 .orc/orc.db "SELECT id, type, state FROM tasks WHERE run_id='<run-id>';"

# View events
sqlite3 .orc/orc.db "SELECT type, payload FROM events ORDER BY seq DESC LIMIT 10;"

# Database size and stats
sqlite3 .orc/orc.db "SELECT COUNT(*) FROM runs; SELECT COUNT(*) FROM tasks;"
```

---

## 🚨 Troubleshooting

### Too Many Worktrees (Disk Space)
**Problem:** 47+ worktrees taking up space

**Solution:**
```bash
# Clean all but keep database
rm -rf .orc/worktrees/*
git worktree prune

# Or use fresh start
./run-orc-fresh.sh "goal" --template strudel-track
```

### Database Locked
**Problem:** `database is locked` error

**Solution:**
```bash
# Stop all processes
pkill -f "orc.cjs"

# Remove WAL files
rm -f .orc/orc.db-shm .orc/orc.db-wal

# Restart
```

### Can't Resume Old Runs
**Problem:** Previous runs not showing in dashboard

**Solution:** This is expected after cleaning. Use tagged runs if you need to reference old versions.

---

**Last Updated:** 2026-04-21  
**Related Scripts:** `run-orc.sh`, `run-orc-fresh.sh`, `run-orc-tagged.sh`, `list-runs.sh`
