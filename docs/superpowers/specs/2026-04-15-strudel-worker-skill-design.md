# Strudel Worker Skill Design

Date: 2026-04-15
Status: Approved for planning

## 1. Problem

ORC is intentionally domain-agnostic, but the current Strudel demo depends on workers producing very domain-specific output:

- lane workers should write only their assigned lane file
- lane files should export a single preview-safe Strudel pattern
- arrangement workers should assemble lane files without rewriting them
- downstream workers should be able to see meaningful upstream musical context

Today that contract is only partially implied by template `prompt_hint` text and generic worker instructions. The result is too loose for a hackathon demo:

- workers behave like generic coding agents instead of Strudel lane authors
- prompt constraints are duplicated across template hints and ad hoc instructions
- template-driven runs do not pass real upstream winner code into downstream worker prompts
- CLI template selection is auto-detect only, with no clean skill-driven runtime contract

The product gap is not "make ORC a Strudel tool." The gap is "let ORC apply a simple domain skill bundle to workers when a run needs it, without coupling the orchestrator itself to that domain."

## 2. Goals

- Add a run-level `--skill <name>` flag that activates one optional domain skill bundle.
- Make `--skill strudel` auto-select the Strudel template when `--template` is not supplied.
- Keep domain behavior worker-only for the first cut.
- Store the Strudel domain skill as a simple editable Markdown file in the repo.
- Inject the resolved skill content into worker execution so workers receive explicit Strudel coding rules and examples.
- Pass real upstream winner code into downstream worker prompts for template-driven Strudel runs.
- Keep ORC generic so future domains can use the same runtime mechanism.

## 3. Non-Goals

- No multi-skill stacking in a single run.
- No domain skill injection for mastermind, lead, PM, or reviewer in this iteration.
- No registry service, plugin loader, marketplace, or external skill installation model.
- No schema-heavy skill bundle format yet; a single Markdown file is enough.
- No attempt to make preview generation fully domain-independent in this change.
- No replacement of template hints; templates still provide decomposition and section-local guidance.

## 4. Product Behavior

### 4.1 CLI Behavior

`orc run` gains two explicit domain/runtime knobs:

- `--skill <name>`: activates one optional domain skill bundle for the run
- `--template <name>`: explicitly selects a workflow template by name

Resolution precedence:

1. explicit `--template`
2. default template for `--skill`
3. existing goal-based auto-detection

This means:

- `orc run "lo-fi beat" --skill strudel` uses the Strudel skill and auto-selects the Strudel template
- `orc run "lo-fi beat" --skill strudel --template strudel-track` uses the explicit template and the Strudel skill
- `orc run "build a REST API"` behaves as today when no skill is provided

Unknown skill names must fail fast with a clear CLI error before a run starts.

### 4.2 Worker Scope

For the first iteration, only workers consume domain skills.

Mastermind, lead, PM, and reviewer remain generic. This preserves the architectural boundary:

- ORC chooses and coordinates work generically
- templates describe structured workflows
- domain skills tune how workers execute domain-specific code generation

### 4.3 Strudel Worker Contract

The first domain skill file lives at `skills/domains/strudel.md` and is treated as replaceable content, not long-term infrastructure.

It must teach workers to:

- stay within the assigned output file boundary
- write preview-safe lane files
- export exactly one named lane constant for lane sections
- avoid extra exports and helper sprawl in lane files
- avoid imports in lane files
- allow imports only for arrangement output in `src/index.js`
- preserve the section-specific contract already expressed by the template

The skill file should include a few short examples for:

- `drums`
- `bass`
- `chords`
- `melody`
- `arrangement`

These examples are prompt guidance, not executable test fixtures.

## 5. Architecture

### 5.1 Domain Skill Resolver

Introduce a small runtime resolver module responsible for:

- validating supported skill names
- mapping a skill name to a Markdown file in the repo
- loading raw skill content
- exposing a default template name for a skill when one exists

The initial mapping is intentionally simple:

- `strudel` -> `skills/domains/strudel.md`
- `strudel` -> default template `strudel-track`

This module is the runtime boundary between generic orchestration code and domain-specific assets.

### 5.2 Template Selection

CLI should stop treating template selection as auto-detect only.

Introduce explicit template-name resolution:

- if the user passes `--template strudel-track`, resolve that template directly
- if the user passes `--skill strudel` without `--template`, resolve the Strudel default template
- if neither exists, fall back to existing goal keyword detection

This keeps the current demo convenience while making behavior explicit and testable.

### 5.3 Worker Prompt Injection

The worker execution path gains one new optional input: resolved domain skill content.

Flow:

1. CLI resolves `skillName` and optional skill Markdown content
2. `MastermindStateMachine` carries skill context for the run
3. `LeadStateMachine` passes skill context to workers unchanged
4. `WorkerStateMachine` includes skill content in the worker execution context
5. `CodexCLIAdapter` injects the skill text into the worker prompt before spawning Codex

