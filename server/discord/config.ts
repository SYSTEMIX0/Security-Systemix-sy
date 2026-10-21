import { z } from "zod";

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, "Invalid Discord ID");
const nullableSnowflake = snowflakeSchema.nullable();
const allowedActorIds = z.array(snowflakeSchema).max(100);
const keywordList = z.array(z.string().trim().min(1).max(60)).max(100);

const antiNukeSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(2).max(20),
  windowSeconds: z.number().int().min(5).max(120),
  alertChannelId: nullableSnowflake,
  allowlistedActorIds: allowedActorIds,
}).strict();

const antiRaidSchema = z.object({
  enabled: z.boolean(),
  joinThreshold: z.number().int().min(2).max(100),
  windowSeconds: z.number().int().min(5).max(120),
  minAccountAgeHours: z.number().int().min(0).max(24 * 365),
  alertChannelId: nullableSnowflake,
}).strict();

const autoModSchema = z.object({
  enabled: z.boolean(),
  blockInvites: z.boolean(),
  blockMentionSpam: z.boolean(),
  mentionLimit: z.number().int().min(2).max(50),
  blockedKeywords: keywordList,
  alertChannelId: nullableSnowflake,
}).strict();

export const guildSecurityConfigSchema = z.object({
  version: z.literal(1),
  mode: z.literal("observe"),
  antiNuke: antiNukeSchema,
  antiRaid: antiRaidSchema,
  autoMod: autoModSchema,
}).strict();

export const guildSecurityPatchSchema = z.object({
  antiNuke: antiNukeSchema.partial().optional(),
  antiRaid: antiRaidSchema.partial().optional(),
  autoMod: autoModSchema.partial().optional(),
}).strict();

export type GuildSecurityConfig = z.infer<typeof guildSecurityConfigSchema>;
export type GuildSecurityPatch = z.infer<typeof guildSecurityPatchSchema>;

export const defaultGuildSecurityConfig: GuildSecurityConfig = {
  version: 1,
  mode: "observe",
  antiNuke: {
    enabled: false,
    threshold: 3,
    windowSeconds: 10,
    alertChannelId: null,
    allowlistedActorIds: [],
  },
  antiRaid: {
    enabled: false,
    joinThreshold: 8,
    windowSeconds: 15,
    minAccountAgeHours: 24,
    alertChannelId: null,
  },
  autoMod: {
    enabled: false,
    blockInvites: false,
    blockMentionSpam: false,
    mentionLimit: 5,
    blockedKeywords: [],
    alertChannelId: null,
  },
};

export function normalizeGuildSecurityConfig(value: unknown): GuildSecurityConfig {
  return guildSecurityConfigSchema.parse(value ?? defaultGuildSecurityConfig);
}

export function mergeGuildSecurityConfig(
  current: GuildSecurityConfig,
  patch: GuildSecurityPatch,
): GuildSecurityConfig {
  return guildSecurityConfigSchema.parse({
    ...current,
    antiNuke: { ...current.antiNuke, ...patch.antiNuke },
    antiRaid: { ...current.antiRaid, ...patch.antiRaid },
    autoMod: { ...current.autoMod, ...patch.autoMod },
  });
}
