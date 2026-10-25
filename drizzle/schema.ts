import {
  bigint,
  boolean,
  index,
  int,
  json,
  longtext,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type { GuildSecurityConfig } from "../server/discord/config";

/**
 * Core user table backing the existing Manus OAuth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const guildSecuritySettings = mysqlTable("guild_security_settings", {
  guildId: varchar("guildId", { length: 20 }).primaryKey(),
  updatedByDiscordId: varchar("updatedByDiscordId", { length: 20 }).notNull(),
  settings: json("settings").$type<GuildSecurityConfig>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const securityEvents = mysqlTable("security_events", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  guildId: varchar("guildId", { length: 20 }).notNull(),
  eventType: varchar("eventType", { length: 50 }).notNull(),
  actorId: varchar("actorId", { length: 20 }),
  targetId: varchar("targetId", { length: 20 }),
  severity: mysqlEnum("severity", ["low", "medium", "high"]).default("low").notNull(),
  details: json("details").$type<Record<string, string | number | boolean | null | string[]>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("security_events_guild_created_idx").on(table.guildId, table.createdAt),
  index("security_events_actor_created_idx").on(table.guildId, table.actorId, table.createdAt),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type GuildSecuritySettingsRow = typeof guildSecuritySettings.$inferSelect;
export type SecurityEventRow = typeof securityEvents.$inferSelect;

/** Moderation and automated-response cases. Case numbers are sequential per guild. */
export const modCases = mysqlTable("mod_cases", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  guildId: varchar("guildId", { length: 20 }).notNull(),
  caseNumber: int("caseNumber").notNull(),
  type: varchar("type", { length: 24 }).notNull(),
  targetId: varchar("targetId", { length: 20 }),
  moderatorId: varchar("moderatorId", { length: 20 }).notNull(),
  reason: varchar("reason", { length: 512 }),
  durationSeconds: int("durationSeconds"),
  active: boolean("active").default(true).notNull(),
  source: mysqlEnum("source", ["manual", "auto", "delegation", "dashboard"]).default("manual").notNull(),
  metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("mod_cases_guild_number_idx").on(table.guildId, table.caseNumber),
  index("mod_cases_guild_target_idx").on(table.guildId, table.targetId, table.createdAt),
  index("mod_cases_guild_created_idx").on(table.guildId, table.createdAt),
]);

/** Structural snapshots of roles and channels used for drift detection and restore. */
export const guildBackups = mysqlTable("guild_backups", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  guildId: varchar("guildId", { length: 20 }).notNull(),
  createdById: varchar("createdById", { length: 20 }).notNull(),
  kind: mysqlEnum("kind", ["manual", "auto", "pre_incident"]).default("manual").notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  roleCount: int("roleCount").notNull(),
  channelCount: int("channelCount").notNull(),
  data: longtext("data").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("guild_backups_guild_created_idx").on(table.guildId, table.createdAt)]);

export const tickets = mysqlTable("tickets", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  guildId: varchar("guildId", { length: 20 }).notNull(),
  ticketNumber: int("ticketNumber").notNull(),
  channelId: varchar("channelId", { length: 20 }),
  openerId: varchar("openerId", { length: 20 }).notNull(),
  topic: varchar("topic", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["open", "claimed", "closing", "closed"]).default("open").notNull(),
  claimedById: varchar("claimedById", { length: 20 }),
  closedById: varchar("closedById", { length: 20 }),
  closeReason: varchar("closeReason", { length: 512 }),
  transcript: mediumtext("transcript"),
  messageCount: int("messageCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
}, (table) => [
  uniqueIndex("tickets_guild_number_idx").on(table.guildId, table.ticketNumber),
  index("tickets_guild_status_idx").on(table.guildId, table.status),
  index("tickets_guild_opener_idx").on(table.guildId, table.openerId, table.status),
  index("tickets_channel_idx").on(table.channelId),
]);

/** Per-guild counter locked during ticket reservation to keep ticket numbers sequential. */
export const ticketSequences = mysqlTable("ticket_sequences", {
  guildId: varchar("guildId", { length: 20 }).primaryKey(),
  nextTicketNumber: int("nextTicketNumber").notNull(),
});

/** One locked row per member/Guild prevents concurrent clicks from bypassing ticket limits. */
export const ticketOpenCounts = mysqlTable("ticket_open_counts", {
  guildId: varchar("guildId", { length: 20 }).notNull(),
  openerId: varchar("openerId", { length: 20 }).notNull(),
  openCount: int("openCount").default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.guildId, table.openerId] })]);

export const memberLevels = mysqlTable("member_levels", {
  guildId: varchar("guildId", { length: 20 }).notNull(),
  userId: varchar("userId", { length: 20 }).notNull(),
  xp: int("xp").default(0).notNull(),
  level: int("level").default(0).notNull(),
  messages: int("messages").default(0).notNull(),
  lastXpAt: timestamp("lastXpAt").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.userId] }),
  index("member_levels_guild_xp_idx").on(table.guildId, table.xp),
]);

