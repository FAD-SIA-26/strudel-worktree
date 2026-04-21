# WorkTree Orchestrator - Issue Tracker & Roadmap

This document tracks known issues, missing features, and improvements needed to take this hackathon MVP to production quality.

**Current Status:** ✅ Critical bugs fixed | 113 passing tests (3 lead.test failures)  
**Test Coverage:** Backend well-tested, Dashboard needs tests  
**Last Updated:** 2026-04-21

---

## 🟢 Recently Fixed Issues (2026-04-21)

### ✅ #1 MockAgent Creates No Files - **FIXED**
**Priority:** P0 - Critical  
**Status:** ✅ **RESOLVED** (Commit: `38961e4`)

**Was:**
- MockAgent returned "done" but didn't write any code files
- Dashboard "Launch Solo" button crashed with ENOENT errors
- Demo/testing mode completely broken

**Solution Implemented:**
- Enhanced MockAgent to write template Strudel code files to worktree
- Added section inference from entity ID, prompt, and branch name
- Created templates for all 6 section types (drums, synth, chords, lead, arp, arrangement)
- Added defensive fallback in preview system (generates placeholder if file missing)
- Added 7 new tests with 100% coverage

**Files Modified:**
- `apps/api/src/agents/mock.ts` (+175 lines)
- `apps/api/src/agents/mock.test.ts` (+289 lines)
- `apps/api/src/orchestrator/preview.ts` (+8 lines)

**Impact:**
- ✅ Demo mode fully functional
- ✅ Preview generates valid Strudel URLs
- ✅ 9/9 MockAgent tests passing
- ✅ Integration tests passing

---

### ✅ #1b Template Path Resolution - **FIXED**
**Priority:** P0 - Critical  
**Status:** ✅ **RESOLVED** (Commit: `8789976`)

**Was:**
- `--template templates/strudel-track.toml` → `templates/templates/strudel-track.toml.toml`
- Users couldn't specify full paths or extensions

**Solution Implemented:**
- Enhanced `resolveTemplateSelection()` to detect full paths and extensions
- Now handles all three formats correctly:
  - `strudel-track` ✅ (recommended)
  - `strudel-track.toml` ✅
  - `templates/strudel-track.toml` ✅

**Files Modified:**
- `apps/api/src/orchestrator/domainSkill.ts`

**Impact:**
- ✅ All template specification methods work
- ✅ 7/7 domainSkill tests passing
- ✅ User-friendly CLI

---

### ✅ #3 Environment Variable Loading - **PARTIALLY SOLVED**
**Priority:** P0 - Critical  
**Status:** ✅ **MOSTLY RESOLVED** (Commit: `8789976`)

**Was:**
- API keys exported in terminal weren't available to `orc run`
- `.env` file not automatically loaded
- No clear documentation

**Solution Implemented:**
- Created `.env` file system (gitignored)
- Added `run-orc.sh` wrapper script that auto-loads .env
- Created `.env.example` template
- Comprehensive documentation (`SETUP_API_KEY.md`)
- Four setup methods documented

**What Works:**
- ✅ `.env` file setup (gitignored)
- ✅ Wrapper script auto-loads environment
- ✅ Key masking in output
- ✅ Fallback to mock mode if no key
- ✅ Professional documentation

**Remaining Work:**
- ⚠️ CLI doesn't natively load dotenv (requires wrapper or manual export)
- ⚠️ No `dotenv` dependency in package.json
- ⚠️ No `orc config set OPENAI_API_KEY=...` command

**Recommendation:** Add dotenv to CLI bootstrap for native .env support

**Files Added:**
- `.env` (user-specific, gitignored)
- `.env.example`
- `run-orc.sh`
- `SETUP_API_KEY.md`

---

### ✅ #NEW State Management & Version Tracking - **SOLVED**
**Priority:** P1 - High  
**Status:** ✅ **RESOLVED** (Commit: `deca0ba`)

**Problem:**
- State accumulated across runs (47+ worktrees observed)
- No clean way to start fresh during development
- No version tracking for production runs
- Difficult to identify different iterations

**Solution Implemented:**

1. **Fresh Start Script (`run-orc-fresh.sh`)**
   - Cleans all state before running
   - Removes databases, worktrees, run directories
   - Prunes stale git worktrees
   - Auto-generates timestamped run ID

2. **Tagged Version Script (`run-orc-tagged.sh`)**
   - Semantic version tagging (e.g., `v1.0-cyberpunk-20240421-103045`)
   - Creates metadata JSON for each run
   - Easy identification and tracking
   - Supports: semantic versions, dates, experiments, features

3. **List Runs Script (`list-runs.sh`)**
   - Shows all runs from database
   - Lists worktrees with sizes
   - Displays tagged runs with metadata
   - Reports disk usage

