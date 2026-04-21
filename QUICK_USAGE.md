# Quick Usage Guide

## ✅ FIXED: Template Path Issue

The template path issue has been fixed. You can now specify templates in multiple ways:

### ✨ Recommended: Use Template Name Only

```bash
./run-orc.sh run "Create an epic cyberpunk track" --template strudel-track
```

### Alternative Ways (All Work):

```bash
# 1. Just the name (recommended - shortest)
./run-orc.sh run "goal" --template strudel-track

# 2. Full path with extension
./run-orc.sh run "goal" --template templates/strudel-track.toml

# 3. Name with extension
./run-orc.sh run "goal" --template strudel-track.toml
```

## Common Commands

### Run with Real AI (Uses OpenAI API)
```bash
./run-orc.sh run "Create a cyberpunk track" --template strudel-track
```

### Run in Mock Mode (No API Key Needed)
```bash
./run-orc.sh run --mock "Test track" --template strudel-track
```

### Check Status
```bash
node apps/api/bin/orc.cjs status
```

### Resume Previous Run
```bash
node apps/api/bin/orc.cjs resume
```

## What Was Fixed

**Problem:** When you ran:
```bash
./run-orc.sh run "goal" --template templates/strudel-track.toml
```

It was looking for: `templates/templates/strudel-track.toml.toml` ❌

**Solution:** The template resolution now intelligently handles:
- Full paths: `templates/strudel-track.toml` ✅
- Names with extension: `strudel-track.toml` ✅  
- Names only: `strudel-track` ✅ **(Recommended)**

## Dashboard

Once running, open the dashboard:
```
http://localhost:3000
```

The dashboard shows:
- Real-time orchestration progress
- Worker status and outputs
- Ability to approve/reject workers
- Preview Strudel code in the browser

## Next Steps

1. **For testing:** Use `--mock` mode (no API costs)
2. **For real work:** Use with your API key (already configured in `.env`)
3. **Monitor progress:** Open `http://localhost:3000` in your browser
4. **Review results:** Approve workers when prompted in the dashboard

---

**Last Updated:** 2026-04-21  
**Status:** ✅ Template path bug fixed
