CREATE TABLE `guild_security_settings` (
	`guildId` varchar(20) NOT NULL,
	`updatedByDiscordId` varchar(20) NOT NULL,
	`settings` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `guild_security_settings_guildId` PRIMARY KEY(`guildId`)
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`guildId` varchar(20) NOT NULL,
	`eventType` varchar(50) NOT NULL,
	`actorId` varchar(20),
	`targetId` varchar(20),
	`severity` enum('low','medium','high') NOT NULL DEFAULT 'low',
	`details` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `security_events_guild_created_idx` ON `security_events` (`guildId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `security_events_actor_created_idx` ON `security_events` (`guildId`,`actorId`,`createdAt`);