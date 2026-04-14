# TODO

## Product / UX

- [ ] Fix Strudel preview generation.
  Current previews encode raw `src/*.js` or `src/index.js` files directly into `strudel.cc`. That breaks when worker output contains ES module syntax such as `import` / `export`. Preview generation should emit browser-runnable Strudel code, not raw repo module files.

- [ ] Audit the `Approve` / `Drop` flow end to end.
  The dashboard exposes these actions, but the orchestration contract still needs to be tightened. Commands should be routed through the owning lead, and the lead should own winner selection, aborts, and dropped variants in a deterministic way. Currently when i click, it does nothing. button stays the same

- [ ] Make logs visible from the dashboard.
  Worker progress exists in the journal and `.orc-session.jsonl`, but the dashboard still lacks a reliable per-worker / per-lead log view that lets the user inspect what Codex actually did. This should also cover real plan rendering, real diff rendering, artifact-backed file paths, and the current `.orc/worktrees/...` path layout instead of the stale `.worktrees/...` hints.

- [ ] Add a real chat / steering interface with the `Mastermind`.
  The MVP needs a user-facing control surface to inject constraints, redirect a run, ask for retries, or refine the goal without dropping into code or the terminal. `/api/steer` is still only a stub, so this should be treated as a real routed command path, not just a text box.

- [ ] Improve the Strudel compare / listen workflow.
  The core demo should make sibling worker variants easy to audition side by side, then approve one winner per lane with minimal friction.

- [ ] Decide and enforce the authentication model for Codex workers.
  If the product standard is “all agents and subagents use API-key auth”, the runtime should enforce that instead of relying on whatever Codex CLI session state happens to exist locally.

## Runtime / Orchestration

- [ ] Add a Strudel-specific worker skill / prompt contract.
  Workers currently behave too much like generic coding agents. They need a Strudel-focused workflow: write lane files, stay within the expected file boundaries, and produce preview-safe output. Template-driven runs should also pass real dependency context such as prior winner code, and the CLI should support explicit template selection instead of auto-detect only.

- [ ] Implement real `orc resume` recovery.
  `resume` currently restarts the API/dashboard and prints persisted tasks, but it does not reconcile worktrees, read `.orc/.orc-done.json`, classify interrupted work, or restart entity coroutines from persisted state.

- [ ] Implement Level 1 worker retry and lineage.
  The spec says failed / stalled / zombie workers should be retried in fresh worktrees with retry lineage and prior session context. Today leads run workers once and stop; watchdog events are not turned into retries.

- [ ] Tighten watchdog telemetry.
  Stalled / zombie states should be driven by authoritative worker heartbeat data, not partial runtime state. The watchdog should also emit recovery transitions consistently and feed lead-owned retry decisions instead of only changing task state.

- [ ] Improve merge conflict recovery.
  The merge path should stay AI-owned. If a winner cannot merge cleanly, the orchestrator should spawn a dedicated merge-fix worker before escalating anything to the user. Right now merge conflicts still fail the orchestration directly.

- [ ] Make PM and Reviewer first-class tracked entities.
  PM and Reviewer steps are still inline LLM calls inside the lead flow. They should have durable task state, journaled events, and dashboard visibility like the rest of the orchestration tree.

- [ ] Harden dashboard state hydration and live updates.
  Worker / lead / mastermind state should stay accurate even if the page is already open when a run starts or reconnects mid-run. This also needs richer API payloads for artifacts, diffs, reviewer verdicts, and preview state so the UI stops relying on placeholders.

## CI / Pipelines

- [ ] Add a real lint pipeline.
  Run Biome consistently in CI for formatting, linting, and import organization.

- [ ] Replace weak test coverage with meaningful verification.
  Keep Vitest where it adds value, but prioritize orchestration, git/worktree, preview, and API integration coverage over low-signal tests.

- [ ] Add a clean build pipeline.
  CI should bootstrap the workspace with `pnpm install --frozen-lockfile` and then run `turbo run build`.

- [ ] Add MR-only review automation.
  On merge requests only, run a review step using the repository API key and the current MR context through GitHub MCP, similar to the OpenCode / Stratumn workflow.