The skill content should be clearly delimited in the prompt, for example under a heading such as:

- `Domain skill: strudel`

This avoids burying domain rules in generic worker text and makes future replacement straightforward.

### 5.4 Dependency Context for Strudel Runs

Template-driven Strudel runs need real upstream code context, not only dependency ids.

For dependent sections:

- `LeadStateMachine` resolves upstream lead ids from the dependency graph already persisted by mastermind
- it looks up selected upstream winners in `merge_candidates`
- it finds their worktrees
- it reads the upstream lane source files from those winner worktrees
- it appends a deterministic dependency context block to each worker prompt

That block should include:

- upstream section id
- winning worker id
- source file path
- winner code snippet

The PM remains generic. It does not need to become Strudel-aware if workers already receive:

- the section-local template prompt
- the domain skill
- the upstream winner code that matters for musical compatibility

## 6. Data and Contract Design

### 6.1 Run-Level Skill State

The run should carry:

- optional `skillName`
- optional resolved `skillContent`

This state is in-memory runtime configuration, not a new persistent database requirement for the first cut.

### 6.2 Template Contracts

Templates remain independent from skills in this iteration.

They may continue to define:

- decomposition
- worker counts
- dependencies
- prompt hints

They do not become the primary source of domain skill activation. Runtime `--skill` is the source of truth.

### 6.3 Prompt Composition Contract

For a Strudel lane worker, prompt composition should be layered in this order:

1. generic unattended worker instructions
2. resolved domain skill Markdown
3. section objective and file/output constraints
4. dependency context, if any
5. worker plan / lead plan / run plan paths

This ordering ensures the domain rules are visible before task-specific execution details.

## 7. Error Handling

- Unknown `--skill` value: fail CLI startup with a clear message listing supported skills.
- Known skill with missing Markdown file: fail CLI startup with a clear file-path error.
- Skill default template missing: fail startup if `--skill` requires a default template and it cannot be resolved.
- Upstream dependency winner missing: downstream worker prompt omits dependency context only when no upstream winner exists yet by design; it must not crash unrelated sections.
- Upstream source file unreadable: surface a deterministic warning in the generated prompt block rather than failing the whole run, unless the section cannot proceed without that context.

The goal is to keep startup failures explicit and early, while making downstream context lookup resilient enough for live orchestration.

## 8. Testing Strategy

### 8.1 CLI and Resolver Tests

Add tests for:

- explicit `--skill strudel`
- explicit `--template strudel-track`
- precedence when both are provided
- auto-template selection from `--skill strudel`
- unknown skill rejection
- missing skill file failure

### 8.2 Worker Prompt Tests

Add or extend tests to verify:

- worker prompts include the resolved domain skill content
- worker prompts remain generic when no skill is configured
- Strudel examples and rules are passed through as prompt text, not transformed away

### 8.3 Dependency Context Tests

Add tests around lead/mastermind orchestration to verify:

- dependent sections receive upstream winner code in worker prompts
- the context names the correct upstream worker ids and file paths
- independent sections do not receive fake dependency context

### 8.4 Regression Coverage

Keep existing integration coverage for:

- Strudel section dependency ordering
- preview generation assumptions
- lead selection and merge behavior

The new feature must not weaken the current demo path.

## 9. Rollout Boundaries

The first shipped version should stop here:

- one runtime skill flag
- one supported skill: `strudel`
- one simple Markdown skill file
- worker-only injection
- skill-driven template auto-selection
- deterministic upstream winner code prompt context

Deferred work:

- multi-skill composition
- skill manifests or richer bundle schemas
- template-declared recommended skills
- PM/reviewer domain adaptation
- non-Strudel domain bundles

## 10. File Impact

Expected implementation touchpoints:

- `apps/api/src/cli.ts`
- `apps/api/src/orchestrator/mastermind.ts`
- `apps/api/src/orchestrator/lead.ts`
- `apps/api/src/orchestrator/worker.ts`
- `apps/api/src/agents/codex-cli.ts`
- `apps/api/src/agents/types.ts`
- `apps/api/src/orchestrator/templateLoader.ts` or a dedicated template resolver helper
- `apps/api/src/orchestrator/domainSkill.ts`
- `skills/domains/strudel.md`
- tests covering CLI resolution, prompt injection, and dependency context

## 11. Summary

This design adds a minimal, replaceable domain-skill mechanism without compromising ORC's generic architecture.

The key decisions are:

- runtime `--skill` is the source of truth
- only workers consume the skill in the first cut
- `--skill strudel` auto-selects the Strudel template when no explicit template is given
- Strudel domain guidance lives in a single Markdown file
- downstream Strudel workers receive real upstream winner code as prompt context

That is enough to make the hackathon demo reliable while keeping the implementation simple enough to replace later.
