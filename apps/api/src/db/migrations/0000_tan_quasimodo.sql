CREATE TABLE `artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`path` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_artifact_uniq` ON `artifacts` (`entity_id`,`artifact_type`);--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`event_type` text NOT NULL,
	`sequence` integer NOT NULL,
	`payload` text NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_seq_uniq` ON `event_log` (`entity_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `merge_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`winner_worker_id` text NOT NULL,
	`target_branch` text NOT NULL,
	`reviewer_reasoning` text
);
--> statement-breakpoint
CREATE TABLE `merge_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` text NOT NULL,
	`winner_worktree_id` text NOT NULL,
	`target_branch` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`conflict_details` text,
	`fix_worker_id` text,
	`fix_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`merged_at` integer
);
--> statement-breakpoint
CREATE TABLE `previews` (
	`id` text PRIMARY KEY NOT NULL,
	`worktree_id` text NOT NULL,
	`preview_url` text NOT NULL,
	`status` text DEFAULT 'inactive' NOT NULL,
	`launched_at` integer
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`adapter_type` text,
	`pid` integer,
	`started_at` integer NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE TABLE `task_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` text NOT NULL,
	`child_id` text NOT NULL,
	`edge_type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`parent_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`task_prompt` text,
	`strategy` text,
	`spawn_generation` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`git_status` text DEFAULT 'clean'
);
