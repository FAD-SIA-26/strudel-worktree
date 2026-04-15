# User-Gated Lane Review: Implemented Behavior

This note describes the current shipped behavior for ORC's lane review flow and dashboard preview UX.

## Core Winner Selection Flow

- The reviewer only suggests a winner. It does not finalize one automatically.
- Each lead stops in `awaiting_user_approval` after workers finish and a proposal is available.
- The user is authoritative:
  - `Accept suggestion` selects the reviewer proposal.
  - `Choose this winner` on another completed worker overrides the proposal.
- The selected worker is merged into the lane branch, not directly into the run branch.
- Mastermind merges lane branches into the run branch later, after all lanes are finalized.

## Dashboard UX

- Lead compare view distinguishes:
  - `SUGGESTED BY REVIEWER`
  - `SELECTED WINNER`
  - `MERGED INTO LANE`
- Winner selection is explicit and visible:
  - pending state shows `SELECTING...`
  - selected lanes show `Current selected winner: ...`
- The dashboard exposes `Launch full song preview` only when the run is `review_ready` and a final preview is launchable.
- Preview launch uses the shared preview helper for both worker previews and the final full-song preview.
- First-click preview launch opens the Strudel tab immediately instead of leaving the user on `about:blank`.

## Runtime Lifecycle

- Successful orchestration now ends in `review_ready`, not automatic shutdown.
- ORC stays alive so the user can audition the full song from the dashboard.
- Shutdown happens when the user stops the terminal process with `Ctrl+C`.

## Data / Contract Shape

- Worker payloads expose:
  - `isProposed`
  - `isSelected`
  - `canBeSelected`
  - `isStopping`
  - `contextAvailable`
  - `previewArtifacts`
- Section payloads expose:
  - `proposedWinnerWorkerId`
  - `selectedWinnerWorkerId`
  - `selectionStatus`
  - `awaitingUserApproval`
- Run payloads expose:
  - `reviewReady`
  - `fullSongPreviewAvailable`
  - `fullSongPreviewUrl`

## Supporting Implementation Notes

- Preview generation persists preview artifacts for solo, contextual, and final run previews.
- Domain skill and template resolution now fall back to bundled package assets when the target repo does not contain local `skills/` or `templates/` files.
