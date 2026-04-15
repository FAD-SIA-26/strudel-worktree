# Repository Guidelines

## Project Structure & Module Organization
This repository is a `pnpm` workspace managed by Turbo. Primary code lives in `apps/` and shared packages live in `packages/`.

- `apps/api/`: TypeScript CLI, orchestrator, REST API, SQLite/Drizzle code, and most integration tests.
- `apps/web/`: Next.js dashboard UI under `src/app`, `src/components`, and `src/hooks`.
- `packages/types/`: shared Zod schemas and API/event contracts.
- `packages/config/`: shared Biome configuration.
- `skills/`: agent prompt files.
- `templates/`: workflow templates such as `strudel-track.toml`.

Generated runtime state like `.orc/`, `.worktrees/`, `apps/api/.orc/`, `apps/api/.worktrees/`, `.next/`, `dist/`, and local database files should not be treated as source.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies.
- `pnpm dev`: run all app dev processes through Turbo.
- `pnpm build`: build every workspace package.
- `pnpm test`: run the full test suite.
- `pnpm lint`: run Biome checks and import organization.
- `pnpm db:generate` / `pnpm db:migrate`: create or apply Drizzle migrations for `apps/api`.

For targeted work, use package-local commands such as `cd apps/api && pnpm dev`, `cd apps/api && pnpm orc -- <args>`, or `cd apps/web && pnpm dev`.

## Coding Style & Naming Conventions
Code is TypeScript-first. Biome enforces formatting and linting; use 2-space indentation and keep imports organized. Follow existing naming patterns: React components in PascalCase (`WorkerCard.tsx`), utilities and modules in camelCase or lowercase (`worktree.ts`, `wsHandler.ts`), and tests as `*.test.ts` beside the code they cover.

Prefer `DRY` and `ETC` ("Easy To Change") over local convenience. Search before writing: before adding a new function, type, hook, schema, or UI pattern, look for an existing implementation and reuse it aggressively. If two features share logic, extract it into a shared module instead of copy-pasting.

Keep contracts centralized. Shared API/event shapes belong in `packages/types`; orchestration or git helpers should live in one place and be imported, not re-declared per feature. Favor small, composable modules over one-off helpers embedded deep in route handlers or components.

## Testing Guidelines
Vitest is the test runner across the repo. API tests live under `apps/api/src/**/*.test.ts`; shared schema tests live beside source in `packages/types/src/`. Web test support exists through Vitest as well, but dashboard coverage is still light, so UI changes should be verified with at least a local `next build` and targeted manual or browser-based checks. Add or update tests for every behavior change, especially orchestration flow, git/worktree logic, preview generation, and HTTP routes. Run `pnpm test` before opening a PR; use `cd apps/api && pnpm test` for faster iteration.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit prefixes: `feat:`, `fix:`, `docs:`, `test:`, and `chore:`. Keep messages imperative and scoped to one change. PRs should include a short behavior summary, affected packages, test evidence, and screenshots or UI notes when `apps/web` changes. Link the relevant issue or task when one exists.

## Configuration Tips
Use Node 20+ and `pnpm` 9+. Install Codex CLI for real worker runs. Set `OPENAI_API_KEY` for real planner and worker runs, and optionally `OPENAI_BASE_URL` / `OPENAI_MODEL` for non-default endpoints or models. The CLI also honors `ORC_REPO_ROOT`, `ORC_DB_PATH`, `ORC_PORT`, and `ORC_DASHBOARD_PORT`. For the dashboard, use `apps/web/.env.local` with `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` pointing at the API/WebSocket server.