export const giveaways = mysqlTable("giveaways", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  guildId: varchar("guildId", { length: 20 }).notNull(),
  channelId: varchar("channelId", { length: 20 }).notNull(),
  messageId: varchar("messageId", { length: 20 }),
  hostId: varchar("hostId", { length: 20 }).notNull(),
  prize: varchar("prize", { length: 200 }).notNull(),
  winnerCount: int("winnerCount").default(1).notNull(),
  requiredRoleId: varchar("requiredRoleId", { length: 20 }),
  status: mysqlEnum("status", ["running", "ended", "cancelled"]).default("running").notNull(),
  winners: json("winners").$type<string[]>().notNull(),
  endsAt: timestamp("endsAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("giveaways_status_ends_idx").on(table.status, table.endsAt),
  index("giveaways_guild_created_idx").on(table.guildId, table.createdAt),
]);

export const giveawayEntries = mysqlTable("giveaway_entries", {
  giveawayId: bigint("giveawayId", { mode: "number" }).notNull(),
  userId: varchar("userId", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.giveawayId, table.userId] })]);

export const suggestions = mysqlTable("suggestions", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  guildId: varchar("guildId", { length: 20 }).notNull(),
  suggestionNumber: int("suggestionNumber").notNull(),
  channelId: varchar("channelId", { length: 20 }).notNull(),
  messageId: varchar("messageId", { length: 20 }),
  authorId: varchar("authorId", { length: 20 }).notNull(),
  anonymous: boolean("anonymous").default(false).notNull(),
  content: text("content").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "implemented"]).default("pending").notNull(),
  reviewerId: varchar("reviewerId", { length: 20 }),
  reviewNote: varchar("reviewNote", { length: 512 }),
  upvotes: int("upvotes").default(0).notNull(),
  downvotes: int("downvotes").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("suggestions_guild_number_idx").on(table.guildId, table.suggestionNumber),
  index("suggestions_message_idx").on(table.messageId),
]);

export const suggestionVotes = mysqlTable("suggestion_votes", {
  suggestionId: bigint("suggestionId", { mode: "number" }).notNull(),
  userId: varchar("userId", { length: 20 }).notNull(),
  vote: mysqlEnum("vote", ["up", "down"]).notNull(),
}, (table) => [primaryKey({ columns: [table.suggestionId, table.userId] })]);

/** Per-day aggregate counters. Only counts are stored; never message content. */
export const guildDailyStats = mysqlTable("guild_daily_stats", {
  guildId: varchar("guildId", { length: 20 }).notNull(),
  day: varchar("day", { length: 10 }).notNull(),
  joins: int("joins").default(0).notNull(),
  leaves: int("leaves").default(0).notNull(),
  messages: int("messages").default(0).notNull(),
  modActions: int("modActions").default(0).notNull(),
  threats: int("threats").default(0).notNull(),
  autoActions: int("autoActions").default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.guildId, table.day] })]);

/** Active lockdown state, with the exact previous @everyone overwrite per channel for a faithful unlock. */
export const lockdownStates = mysqlTable("lockdown_states", {
  guildId: varchar("guildId", { length: 20 }).primaryKey(),
  active: boolean("active").default(false).notNull(),
  reason: varchar("reason", { length: 512 }),
  startedById: varchar("startedById", { length: 20 }),
  trigger: mysqlEnum("trigger", ["manual", "anti_nuke", "anti_raid", "dashboard"]).default("manual").notNull(),
  channels: json("channels").$type<Array<{ channelId: string; previous: "allow" | "deny" | "neutral" }>>().notNull(),
  startedAt: timestamp("startedAt"),
  endsAt: timestamp("endsAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** A manually verified commercial entitlement. Payment details never enter this table. */
export const guildSubscriptions = mysqlTable("guild_subscriptions", {
  guildId: varchar("guildId", { length: 20 }).primaryKey(),
  plan: mysqlEnum("plan", ["monthly", "annual"]).notNull(),
  status: mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
  startsAt: timestamp("startsAt").notNull(),
  endsAt: timestamp("endsAt").notNull(),
  note: varchar("note", { length: 300 }),
  updatedByDiscordId: varchar("updatedByDiscordId", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("guild_subscriptions_status_ends_idx").on(table.status, table.endsAt)]);

/** Owner-only audit trail for entitlement changes; it deliberately excludes payment proof and bank data. */
export const guildSubscriptionAudits = mysqlTable("guild_subscription_audits", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  guildId: varchar("guildId", { length: 20 }).notNull(),
  action: mysqlEnum("action", ["activate", "renew", "suspend"]).notNull(),
  plan: mysqlEnum("plan", ["monthly", "annual"]),
  previousEndsAt: timestamp("previousEndsAt"),
  nextEndsAt: timestamp("nextEndsAt"),
  note: varchar("note", { length: 300 }),
  actedByDiscordId: varchar("actedByDiscordId", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("guild_subscription_audits_guild_created_idx").on(table.guildId, table.createdAt)]);

export type ModCaseRow = typeof modCases.$inferSelect;
export type GuildBackupRow = typeof guildBackups.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type MemberLevelRow = typeof memberLevels.$inferSelect;
export type GiveawayRow = typeof giveaways.$inferSelect;
export type SuggestionRow = typeof suggestions.$inferSelect;
export type GuildDailyStatsRow = typeof guildDailyStats.$inferSelect;
export type LockdownStateRow = typeof lockdownStates.$inferSelect;
export type GuildSubscriptionRow = typeof guildSubscriptions.$inferSelect;
export type GuildSubscriptionAuditRow = typeof guildSubscriptionAudits.$inferSelect;
