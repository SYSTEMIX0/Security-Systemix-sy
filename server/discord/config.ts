import { z } from "zod";

/**
 * Security Systemix guild configuration (v2).
 *
 * One JSON document per guild holds every module's settings. Stored documents are
 * deep-merged over the defaults before validation, so older documents (v1) and documents
 * missing newly added modules are upgraded transparently without a data migration.
 */

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, "Invalid Discord ID");
const nid = snowflakeSchema.nullable();
const ids = (max: number) => z.array(snowflakeSchema).max(max);
const text = (max: number) => z.string().max(max);
const slug = z.string().regex(/^[a-z0-9_-]{1,24}$/, "Invalid identifier");
const emoji = z.string().max(64);
const keywordList = z.array(z.string().trim().min(1).max(60)).max(100);
const domainList = z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]{3,80}$/)).max(50);
const minutes = (max: number) => z.number().int().min(1).max(max);

export const PUNISHMENTS = ["alert", "strip_roles", "timeout", "kick", "ban"] as const;
export const RAID_ACTIONS = ["alert", "timeout", "kick", "ban"] as const;
export const NEW_ACCOUNT_ACTIONS = ["none", "timeout", "kick"] as const;
export const SPAM_ACTIONS = ["delete", "warn", "timeout", "kick"] as const;
export const HONEYPOT_ACTIONS = ["timeout", "kick", "ban"] as const;
export const DELEGATION_ACTIONS = ["add_role", "remove_role", "timeout", "untimeout", "nickname"] as const;
export const ANTI_NUKE_ACTIONS = [
  "channel_create",
  "channel_delete",
  "channel_update",
  "role_create",
  "role_delete",
  "role_update",
  "member_kick",
  "member_ban",
  "member_prune",
  "member_role_update",
  "webhook_create",
  "webhook_update",
  "webhook_delete",
  "bot_add",
  "message_bulk_delete",
  "guild_update",
  "emoji_delete",
] as const;

const generalSchema = z.object({
  staffRoleIds: ids(25),
  modLogChannelId: nid,
  securityLogChannelId: nid,
  timezone: text(40),
  embedColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const antiNukeSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(2).max(20),
  windowSeconds: z.number().int().min(5).max(120),
  alertChannelId: nid,
  allowlistedActorIds: ids(100),
  allowlistedRoleIds: ids(25),
  monitoredActions: z.array(z.enum(ANTI_NUKE_ACTIONS)).max(ANTI_NUKE_ACTIONS.length),
  punishment: z.enum(PUNISHMENTS),
  timeoutMinutes: minutes(40_320),
  lockdownOnTrigger: z.boolean(),
  kickUnauthorizedBots: z.boolean(),
  snapshotOnTrigger: z.boolean(),
});

const antiRaidSchema = z.object({
  enabled: z.boolean(),
  joinThreshold: z.number().int().min(2).max(100),
  windowSeconds: z.number().int().min(5).max(300),
  minAccountAgeHours: z.number().int().min(0).max(24 * 365),
  alertChannelId: nid,
  raidAction: z.enum(RAID_ACTIONS),
  newAccountAction: z.enum(NEW_ACCOUNT_ACTIONS),
  timeoutMinutes: minutes(40_320),
  raidModeMinutes: minutes(1_440),
  autoLockdown: z.boolean(),
  flagNoAvatar: z.boolean(),
});

const autoModSchema = z.object({
  enabled: z.boolean(),
  blockInvites: z.boolean(),
  blockMentionSpam: z.boolean(),
  mentionLimit: z.number().int().min(2).max(50),
  blockedKeywords: keywordList,
  alertChannelId: nid,
  blockSpamContent: z.boolean(),
  presetProfanity: z.boolean(),
  presetSexualContent: z.boolean(),
  presetSlurs: z.boolean(),
  blockLinks: z.boolean(),
  allowedLinkDomains: domainList,
  exemptRoleIds: ids(20),
  exemptChannelIds: ids(50),
  timeoutSeconds: z.number().int().min(0).max(604_800),
});

