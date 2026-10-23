CREATE TABLE `giveaway_entries` (
	`giveawayId` bigint NOT NULL,
	`userId` varchar(20) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `giveaway_entries_giveawayId_userId_pk` PRIMARY KEY(`giveawayId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `giveaways` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`guildId` varchar(20) NOT NULL,
	`channelId` varchar(20) NOT NULL,
	`messageId` varchar(20),
	`hostId` varchar(20) NOT NULL,
	`prize` varchar(200) NOT NULL,
	`winnerCount` int NOT NULL DEFAULT 1,
	`requiredRoleId` varchar(20),
	`status` enum('running','ended','cancelled') NOT NULL DEFAULT 'running',
	`winners` json NOT NULL,
	`endsAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `giveaways_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guild_backups` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`guildId` varchar(20) NOT NULL,
	`createdById` varchar(20) NOT NULL,
	`kind` enum('manual','auto','pre_incident') NOT NULL DEFAULT 'manual',
	`label` varchar(100) NOT NULL,
	`roleCount` int NOT NULL,
	`channelCount` int NOT NULL,
	`data` longtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guild_backups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guild_daily_stats` (
	`guildId` varchar(20) NOT NULL,
	`day` varchar(10) NOT NULL,
	`joins` int NOT NULL DEFAULT 0,
	`leaves` int NOT NULL DEFAULT 0,
	`messages` int NOT NULL DEFAULT 0,
	`modActions` int NOT NULL DEFAULT 0,
	`threats` int NOT NULL DEFAULT 0,
	`autoActions` int NOT NULL DEFAULT 0,
	CONSTRAINT `guild_daily_stats_guildId_day_pk` PRIMARY KEY(`guildId`,`day`)
);
--> statement-breakpoint
CREATE TABLE `lockdown_states` (
	`guildId` varchar(20) NOT NULL,
	`active` boolean NOT NULL DEFAULT false,
	`reason` varchar(512),
	`startedById` varchar(20),
	`trigger` enum('manual','anti_nuke','anti_raid','dashboard') NOT NULL DEFAULT 'manual',
	`channels` json NOT NULL,
	`startedAt` timestamp,
	`endsAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lockdown_states_guildId` PRIMARY KEY(`guildId`)
);
--> statement-breakpoint
CREATE TABLE `member_levels` (
	`guildId` varchar(20) NOT NULL,
	`userId` varchar(20) NOT NULL,
	`xp` int NOT NULL DEFAULT 0,
	`level` int NOT NULL DEFAULT 0,
	`messages` int NOT NULL DEFAULT 0,
	`lastXpAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `member_levels_guildId_userId_pk` PRIMARY KEY(`guildId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `mod_cases` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`guildId` varchar(20) NOT NULL,
	`caseNumber` int NOT NULL,
	`type` varchar(24) NOT NULL,
	`targetId` varchar(20),
	`moderatorId` varchar(20) NOT NULL,
	`reason` varchar(512),
	`durationSeconds` int,
	`active` boolean NOT NULL DEFAULT true,
	`source` enum('manual','auto','delegation','dashboard') NOT NULL DEFAULT 'manual',
	`metadata` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mod_cases_id` PRIMARY KEY(`id`),
	CONSTRAINT `mod_cases_guild_number_idx` UNIQUE(`guildId`,`caseNumber`)
);
--> statement-breakpoint
CREATE TABLE `suggestion_votes` (
	`suggestionId` bigint NOT NULL,
	`userId` varchar(20) NOT NULL,
	`vote` enum('up','down') NOT NULL,
	CONSTRAINT `suggestion_votes_suggestionId_userId_pk` PRIMARY KEY(`suggestionId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`guildId` varchar(20) NOT NULL,
	`suggestionNumber` int NOT NULL,
	`channelId` varchar(20) NOT NULL,
	`messageId` varchar(20),
	`authorId` varchar(20) NOT NULL,
	`anonymous` boolean NOT NULL DEFAULT false,
	`content` text NOT NULL,
	`status` enum('pending','approved','rejected','implemented') NOT NULL DEFAULT 'pending',
	`reviewerId` varchar(20),
	`reviewNote` varchar(512),
	`upvotes` int NOT NULL DEFAULT 0,
	`downvotes` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suggestions_id` PRIMARY KEY(`id`),
	CONSTRAINT `suggestions_guild_number_idx` UNIQUE(`guildId`,`suggestionNumber`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`guildId` varchar(20) NOT NULL,
	`ticketNumber` int NOT NULL,
	`channelId` varchar(20),
	`openerId` varchar(20) NOT NULL,
	`topic` varchar(80) NOT NULL,
	`status` enum('open','claimed','closed') NOT NULL DEFAULT 'open',
	`claimedById` varchar(20),
	`closedById` varchar(20),
	`closeReason` varchar(512),
	`transcript` mediumtext,
	`messageCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tickets_guild_number_idx` UNIQUE(`guildId`,`ticketNumber`)
);
--> statement-breakpoint
CREATE INDEX `giveaways_status_ends_idx` ON `giveaways` (`status`,`endsAt`);--> statement-breakpoint
CREATE INDEX `giveaways_guild_created_idx` ON `giveaways` (`guildId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `guild_backups_guild_created_idx` ON `guild_backups` (`guildId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `member_levels_guild_xp_idx` ON `member_levels` (`guildId`,`xp`);--> statement-breakpoint
CREATE INDEX `mod_cases_guild_target_idx` ON `mod_cases` (`guildId`,`targetId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `mod_cases_guild_created_idx` ON `mod_cases` (`guildId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `suggestions_message_idx` ON `suggestions` (`messageId`);--> statement-breakpoint
CREATE INDEX `tickets_guild_status_idx` ON `tickets` (`guildId`,`status`);--> statement-breakpoint
CREATE INDEX `tickets_guild_opener_idx` ON `tickets` (`guildId`,`openerId`,`status`);--> statement-breakpoint
CREATE INDEX `tickets_channel_idx` ON `tickets` (`channelId`);