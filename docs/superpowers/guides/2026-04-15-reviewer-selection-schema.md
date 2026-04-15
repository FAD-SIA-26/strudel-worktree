# Reviewer Selection Schema

This schema describes the current shipped reviewer and winner-selection flow in ORC.

## Lane Review Flow

```mermaid
flowchart TD
  A[Lead finishes collecting worker results] --> B{Any workers done?}
  B -- No --> C[Lead fails]
  B -- Yes --> D[Build reviewer prompt from section goal plus completed worker diffs]
  D --> E[Reviewer returns winnerId plus reasoning]
  E --> F[Persist proposedWinnerWorkerId]
  F --> G[Lead enters awaiting_user_approval]
  G --> H[Dashboard shows SUGGESTED BY REVIEWER plus Accept suggestion]
  G --> I[Dashboard shows Choose this winner on other completed workers]
  H --> J[POST /api/approve with leadId only]
  I --> K[POST /api/approve with leadId plus workerId]
  J --> L[Queue AcceptProposal]
  K --> M[Queue SelectWinner]
  L --> N[Persist selectedWinnerWorkerId from reviewer proposal]
  M --> O[Persist selectedWinnerWorkerId from user override]
  N --> P[Lead enters merging_lane]
  O --> P
  P --> Q[Merge selected worker branch into lane branch]
  Q --> R[Lead done]
  R --> S[Mastermind later merges finalized lane branches into run branch]
```

## Authority Boundary

- Reviewer decides `proposedWinnerWorkerId`.
- User decides `selectedWinnerWorkerId`.
- No branch merge happens until a user action selects a winner.
- The selected worker merges into the lane branch first, not directly into the run branch.

## Failure / Fallback Path

```mermaid
flowchart TD
  A[Reviewer call fails or returns invalid winner] --> B[Fallback proposal = first completed worker]
  B --> C[Persist proposedWinnerWorkerId]
  C --> D[Lead still waits in awaiting_user_approval]
  D --> E[User must still accept suggestion or choose another completed worker]
```