const antiSpamSchema = z.object({
  enabled: z.boolean(),
  maxMessages: z.number().int().min(3).max(30),
  perSeconds: z.number().int().min(2).max(60),
  duplicateLimit: z.number().int().min(0).max(20),
  maxMentions: z.number().int().min(0).max(50),
  capsPercent: z.number().int().min(0).max(100),
  blockLinks: z.boolean(),
  allowedDomains: domainList,
  action: z.enum(SPAM_ACTIONS),
  timeoutMinutes: minutes(1_440),
  exemptRoleIds: ids(20),
  exemptChannelIds: ids(50),
  alertChannelId: nid,
});

const honeypotSchema = z.object({
  enabled: z.boolean(),
  channelId: nid,
  action: z.enum(HONEYPOT_ACTIONS),
  timeoutMinutes: minutes(40_320),
  deleteMessage: z.boolean(),
});

const moderationSchema = z.object({
  dmOnAction: z.boolean(),
  requireReason: z.boolean(),
  deleteMessageDaysOnBan: z.number().int().min(0).max(7),
  escalation: z.object({
    enabled: z.boolean(),
    timeoutAt: z.number().int().min(0).max(20),
    timeoutMinutes: minutes(40_320),
    kickAt: z.number().int().min(0).max(20),
    banAt: z.number().int().min(0).max(20),
  }),
  appealText: text(300),
});

const loggingSchema = z.object({
  enabled: z.boolean(),
  channelId: nid,
  memberJoinLeave: z.boolean(),
  messageDelete: z.boolean(),
  messageEdit: z.boolean(),
  memberRoles: z.boolean(),
  nicknames: z.boolean(),
  channelChanges: z.boolean(),
  roleChanges: z.boolean(),
  voice: z.boolean(),
  moderation: z.boolean(),
  ignoredChannelIds: ids(50),
});

const verificationSchema = z.object({
  enabled: z.boolean(),
  channelId: nid,
  verifiedRoleId: nid,
  removeRoleId: nid,
  mode: z.enum(["button", "captcha"]),
  minAccountAgeHours: z.number().int().min(0).max(24 * 365),
  panelTitle: text(100),
  panelDescription: text(1_000),
  logChannelId: nid,
});

const ticketTopicSchema = z.object({
  id: slug,
  label: z.string().trim().min(1).max(80),
  emoji,
  description: text(100),
});

const ticketsSchema = z.object({
  enabled: z.boolean(),
  categoryId: nid,
  staffRoleIds: ids(10),
  panelChannelId: nid,
  transcriptChannelId: nid,
  maxOpenPerUser: z.number().int().min(1).max(5),
  panelTitle: text(100),
  panelDescription: text(1_000),
  openMessage: text(1_000),
  topics: z.array(ticketTopicSchema).max(10),
});

const welcomeSchema = z.object({
  enabled: z.boolean(),
  channelId: nid,
  message: text(1_500),
  useEmbed: z.boolean(),
  autoRoleIds: ids(5),
  dmEnabled: z.boolean(),
  dmMessage: text(1_500),
  goodbyeEnabled: z.boolean(),
  goodbyeChannelId: nid,
  goodbyeMessage: text(1_000),
});

const selfRolePanelSchema = z.object({
  id: slug,
  channelId: nid,
  title: z.string().trim().min(1).max(100),
  description: text(500),
  mode: z.enum(["toggle", "single"]),
  roles: z.array(z.object({ roleId: snowflakeSchema, label: z.string().trim().min(1).max(80), emoji })).max(25),
  messageId: nid,
});

const selfRolesSchema = z.object({
  enabled: z.boolean(),
  panels: z.array(selfRolePanelSchema).max(10),
});

const levelingSchema = z.object({
  enabled: z.boolean(),
  xpMin: z.number().int().min(1).max(100),
  xpMax: z.number().int().min(1).max(200),
  cooldownSeconds: z.number().int().min(10).max(600),
  announce: z.enum(["off", "channel", "current"]),
  announceChannelId: nid,
  announceMessage: text(500),
  rewards: z.array(z.object({ level: z.number().int().min(1).max(500), roleId: snowflakeSchema })).max(25),
  stackRewards: z.boolean(),
  ignoredChannelIds: ids(50),
  noXpRoleIds: ids(20),
});

