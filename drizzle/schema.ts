import { bigint, index, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
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
