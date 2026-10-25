CREATE TABLE IF NOT EXISTS `ticket_sequences` (
	`guildId` varchar(20) NOT NULL,
	`nextTicketNumber` int NOT NULL,
	CONSTRAINT `ticket_sequences_guildId` PRIMARY KEY(`guildId`)
)
ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ticket_open_counts` (
	`guildId` varchar(20) NOT NULL,
	`openerId` varchar(20) NOT NULL,
	`openCount` int NOT NULL DEFAULT 0,
	CONSTRAINT `ticket_open_counts_guildId_openerId_pk` PRIMARY KEY(`guildId`,`openerId`)
)
ENGINE=InnoDB;
--> statement-breakpoint
INSERT INTO `ticket_sequences` (`guildId`, `nextTicketNumber`)
SELECT `guildId`, MAX(`ticketNumber`) + 1 FROM `tickets` GROUP BY `guildId`
ON DUPLICATE KEY UPDATE `nextTicketNumber` = GREATEST(`nextTicketNumber`, VALUES(`nextTicketNumber`));
--> statement-breakpoint
INSERT INTO `ticket_open_counts` (`guildId`, `openerId`, `openCount`)
SELECT `guildId`, `openerId`, COUNT(*) FROM `tickets` WHERE `status` <> 'closed' GROUP BY `guildId`, `openerId`
ON DUPLICATE KEY UPDATE `openCount` = VALUES(`openCount`);
--> statement-breakpoint
ALTER TABLE `tickets` MODIFY COLUMN `status` enum('open','claimed','closing','closed') NOT NULL DEFAULT 'open';