const suggestionsSchema = z.object({
  enabled: z.boolean(),
  channelId: nid,
  reviewerRoleIds: ids(10),
  allowAnonymous: z.boolean(),
  createThreads: z.boolean(),
});

const giveawaysSchema = z.object({
  enabled: z.boolean(),
  managerRoleIds: ids(10),
  defaultChannelId: nid,
});

const delegationGrantSchema = z.object({
  id: slug,
  label: z.string().trim().min(1).max(80),
  actorRoleIds: z.array(snowflakeSchema).min(1).max(10),
  action: z.enum(DELEGATION_ACTIONS),
  targetRoleIds: ids(25),
  maxUsesPerHour: z.number().int().min(1).max(100),
  maxTimeoutMinutes: minutes(10_080),
  requireReason: z.boolean(),
  protectedRoleIds: ids(25),
});

const delegationSchema = z.object({
  enabled: z.boolean(),
  logChannelId: nid,
  grants: z.array(delegationGrantSchema).max(20),
});

const backupsSchema = z.object({
  autoBackupHours: z.number().int().min(0).max(168),
  retain: z.number().int().min(1).max(30),
});

const lockdownSchema = z.object({
  exemptChannelIds: ids(50),
  announce: z.boolean(),
  message: text(500),
});

const analyticsSchema = z.object({ enabled: z.boolean() });

const moduleShape = {
  general: generalSchema,
  antiNuke: antiNukeSchema,
  antiRaid: antiRaidSchema,
  autoMod: autoModSchema,
  antiSpam: antiSpamSchema,
  honeypot: honeypotSchema,
  moderation: moderationSchema,
  logging: loggingSchema,
  verification: verificationSchema,
  tickets: ticketsSchema,
  welcome: welcomeSchema,
  selfRoles: selfRolesSchema,
  leveling: levelingSchema,
  suggestions: suggestionsSchema,
  giveaways: giveawaysSchema,
  delegation: delegationSchema,
  backups: backupsSchema,
  lockdown: lockdownSchema,
  analytics: analyticsSchema,
} as const;

export type ModuleKey = keyof typeof moduleShape;
export const MODULE_KEYS = Object.keys(moduleShape) as ModuleKey[];

export const guildSecurityConfigSchema = z.object({
  version: z.literal(2),
  mode: z.enum(["observe", "protect"]),
  ...moduleShape,
});

export const guildSecurityPatchSchema = z.object({
  mode: z.enum(["observe", "protect"]).optional(),
  general: generalSchema.partial().strict().optional(),
  antiNuke: antiNukeSchema.partial().strict().optional(),
  antiRaid: antiRaidSchema.partial().strict().optional(),
  autoMod: autoModSchema.partial().strict().optional(),
  antiSpam: antiSpamSchema.partial().strict().optional(),
  honeypot: honeypotSchema.partial().strict().optional(),
  moderation: moderationSchema.partial().strict().optional(),
  logging: loggingSchema.partial().strict().optional(),
  verification: verificationSchema.partial().strict().optional(),
  tickets: ticketsSchema.partial().strict().optional(),
  welcome: welcomeSchema.partial().strict().optional(),
  selfRoles: selfRolesSchema.partial().strict().optional(),
  leveling: levelingSchema.partial().strict().optional(),
  suggestions: suggestionsSchema.partial().strict().optional(),
  giveaways: giveawaysSchema.partial().strict().optional(),
  delegation: delegationSchema.partial().strict().optional(),
  backups: backupsSchema.partial().strict().optional(),
  lockdown: lockdownSchema.partial().strict().optional(),
  analytics: analyticsSchema.partial().strict().optional(),
}).strict();

