PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_merge_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`proposed_winner_worker_id` text,
	`selected_winner_worker_id` text,
	`target_branch` text NOT NULL,
	`reviewer_reasoning` text,
	`selection_source` text DEFAULT 'proposal_accept' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_merge_candidates`("id", "lead_id", "proposed_winner_worker_id", "selected_winner_worker_id", "target_branch", "reviewer_reasoning", "selection_source")
SELECT
  "id",
  "lead_id",
  "winner_worker_id",
  "winner_worker_id",
  "target_branch",
  "reviewer_reasoning",
  CASE
    WHEN "selection_source" IN ('user', 'user_override') THEN 'user_override'
    ELSE 'proposal_accept'
  END
FROM `merge_candidates`;--> statement-breakpoint
DROP TABLE `merge_candidates`;--> statement-breakpoint
ALTER TABLE `__new_merge_candidates` RENAME TO `merge_candidates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
