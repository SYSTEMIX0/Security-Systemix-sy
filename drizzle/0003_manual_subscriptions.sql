CREATE TABLE `guild_subscription_audits` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`guildId` varchar(20) NOT NULL,
	`action` enum('activate','renew','suspend') NOT NULL,
	`plan` enum('monthly','annual'),
	`previousEndsAt` timestamp,
	`nextEndsAt` timestamp,
	`note` varchar(300),
	`actedByDiscordId` varchar(20) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guild_subscription_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guild_subscriptions` (
	`guildId` varchar(20) NOT NULL,
	`plan` enum('monthly','annual') NOT NULL,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`startsAt` timestamp NOT NULL,
	`endsAt` timestamp NOT NULL,
	`note` varchar(300),
	`updatedByDiscordId` varchar(20) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `guild_subscriptions_guildId` PRIMARY KEY(`guildId`)
);
--> statement-breakpoint
CREATE INDEX `guild_subscription_audits_guild_created_idx` ON `guild_subscription_audits` (`guildId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `guild_subscriptions_status_ends_idx` ON `guild_subscriptions` (`status`,`endsAt`);
