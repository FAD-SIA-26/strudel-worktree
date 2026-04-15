ALTER TABLE `merge_candidates` ADD `selection_source` text DEFAULT 'reviewer' NOT NULL;
--> statement-breakpoint
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
INSERT INTO `__new_previews` (`worker_id`, `mode`, `preview_url`, `generated_code`, `source_files`, `context_winner_ids`, `generated_at`)
SELECT `worktree_id`, 'solo', `preview_url`, '', '[]', '[]', COALESCE(`launched_at`, 0)
FROM `previews`;
--> statement-breakpoint
DROP TABLE `previews`;
--> statement-breakpoint
ALTER TABLE `__new_previews` RENAME TO `previews`;
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_worker_mode_uniq` ON `previews` (`worker_id`,`mode`);