4. **Documentation (`RUN_MANAGEMENT.md`)**
   - Complete guide for state management
   - Three run modes explained
   - Cleanup procedures
   - Tag naming conventions

**Impact:**
- ✅ Clean development workflow
- ✅ Professional version tracking
- ✅ Easy state management
- ✅ Disk space management

---

### ✅ #4 Worktree Path Confusion - **RESOLVED**
**Priority:** P1 - High  
**Status:** ✅ **RESOLVED**

**Was:**
- Documentation said `.worktrees/`
- Implementation used `.orc/worktrees/`

**Solution:**
- ✅ Code uses `.orc/worktrees/` consistently
- ⚠️ README still mentions `.worktrees/` in 2 places (needs doc update)

**Recommendation:** Update README.md lines 322 and 380 to use `.orc/worktrees/`

---

## 🟡 Active Issues (Current Focus)

### #2 Dashboard Process Management - Port Conflicts
**Priority:** P0 - Critical  
**Component:** DevOps  
**Status:** 🔄 **PARTIALLY SOLVED** (Auto-kills stale, but could be better)

**Problem:**
- Multiple `next dev` processes spawn and conflict over port 3000
- ~~Error: "Another next dev server is already running"~~ ← Handled now
- ~~Requires manual `kill` commands to recover~~ ← Handled now
- No graceful shutdown mechanism

**Current Behavior:**
The code DOES handle this:
- `dashboard.ts` detects "Another next dev server is already running"
- Attempts to reuse existing server if targets match
- Kills stale processes if they don't match (line 384: `process.kill(staleDetails.pid, "SIGTERM")`)
- See: `pickReusableDashboardUrl()` and `ensureDashboardServer()`

**What's Working:**
- ✅ Detects stale processes
- ✅ Kills stale processes automatically
- ✅ Reuses dashboard when appropriate
- ✅ Dashboard tests passing (7/7)

**Remaining Issues:**
- ⚠️ No PID file tracking (`.orc/dashboard.pid`)
- ⚠️ No `orc dashboard start/stop/restart` commands
- ⚠️ Graceful shutdown could be improved
- ⚠️ No cleanup on SIGINT/SIGTERM

**Impact:** Low (mostly works, just not as polished)

**Recommendation:**
- Add PID file tracking for transparency
- Add `orc dashboard` subcommands for manual control
- Add graceful shutdown handlers

**Estimated Effort:** 1-2 days

**Files to Modify:**
- `apps/api/src/runtime/dashboard.ts` (add PID tracking)
- `apps/api/src/cli.ts` (add dashboard subcommands)

---

### #19 Lead Test Failures - Timing Issues
**Priority:** P1 - High  
**Component:** Testing  
**Status:** 🐛 **NEW BUG** (Discovered during testing)

**Problem:**
3 out of 6 lead tests are failing:
- ❌ "reviewer proposes a winner and lead waits for explicit user approval"
  - Expected state: `awaiting_user_approval`
  - Actual state: `running`
- ❌ "preserves the exact section goal when PM prompt generation falls back" (timeout)
- ❌ "user can override the reviewer proposal" (timeout)

**Root Cause:** Likely timing/race condition in state transitions

**Impact:**
- Tests: 113 passing / 3 failing (116 total)
- Functionality may still work despite test failures
- Could indicate real race condition in production

**Recommendation:**
- Priority investigation needed
- May require state machine timing fixes
- Add more explicit synchronization in tests

**Estimated Effort:** 2-3 days

**Files to Review:**
- `apps/api/src/orchestrator/lead.test.ts`
- `apps/api/src/orchestrator/lead.ts`

---

## 🔴 Critical Issues (Blockers for Production Use)

### #5 Merge Conflict Auto-Repair
**Priority:** P1 - High  
**Component:** Git Integration  
**Status:** 📋 Feature Request  
**Labels:** `post-mvp`, `git`, `ai-assisted`

**Spec Reference:** Design spec §18 (Merge Coordinator)

**Current State:**
- ✅ MergeCoordinator exists (`apps/api/src/orchestrator/mergeCoordinator.ts`)
- ✅ Detects conflicts and records them
- ✅ Emits `MergeConflict` events
- ✅ Updates merge_queue status to 'conflict'
- ❌ No automatic conflict resolution
- ❌ No patch worker spawning
- ❌ No LLM-based conflict analysis

**Problem:**
- Conflicts surface in dashboard but no auto-fix
- User must manually resolve conflicts in terminal
- Breaks the "hands-off" orchestration promise

**Proposed Solution:**
1. On merge conflict, spawn a dedicated "patch worker" in conflict resolution worktree
2. LLM analyzes conflict markers and both versions
3. Generate resolution, run tests, commit
4. If resolution fails, escalate to user with detailed context