export type GuildSecurityConfig = z.infer<typeof guildSecurityConfigSchema>;
export type GuildSecurityPatch = z.infer<typeof guildSecurityPatchSchema>;
export type AntiNukeAction = (typeof ANTI_NUKE_ACTIONS)[number];
export type DelegationGrant = GuildSecurityConfig["delegation"]["grants"][number];
export type SelfRolePanel = GuildSecurityConfig["selfRoles"]["panels"][number];
export type TicketTopic = GuildSecurityConfig["tickets"]["topics"][number];

export const defaultGuildSecurityConfig: GuildSecurityConfig = {
  version: 2,
  mode: "observe",
  general: {
    staffRoleIds: [],
    modLogChannelId: null,
    securityLogChannelId: null,
    timezone: "Asia/Riyadh",
    embedColor: "#B7F47B",
  },
  antiNuke: {
    enabled: false,
    threshold: 3,
    windowSeconds: 10,
    alertChannelId: null,
    allowlistedActorIds: [],
    allowlistedRoleIds: [],
    monitoredActions: [...ANTI_NUKE_ACTIONS],
    punishment: "strip_roles",
    timeoutMinutes: 1_440,
    lockdownOnTrigger: false,
    kickUnauthorizedBots: true,
    snapshotOnTrigger: true,
  },
  antiRaid: {
    enabled: false,
    joinThreshold: 8,
    windowSeconds: 15,
    minAccountAgeHours: 24,
    alertChannelId: null,
    raidAction: "timeout",
    newAccountAction: "none",
    timeoutMinutes: 60,
    raidModeMinutes: 10,
    autoLockdown: false,
    flagNoAvatar: true,
  },
  autoMod: {
    enabled: false,
    blockInvites: false,
    blockMentionSpam: false,
    mentionLimit: 5,
    blockedKeywords: [],
    alertChannelId: null,
    blockSpamContent: false,
    presetProfanity: false,
    presetSexualContent: false,
    presetSlurs: false,
    blockLinks: false,
    allowedLinkDomains: [],
    exemptRoleIds: [],
    exemptChannelIds: [],
    timeoutSeconds: 0,
  },
  antiSpam: {
    enabled: false,
    maxMessages: 6,
    perSeconds: 5,
    duplicateLimit: 4,
    maxMentions: 6,
    capsPercent: 0,
    blockLinks: false,
    allowedDomains: [],
    action: "timeout",
    timeoutMinutes: 10,
    exemptRoleIds: [],
    exemptChannelIds: [],
    alertChannelId: null,
  },
  honeypot: {
    enabled: false,
    channelId: null,
    action: "timeout",
    timeoutMinutes: 1_440,
    deleteMessage: true,
  },
  moderation: {
    dmOnAction: true,
    requireReason: false,
    deleteMessageDaysOnBan: 0,
    escalation: { enabled: false, timeoutAt: 3, timeoutMinutes: 60, kickAt: 5, banAt: 0 },
    appealText: "",
  },
  logging: {
    enabled: false,
    channelId: null,
    memberJoinLeave: true,
    messageDelete: true,
    messageEdit: true,
    memberRoles: true,
    nicknames: true,
    channelChanges: true,
    roleChanges: true,
    voice: false,
    moderation: true,
    ignoredChannelIds: [],
  },
  verification: {
    enabled: false,
    channelId: null,
    verifiedRoleId: null,
    removeRoleId: null,
    mode: "button",
    minAccountAgeHours: 0,
    panelTitle: "التحقق من العضوية",
    panelDescription: "اضغط الزر بالأسفل لإكمال بوابة العضوية والحصول على رتبة Verified.",
    logChannelId: null,
  },
  tickets: {
    enabled: false,
    categoryId: null,
    staffRoleIds: [],
    panelChannelId: null,
    transcriptChannelId: null,
    maxOpenPerUser: 1,
    panelTitle: "مركز الدعم",
    panelDescription: "اختر نوع طلبك وسيفتح لك فريق الدعم تذكرة خاصة.",
    openMessage: "أهلاً {user}، وصلت تذكرتك. اشرح طلبك بالتفصيل وسيرد عليك الفريق قريباً.",
    topics: [
      { id: "support", label: "دعم عام", emoji: "🛟", description: "سؤال أو مشكلة عامة" },
      { id: "report", label: "بلاغ", emoji: "🚨", description: "الإبلاغ عن عضو أو مخالفة" },
    ],
  },
  welcome: {
    enabled: false,
    channelId: null,
    message: "أهلاً {user} في **{server}**! أنت العضو رقم {count}.",
    useEmbed: true,
    autoRoleIds: [],
    dmEnabled: false,
    dmMessage: "مرحباً بك في {server}. اقرأ القوانين واستمتع بوقتك.",
    goodbyeEnabled: false,
    goodbyeChannelId: null,
    goodbyeMessage: "غادر {username} السيرفر.",
  },
  selfRoles: { enabled: false, panels: [] },
  leveling: {
    enabled: false,
    xpMin: 15,
    xpMax: 25,
    cooldownSeconds: 60,
    announce: "current",
    announceChannelId: null,
    announceMessage: "مبروك {user}! وصلت للمستوى **{level}**.",
    rewards: [],
    stackRewards: true,
    ignoredChannelIds: [],
    noXpRoleIds: [],
  },
  suggestions: {
    enabled: false,
    channelId: null,
    reviewerRoleIds: [],
    allowAnonymous: false,
    createThreads: true,
  },
  giveaways: { enabled: false, managerRoleIds: [], defaultChannelId: null },
  delegation: { enabled: false, logChannelId: null, grants: [] },
  backups: { autoBackupHours: 24, retain: 10 },
  lockdown: {
    exemptChannelIds: [],
    announce: true,
    message: "🔒 السيرفر في وضع القفل المؤقت لحماية المجتمع. سنعود قريباً.",
  },
  analytics: { enabled: true },
};

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge `value` over `base`. Arrays and primitives from `value` replace the base. */
function deepMerge(base: unknown, value: unknown): unknown {
  if (value === undefined) return base;
  if (isPlainObject(base) && isPlainObject(value)) {
    const result: PlainObject = { ...base };
    for (const key of Object.keys(base)) {
      result[key] = deepMerge(base[key], value[key]);
    }
    return result;
  }
  return value;
}

