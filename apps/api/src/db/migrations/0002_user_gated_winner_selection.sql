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
  COALESCE("selection_source", 'proposal_accept')
FROM `merge_candidates`;--> statement-breakpoint
DROP TABLE `merge_candidates`;--> statement-breakpoint
ALTER TABLE `__new_merge_candidates` RENAME TO `merge_candidates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_previews` (
	`worker_id` text NOT NULL,
	`mode` text NOT NULL,
	`preview_url` text NOT NULL,
	`generated_code` text NOT NULL,
	`source_files` text DEFAULT '[]' NOT NULL,
	`context_winner_ids` text DEFAULT '[]' NOT NULL,
	`generated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_previews`("worker_id", "mode", "preview_url", "generated_code", "source_files", "context_winner_ids", "generated_at") SELECT "worker_id", "mode", "preview_url", "generated_code", "source_files", "context_winner_ids", "generated_at" FROM `previews`;--> statement-breakpoint
DROP TABLE `previews`;--> statement-breakpoint
ALTER TABLE `__new_previews` RENAME TO `previews`;--> statement-breakpoint
CREATE UNIQUE INDEX `preview_worker_mode_uniq` ON `previews` (`worker_id`,`mode`);