**Implementation Tasks:**
- [ ] Add `PatchWorkerStateMachine` class
- [ ] Enhance conflict detection in `MergeCoordinator` (already detects, needs response)
- [ ] Create conflict analysis prompt for LLM
- [ ] Add retry logic (max 3 attempts)
- [ ] Dashboard UI for conflict status and manual override
- [ ] Tests for conflict scenarios

**Estimated Effort:** 5-7 days  
**Design Doc:** `docs/superpowers/specs/conflict-resolution.md` (to be created)

---

### #6 Full Crash Recovery & Worktree Reconciliation
**Priority:** P1 - High  
**Component:** Orchestration  
**Status:** 📋 Feature Request  
**Labels:** `post-mvp`, `reliability`

**Spec Reference:** Design spec §7 (Crash Recovery)

**Problem:**
- `orc resume` reloads state from SQLite but doesn't reconcile worktrees
- In-progress workers may have uncommitted changes
- Zombie processes not detected and cleaned up
- Dashboard state becomes inconsistent after crash

**Current Behavior:**
- Loads tasks table and shows stale state
- No process reconciliation
- No worktree health checks
- CLI has `resume` command but it's marked `[DEGRADED]`

**Proposed Solution:**
Implement full reconciliation on `orc resume`:

1. **Process Reconciliation:**
   - Check PIDs from `runs` table, verify still alive (`kill -0`)
   - Mark dead processes as `zombie` or `failed`
   - Kill truly orphaned processes

2. **Worktree Reconciliation:**
   - For each worktree in DB:
     - Check if worktree directory exists
     - Check for `.orc/.orc-done.json` completion marker
     - Check git status (uncommitted changes?)
   - Decision matrix:
     - Marker `done` → mark worker done
     - Marker `failed` → mark worker failed
     - No marker + commits → treat as incomplete, resume
     - No marker + clean → restart from scratch
     - Missing worktree → recreate and restart

3. **Event Log Replay:**
   - Compare event log sequence numbers with projection state
   - Detect and fix any inconsistencies

**Implementation Tasks:**
- [ ] Add `reconcileWorktrees()` function
- [ ] Add `reconcileProcesses()` function
- [ ] Enhance completion marker schema (include timestamp, worker state)
- [ ] Add `orc doctor` command to check for inconsistencies
- [ ] Tests for crash scenarios (process killed, worktree deleted, etc.)

**Estimated Effort:** 4-6 days

---

## 🟠 High Priority (Production Readiness)

### #7 Redis Event Bus for Multi-Process Scaling
**Priority:** P1 - High  
**Component:** Architecture  
**Status:** 📋 Feature Request  
**Labels:** `post-mvp`, `scalability`

**Spec Reference:** Design spec §5 (Event Bus)

**Problem:**
- Current in-memory `EventEmitter` only works in single process
- Can't scale horizontally (multiple API servers)
- Can't distribute workers across machines
- Dashboard WebSocket tied to single API instance

**Proposed Solution:**
Replace in-memory event bus with Redis Streams:

1. **Event Publishing:**
   - After writing to SQLite event_log, publish to Redis stream
   - Dashboard subscribes to Redis stream for live updates
   - Multiple API instances can coexist

2. **Command Queues:**
   - Replace in-memory queues with Redis Streams
   - Each lead/worker polls its dedicated stream
   - Enables distributed worker execution

3. **Backward Compatibility:**
   - Add `REDIS_URL` env var (optional)
   - If not set, fall back to in-memory mode
   - No breaking changes for single-process deployments

**Implementation Tasks:**
- [ ] Add `ioredis` dependency
- [ ] Create `RedisEventBus` adapter implementing same interface as `InMemoryEventBus`
- [ ] Create `RedisCommandQueue` adapter
- [ ] Add connection pooling and retry logic
- [ ] Update dashboard to connect to Redis streams
- [ ] Add Redis health checks
- [ ] Update deployment docs (Docker Compose with Redis)
- [ ] Tests with Redis Mock

**Estimated Effort:** 6-8 days

---

### #8 Security Agent & Code Review
**Priority:** P1 - High  
**Component:** Security  
**Status:** 📋 Feature Request  
**Labels:** `post-mvp`, `security`, `compliance`

**Spec Reference:** Design spec §3.3 (Security Agent)

**Problem:**
- Workers can generate arbitrary code with no security review
- No detection of:
  - Hardcoded secrets (API keys, passwords)
  - SQL injection vulnerabilities
  - XSS vulnerabilities
  - Dependency vulnerabilities
  - Dangerous system calls