/**
 * Upgrades any stored document (v1, partial or current) to a valid v2 configuration.
 * Invalid module values fall back to that module's defaults instead of breaking the guild.
 */
export function normalizeGuildSecurityConfig(value: unknown): GuildSecurityConfig {
  const stored = isPlainObject(value) ? value : {};
  const merged = deepMerge(defaultGuildSecurityConfig, stored) as PlainObject;
  merged.version = 2;
  if (merged.mode !== "protect") merged.mode = "observe";
  const full = guildSecurityConfigSchema.safeParse(merged);
  if (full.success) return full.data;

  const repaired: PlainObject = { version: 2, mode: merged.mode };
  for (const key of MODULE_KEYS) {
    const parsed = moduleShape[key].safeParse(merged[key]);
    repaired[key] = parsed.success ? parsed.data : defaultGuildSecurityConfig[key];
  }
  return guildSecurityConfigSchema.parse(repaired);
}

export function mergeGuildSecurityConfig(
  current: GuildSecurityConfig,
  patch: GuildSecurityPatch,
): GuildSecurityConfig {
  const next: PlainObject = { ...current };
  if (patch.mode) next.mode = patch.mode;
  for (const key of MODULE_KEYS) {
    const modulePatch = patch[key];
    if (modulePatch) next[key] = { ...(current[key] as PlainObject), ...(modulePatch as PlainObject) };
  }
  return guildSecurityConfigSchema.parse(next);
}

/** Roles with any of these permissions are never handed out by self-roles, welcome, delegation or verification. */
export const DANGEROUS_PERMISSION_NAMES = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageWebhooks",
  "BanMembers",
  "KickMembers",
  "ModerateMembers",
  "ManageMessages",
  "MentionEveryone",
  "ManageNicknames",
  "ManageGuildExpressions",
  "ManageEvents",
  "ManageThreads",
  "ViewAuditLog",
] as const;