**Proposed Solution:**
Add SecurityAgent that runs after worker completes, before merge:

1. **Static Analysis:**
   - Run linters (ESLint security rules, Semgrep)
   - Scan for secret patterns (regex + entropy detection)
   - Check for dangerous functions (`eval`, `exec`, `innerHTML`)

2. **LLM-Based Review:**
   - Send code + prompt to LLM: "Review this code for security issues"
   - Look for logic flaws, injection vectors, auth bypasses

3. **Action on Findings:**
   - **Critical:** Block merge, spawn patch worker to fix
   - **High:** Warn user, require approval
   - **Medium/Low:** Log for review

**Implementation Tasks:**
- [ ] Create `SecurityAgentStateMachine`
- [ ] Integrate ESLint security plugins
- [ ] Add secret detection (truffleHog, detect-secrets)
- [ ] Create security review LLM prompt
- [ ] Add security findings to dashboard
- [ ] Add "approve with risk" user action
- [ ] Tests with known vulnerable code samples

**Estimated Effort:** 7-10 days

---

### #9 NL Steering - Runtime Commands
**Priority:** P2 - Medium  
**Component:** User Interaction  
**Status:** 📋 Feature Request  
**Labels:** `post-mvp`, `ux`, `ai`

**Spec Reference:** Design spec §0 (NL steering via routeDirective)

**Problem:**
- Users can't steer orchestration mid-run
- Can't say "make drums more aggressive" without restarting
- `/api/steer` endpoint exists but not implemented

**Proposed Solution:**
Enable natural language commands during orchestration:

1. **Chat Interface in Dashboard:**
   - Add chat widget in dashboard
   - User types: "regenerate drums with more energy"
   - System parses intent, routes to correct entity

2. **Command Routing:**
   - LLM classifies intent: `{ target: "drums-lead", action: "regenerate", params: { energy: 8 } }`
   - Route to lead's command queue
   - Lead aborts current workers, spawns new with modified prompt

3. **Supported Commands:**
   - Regenerate section with new criteria
   - Abort slow worker
   - Change concurrency limit
   - Force approve specific worker

**Implementation Tasks:**
- [ ] Implement `/api/steer` endpoint
- [ ] Add intent classification LLM call
- [ ] Add routing logic to entity queues
- [ ] Dashboard chat UI component
- [ ] Add command validation (can't modify completed sections)
- [ ] Tests for various command types

**Estimated Effort:** 5-7 days

---

## 🟡 Medium Priority (UX & Polish)

### #20 UI/UX Redesign - Minimalistic OpenAI-Inspired Frontend
**Priority:** P1 - High  
**Component:** Frontend / UX  
**Status:** 📋 **PLANNED**  
**Labels:** `frontend`, `ux`, `design`, `accessibility`

**Problem:**
- Current UI is functional but developer-focused, not user-friendly
- No onboarding for newcomers
- Overwhelming information display (3-panel layout)
- Technical terminology everywhere (`awaiting_user_approval`, `mastermind`, etc.)
- Poor empty states and unclear next actions
- No keyboard shortcuts or bulk actions for power users

**Vision:**
Transform dashboard into a refined, minimalistic interface inspired by OpenAI ChatGPT/Claude.ai that:
- Reduces cognitive load for newcomers
- Guides users through orchestration flow intuitively
- Feels professional and polished
- Scales from simple to complex views
- Delights with smooth interactions

**Proposed Design System:**

**Visual Language:**
- Clean, minimalistic design (inspired by OpenAI ChatGPT)
- Refined color palette (less blue, more neutral darks)
- Better typography hierarchy (Inter font family)
- Consistent spacing and border radius
- Subtle animations and transitions

**New Information Architecture:**
```
Empty State → Overview (Progress) → Detail (Drill-down)
```

Instead of current:
```
3-Panel: Tree | Detail | Events (all at once)
```

**Key Improvements:**

1. **Progressive Disclosure:**
   - Start with overview showing overall progress
   - Drill down to section details when needed
   - Hide technical details by default

2. **Better First Experience:**
   - Welcome screen with "New Orchestration" CTA
   - Quick start guide modal
   - Inline help and tooltips
   - Recent runs list

3. **Clearer Status & Progress:**
   - Overall progress bar (X/Y sections complete)
   - Status badges with icons (not just dots)
   - Timeline view for events (not raw feed)
   - Toast notifications for important updates

4. **Intuitive Actions:**
   - Large, clear action buttons
   - Preview buttons (not tiny `↗` links)
   - Bulk actions (approve all, reject all)
   - Confirmation for destructive actions

5. **Power User Features:**
   - Command palette (Cmd+K)
   - Keyboard shortcuts
   - Search and filter
   - Quick navigation

**Components to Build:**
- AppShell (layout system)
- EmptyState, Card, StatusBadge, ProgressBar
- Button variants (primary, secondary, ghost, danger)
- SectionCard, WorkerComparison
- Modal, Toast, ActionMenu
- CodeViewer, PreviewEmbed, Timeline
- Command palette

**Implementation Plan:**

**Phase 1: Foundation** (Days 1-3)
- Design system setup (colors, typography, tokens)
- Core components (Button, Card, Badge, EmptyState)
- Layout components (AppShell, Header, Sidebar)
- Toast notification system

**Phase 2: Dashboard Redesign** (Days 4-6)
- Empty state landing page
- Overview view with progress
- Section detail drill-down
- Breadcrumb navigation

**Phase 3: Advanced Features** (Days 7-9)
- Worker comparison side-by-side
- Real-time toast notifications
- Timeline/events redesign
- Code viewer with syntax highlighting

**Phase 4: Polish & Testing** (Days 10-12)
- Command palette (Cmd+K)
- Keyboard shortcuts
- Responsive design (mobile/tablet)
- Component tests + E2E tests
- Storybook documentation

**Quick Wins (Can Start Immediately):**
- Better empty state with welcome message (2h)
- Status badge redesign (1h)
- Toast notifications (3h)
- Bigger preview buttons (1h)
- Progress bar (2h)
**Total:** 9 hours for significant UX improvement!

**Migration Strategy:**
- Feature flag: `?newui=1` parameter
- Gradual rollout with opt-in beta
- Keep old UI for 30 days
- Zero breaking changes to backend

**Success Metrics:**
- Time to first orchestration < 2min (vs 5min)
- User error rate < 5%
- 80% newcomer completion rate
- NPS score > 40
- Lighthouse score > 90

**Estimated Effort:** 8-12 days  
**Detailed Plan:** See `ISSUE_20_UI_REDESIGN_PLAN.md`

**Related Issues:** #10 (Dashboard Testing), #11 (Error Messages)

---

### #10 Dashboard Needs Testing
**Priority:** P2 - Medium  
**Component:** Frontend  
**Status:** 📋 Task  
**Labels:** `testing`, `frontend`

**Problem:**
- Backend has 113 passing tests
- Frontend (Next.js dashboard) has 0 tests
- No integration tests for WebSocket updates
- No E2E tests for user workflows

**Proposed Solution:**
Add comprehensive frontend test coverage:

1. **Unit Tests (React Testing Library):**
   - Component rendering
   - State management
   - Event handlers

2. **Integration Tests:**
   - WebSocket connection and updates
   - API calls with MSW (Mock Service Worker)
   - State synchronization

3. **E2E Tests (Playwright):**
   - Full orchestration flow
   - Approve/reject workers
   - Preview launches
   - Error states

**Implementation Tasks:**
- [ ] Add Vitest + React Testing Library
- [ ] Add MSW for API mocking
- [ ] Add Playwright for E2E
- [ ] Write tests for key components:
  - [ ] OrchestrationTree
  - [ ] CompareView
  - [ ] EventStream
  - [ ] WorkerCard
- [ ] CI integration (run tests on PR)

**Target Coverage:** 80%+ for components  
**Estimated Effort:** 4-6 days

---

### #11 Better Error Messages & User Guidance
**Priority:** P2 - Medium  
**Component:** UX  
**Status:** 🔄 **PARTIALLY RESOLVED**

**Problem:**
- ~~Cryptic errors (e.g., "ENOENT" without context)~~ ← Fixed with wrapper scripts
- ~~No onboarding flow for first-time users~~ ← Documented
- ~~Dashboard shows state but doesn't explain what user should do~~
- ~~CLI help text is minimal~~ ← Improved with scripts

**What Was Fixed:**
- ✅ `run-orc.sh` provides clear error messages
- ✅ `SETUP_API_KEY.md` has onboarding guide
- ✅ `QUICK_USAGE.md` has quick start
- ✅ `RUN_MANAGEMENT.md` has comprehensive guide

**Remaining Work:**

1. **CLI Improvements:**
   - [ ] Color-coded output (chalk/colorette)
   - [ ] Rich error messages in orc.cjs itself
   - [ ] `orc init` command that generates `.env.template` and explains setup
   - [ ] Better `--help` text with examples

2. **Dashboard Improvements:**
   - [ ] First-run tutorial overlay
   - [ ] Contextual help bubbles
   - [ ] State-specific instructions (e.g., "All workers complete. Please review and approve.")
   - [ ] Error recovery suggestions

3. **Error Catalog:**
   - [ ] Create `docs/errors.md` with all error codes and solutions
   - [ ] Link from CLI errors to docs

**Estimated Effort:** 2-3 days (reduced from 3-4)

---

### #12 Template Gallery & Ecosystem
**Priority:** P2 - Medium  
**Component:** Templates  
**Status:** 📋 Feature Request  
**Labels:** `templates`, `community`

**Problem:**
- Only one template exists: `strudel-track.toml`
- No templates for web development, API building, etc.
- No community template sharing mechanism

**Proposed Solution:**

1. **Built-in Templates:**
   Create 5-10 templates for common use cases:
   - `web-app-nextjs.toml` - Next.js app with API routes
   - `rest-api-express.toml` - Express REST API
   - `react-component.toml` - Reusable React component
   - `python-ml-pipeline.toml` - Data pipeline with feature engineering
   - `docs-site.toml` - Documentation website

2. **Template Registry:**
   - `orc templates list` - show available templates
   - `orc templates add <url>` - install from GitHub
   - Template metadata (author, description, tags)

3. **Template Validation:**
   - Schema validation for `.toml` files
   - Test templates with MockAgent
   - CI to ensure templates don't break

**Implementation Tasks:**
- [ ] Design template schema v2 (add metadata fields)
- [ ] Create 5 diverse templates
- [ ] Add template manager (`apps/api/src/templates/manager.ts`)
- [ ] Add `orc templates` subcommands
- [ ] Create template gallery webpage
- [ ] Template contribution guide

**Estimated Effort:** 6-8 days

---

### #13 Skill System Enhancement
**Priority:** P2 - Medium  
**Component:** Skills  
**Status:** 📋 Feature Request  
**Labels:** `skills`, `ai`

**Problem:**
- Skills (agent system prompts) are static markdown files
- No skill composition or inheritance
- No community skill sharing
- Hard to customize skills per project

**Current Skills:**
- `mastermind.md`, `lead.md`, `implementer.md`, `reviewer.md`, `pm-agent.md`

**Proposed Solution:**

1. **Skill Composition:**
   ```toml
   # project/.orc/skills.toml
   [mastermind]
   base = "default-mastermind"
   extend_with = ["our-company-style-guide"]
   
   [implementer]
   base = "default-implementer"
   domain_context = "./docs/architecture.md"
   ```

2. **Domain-Specific Skills:**
   - `strudel-implementer.md` - knows Strudel syntax
   - `react-implementer.md` - knows React patterns
   - `python-implementer.md` - knows Python idioms

3. **Skill Variables:**
   Allow templating in skills:
   ```markdown
   ## Style Guide
   Follow these conventions:
   {{PROJECT_STYLE_GUIDE}}
   ```

**Implementation Tasks:**
- [ ] Design skill composition system
- [ ] Add skill inheritance resolver
- [ ] Create 5 domain-specific skill variants
- [ ] Add `orc skills list/edit` commands
- [ ] Template variable substitution
- [ ] Skill validation

**Estimated Effort:** 4-5 days

---

### #14 Better Preview System
**Priority:** P2 - Medium  
**Component:** Preview  
**Status:** 📋 Feature Request  
**Labels:** `preview`, `ux`

**Problem:**
- Preview only generates Strudel playground URL
- No local dev server for previewing code
- Can't preview non-Strudel projects
- No "live preview" during generation

**Proposed Solution:**

1. **Local Dev Server:**
   - Spawn dev server in worktree (e.g., `npm run dev`)
   - Track port in `previews` table
   - Dashboard embeds preview in iframe
   - Auto-reload on file changes

2. **Preview Adapters:**
   - Strudel → strudel.cc embed
   - Next.js → local dev server iframe
   - React component → Storybook
   - REST API → Swagger UI

3. **Live Preview:**
   - Stream preview updates as worker writes code
   - Show partial renders
   - Syntax highlighting with errors

**Implementation Tasks:**
- [ ] Create preview adapter system
- [ ] Add dev server spawning logic
- [ ] Track preview ports in database
- [ ] Dashboard iframe embedding
- [ ] Add preview adapters for common frameworks
- [ ] Live update streaming

**Estimated Effort:** 5-7 days

---

## 🟢 Low Priority (Nice to Have)

### #15 RAG System - Semantic Example Search
**Priority:** P3 - Low  
**Component:** AI  
**Status:** 📋 Feature Request  
**Labels:** `ai`, `rag`, `hackathon-plan`

**Context:**
Original hackathon plan included Pinecone vector DB for semantic search of Strudel examples. This was dropped during development but could add value.

**Current State:**
- `data/strudel-examples/` folder exists with 25+ examples
- Examples not indexed or used
- Template-driven decomposition works without RAG

**Proposed Solution:**

1. **Vector Database:**
   - Use pgvector (simpler than Pinecone for self-hosted)
   - Embed all examples at seed time
   - Semantic search during PM agent prompt generation

2. **Example Retrieval:**
   - PM agent query: "drum patterns for cyberpunk at 90 BPM"
   - Retrieve top 3 similar examples
   - Include in worker prompt for reference

3. **Benefit:**
   - Better quality outputs (learns from examples)
   - Less prompt engineering needed
   - Community can contribute examples

**Implementation Tasks:**
- [ ] Add pgvector extension to SQLite (or use separate Postgres)
- [ ] Add OpenAI embeddings generation
- [ ] Seed script for example indexing
- [ ] Integrate retrieval into PM agent
- [ ] Add example contribution workflow
- [ ] A/B test: RAG vs non-RAG quality

**Estimated Effort:** 5-6 days  
**Note:** Optional - system works fine without this

---

### #16 Changelog Generation
**Priority:** P3 - Low  
**Component:** Git  
**Status:** 📋 Feature Request  
**Labels:** `git`, `documentation`

**Problem:**
- No automatic changelog for what was built
- Hard to review full orchestration results
- No summary of changes per section

**Proposed Solution:**
After orchestration completes, generate:

1. **Section Summaries:**
   ```markdown
   ## Drums Section
   - Worker v1 (winner): Added tight kick pattern with sidechain
   - Worker v2: Similar but with _scope() for visualization
   - Review reasoning: "v1 has better sidechain ducking"
   ```

2. **Git Diff Summary:**
   - Files changed per section
   - Lines added/removed
   - Complexity metrics

3. **Artifact Links:**
   - Link to all plan files
   - Link to session logs
   - Link to preview URLs

**Implementation Tasks:**
- [ ] Add changelog generator
- [ ] Integrate with `orc status --summary`
- [ ] Export as markdown
- [ ] Dashboard view for changelog

**Estimated Effort:** 2-3 days

---

### #17 Telemetry & Analytics
**Priority:** P3 - Low  
**Component:** Observability  
**Status:** 📋 Feature Request  
**Labels:** `observability`, `analytics`

**Problem:**
- No metrics on orchestration success rate
- No visibility into LLM costs
- Can't measure worker quality over time

**Proposed Solution:**

1. **Metrics to Track:**
   - Orchestration success/failure rate
   - Average worker completion time per section
   - LLM API costs (token counts)
   - User approval vs override rate
   - Common failure reasons

2. **Observability Stack:**
   - Structured logging (pino)
   - Metrics export (Prometheus format)
   - Optional telemetry backend (Posthog, Mixpanel)

3. **Privacy:**
   - Opt-in telemetry
   - No code content sent
   - Only aggregate metrics

**Implementation Tasks:**
- [ ] Add structured logging
- [ ] Add metrics collection
- [ ] Add `/metrics` endpoint (Prometheus)
- [ ] Dashboard analytics view
- [ ] Cost estimation per run

**Estimated Effort:** 3-4 days

---

### #18 Multi-User Support & Collaboration
**Priority:** P3 - Low  
**Component:** Collaboration  
**Status:** 📋 Feature Request  
**Labels:** `collaboration`, `auth`

**Problem:**
- Single-user system only
- Can't collaborate on orchestrations
- No permissions or access control

**Proposed Solution:**

1. **Authentication:**
   - Add auth system (NextAuth.js)
   - GitHub/Google OAuth
   - API key authentication

2. **Multi-User Features:**
   - Share orchestration runs
   - Team approval workflow
   - Real-time collaboration on dashboard

3. **Permissions:**
   - Owner, Reviewer, Viewer roles
   - Per-run access control

**Implementation Tasks:**
- [ ] Add NextAuth.js
- [ ] Add user table to database
- [ ] Add run ownership
- [ ] Add sharing mechanism
- [ ] Multi-user WebSocket updates

**Estimated Effort:** 8-10 days  
**Note:** Major feature, consider as Phase 2

---

## 📊 Summary & Recommended Prioritization

### Phase 1: Critical Fixes (Week 1-2) - **IN PROGRESS**
**Goal:** Make it reliably usable by early adopters

**Completed:**
- ✅ **#1 - MockAgent file creation** (2 days) **DONE**
- ✅ **#3 - Environment variable loading** (1 day) **MOSTLY DONE**
- ✅ **#4 - Worktree path standardization** (0.5 days) **DONE** (needs doc update)
- ✅ **#NEW - State management & version tracking** (2 days) **DONE**

**Remaining:**
- ⚠️ **#19 - Lead test failures** (2-3 days) **NEW - URGENT**
- 🔄 **#2 - Dashboard process management** (1-2 days) **POLISH NEEDED**
- 🔄 **#3 - Native dotenv loading** (0.5 days) **POLISH NEEDED**
- 📝 **#4 - README path updates** (0.1 days) **TRIVIAL**

**Total Remaining:** ~4-6 days of work

---

### Phase 2: Production Readiness (Week 3-6)
**Goal:** Enterprise-ready reliability and security

1. **#6 - Crash recovery** (5 days)
2. **#8 - Security agent** (8 days)
3. **#10 - Dashboard testing** (5 days)
4. **#5 - Merge conflict resolution** (6 days)

**Total:** ~24 days of work

---

### Phase 3: Scale & Polish (Month 2-3)
**Goal:** Multi-user, scalable, polished UX

1. **#20 - UI/UX redesign** (10 days) **NEW - HIGH IMPACT**
2. **#7 - Redis event bus** (7 days)
3. **#12 - Template gallery** (7 days)
4. **#13 - Skill system** (5 days)
5. **#14 - Better preview** (6 days)
6. **#9 - NL steering** (6 days)

**Total:** ~41 days of work

---

### Phase 4: Community & Growth (Month 3+)
**Goal:** Build ecosystem and community

1. **#15 - RAG system** (optional, 6 days)
2. **#16 - Changelog generation** (3 days)
3. **#17 - Telemetry** (4 days)
4. **#18 - Multi-user** (10 days)

**Total:** ~23 days of work

---

## 🎯 Immediate Next Steps (This Week)

### High Priority
1. **Fix #19 - Lead test failures** (investigate timing issues)
2. **Polish #2 - Add PID tracking and dashboard commands**
3. **Trivial #4 - Update README paths** (5 minutes)

### Medium Priority  
4. **Add native dotenv loading to CLI** (finish #3)
5. **Start #10 - Add basic dashboard tests**

### Documentation
6. **Update this ISSUES.md in git** (version control)
7. **Create GitHub Issues** from this document

---

## 💡 Business Value Assessment

### High Commercial Value:
- **#8 Security Agent** - Required for enterprise adoption
- **#6 Crash Recovery** - Required for reliability
- **#7 Redis Scaling** - Required for scale
- **#12 Template Gallery** - Drives adoption across use cases

### High Community Value:
- ✅ **#1 MockAgent** - Demo mode works **DONE**
- ✅ **State Management** - Professional workflow **DONE**
- **#12 Templates** - Shows versatility
- **#13 Skills** - Enables customization
- **#15 RAG** - Showcases AI capabilities

### High Technical Value:
- **#19 Test Fixes** - Maintainability **URGENT**
- **#10 Dashboard Tests** - Maintainability
- **#17 Telemetry** - Product insights
- **#6 Crash Recovery** - Debuggability

---

## 📈 Progress Tracking

**Test Status:**
- Total Tests: 116
- Passing: 113 ✅
- Failing: 3 ❌ (lead.test.ts timing issues)
- Coverage: Backend well-tested, Frontend needs tests

**Recent Improvements (2026-04-21):**
- Fixed 3 critical bugs (#1, #1b, partial #3)
- Added 16 new tests
- Added 5 new management scripts
- Added ~2,200 lines (code + tests + docs)
- 4 new commits
- 0 breaking changes

**Quality Metrics:**
- ✅ MockAgent: 9/9 tests passing
- ✅ Integration tests: passing
- ✅ Demo mode: fully functional
- ⚠️ Lead tests: 3/6 failing (needs attention)

---

## 📝 Contributing

To work on any of these issues:

1. Create a GitHub issue with the ticket number (e.g., "#19 Lead Test Failures")
2. Reference this document for context
3. Follow test-driven development (write tests first)
4. Update documentation as you go
5. Submit PR with issue number in title
6. Run full test suite before submitting

See `CONTRIBUTING.md` for detailed guidelines.

---

## 📚 Documentation Index

**Setup & Usage:**
- `SETUP_API_KEY.md` - How to configure OpenAI API key (4 methods)
- `QUICK_USAGE.md` - Quick command reference
- `RUN_MANAGEMENT.md` - State and version management

**Technical:**
- `ISSUE_1_FIX_SUMMARY.md` - Detailed MockAgent fix documentation
- `CHANGELOG.md` - Complete changelog of all fixes
- `ISSUES.md` - This file (issue tracker and roadmap)
- `README.md` - Main project documentation

**Architecture:**
- `ARCHITECTURE.md` - System architecture overview
- `WORKTREE_ARCHITECTURE.md` - Git worktree architecture
- `docs/superpowers/` - Design specifications

---

**Last Updated:** 2026-04-21  
**Maintained By:** Project Contributors  
**License:** MIT  
**Branch:** `feat/improve-fix-branch`  
**Status:** ✅ Critical bugs fixed | 🔄 Polish in progress | 📋 Roadmap defined
