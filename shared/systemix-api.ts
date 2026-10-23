/**
 * Security Systemix — shared dashboard API contract.
 *
 * Every endpoint lives under `/api/discord/guilds/:guildId/...`, requires a Discord dashboard
 * session whose user can manage the guild, and mutations require the `x-systemix-csrf` header.
 * Errors are `{ error: string }` with a stable snake_case code.
 */

export type ChannelKind = "text" | "voice" | "category" | "announcement" | "forum" | "stage" | "other";

export type ChannelInfo = {
  id: string;
  name: string;
  type: ChannelKind;
  parentId: string | null;
  position: number;
};

export type RoleInfo = {
  id: string;
  name: string;
  /** Hex color like "#5865F2"; "#000000" means no color. */
  color: string;
  position: number;
  managed: boolean;
  /** Holds at least one permission from DANGEROUS_PERMISSION_NAMES. */
  dangerous: boolean;
  /** Bot can hand this role out: below the bot's highest role, not managed, not @everyone. */
  assignable: boolean;
};

export type GuildMeta = {
  guild: { id: string; name: string; icon: string | null; memberCount: number; ownerId: string };
  channels: ChannelInfo[];
  roles: RoleInfo[];
  bot: { id: string; highestRolePosition: number; permissions: string[] };
  intents: { members: boolean; messageContent: boolean };
};

export type ResolvedUser = { id: string; username: string; displayName: string; avatarUrl: string | null; bot: boolean };

export type ThreatLevel = "calm" | "elevated" | "high" | "critical";

export type ThreatScore = {
  /** 0 = calm, 100 = active attack. */
  score: number;
  level: ThreatLevel;
  factors: { key: string; label: string; weight: number; detail: string }[];
  computedAt: string;
};

export type DailyStat = {
  day: string;
  joins: number;
  leaves: number;
  messages: number;
  modActions: number;
  threats: number;
  autoActions: number;
};

export type LockdownState = {
  active: boolean;
  reason: string | null;
  startedById: string | null;
  trigger: "manual" | "anti_nuke" | "anti_raid" | "dashboard";
  channelCount: number;
  startedAt: string | null;
  endsAt: string | null;
};

export type LockdownPlan = {
  channels: { id: string; name: string }[];
  exempt: { id: string; name: string }[];
  /** Bot lacks Manage Channels / Manage Roles in at least one target channel. */
  missingPermission: boolean;
};

export type BackupSummary = {
  id: number;
  kind: "manual" | "auto" | "pre_incident";
  label: string;
  roleCount: number;
  channelCount: number;
  createdById: string;
  createdAt: string;
};

export type RestorePlan = {
  backupId: number;
  rolesToCreate: { name: string; color: string }[];
  channelsToCreate: { name: string; type: ChannelKind; parentName: string | null }[];
  overwritesToRestore: number;
  warnings: string[];
};

export type RestoreResult = {
  createdRoles: number;
  createdChannels: number;
  restoredOverwrites: number;
  failures: string[];
};

export type DriftReport = {
  baseline: BackupSummary | null;
  deletedRoles: { id: string; name: string }[];
  newRoles: { id: string; name: string }[];
  deletedChannels: { id: string; name: string }[];
  newChannels: { id: string; name: string }[];
  permissionEscalations: { roleId: string; roleName: string; added: string[] }[];
  generatedAt: string;
};

export type DoctorCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix: string | null;
};

export type DoctorReport = { score: number; checks: DoctorCheck[]; generatedAt: string };

export type ModCaseSource = "manual" | "auto" | "delegation" | "dashboard";

export type ModCase = {
  id: number;
  caseNumber: number;
  type: string;
  targetId: string | null;
  moderatorId: string;
  reason: string | null;
  durationSeconds: number | null;
  active: boolean;
  source: ModCaseSource;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type DashboardModerationInput = {
  type: "warn" | "timeout" | "untimeout" | "kick" | "ban" | "unban" | "note";
  targetId: string;
  reason: string;
  /** Required for timeout (1..40320). Ignored otherwise. */
  durationMinutes?: number;
};

export type TicketStatus = "open" | "claimed" | "closed";

export type TicketSummary = {
  id: number;
  ticketNumber: number;
  channelId: string | null;
  openerId: string;
  topic: string;
  status: TicketStatus;
  claimedById: string | null;
  messageCount: number;
  createdAt: string;
  closedAt: string | null;
};

export type TranscriptMessage = {
  authorId: string;
  authorName: string;
  bot: boolean;
  content: string;
  attachments: string[];
  createdAt: string;
};

export type TicketDetail = TicketSummary & {
  closedById: string | null;
  closeReason: string | null;
  transcript: TranscriptMessage[];
};

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  xp: number;
  level: number;
  messages: number;
  /** Progress toward the next level, 0..1. */
  progress: number;
};

export type SuggestionSummary = {
  id: number;
  number: number;
  authorId: string | null;
  content: string;
  status: "pending" | "approved" | "rejected" | "implemented";
  upvotes: number;
  downvotes: number;
  reviewNote: string | null;
  createdAt: string;
};

export type GiveawaySummary = {
  id: number;
  prize: string;
  channelId: string;
  winnerCount: number;
  status: "running" | "ended" | "cancelled";
  endsAt: string;
  entrants: number;
  winners: string[];
  createdAt: string;
};

export type GuildOverview = {
  threat: ThreatScore;
  stats: DailyStat[];
  totals: {
    cases7d: number;
    autoActions7d: number;
    openTickets: number;
    activeWarnings: number;
    backups: number;
    trackedMembers: number;
  };
  lockdown: LockdownState;
  lastBackup: BackupSummary | null;
  modules: { key: string; enabled: boolean }[];
  mode: "observe" | "protect";
};

export type PanelPublishResult = { ok: true; channelId: string; messageId: string };

/** Arabic labels for mod-case types, shared by bot embeds and the dashboard. */
export const CASE_TYPE_LABELS: Record<string, string> = {
  warn: "تحذير",
  timeout: "إسكات مؤقت",
  untimeout: "فك الإسكات",
  kick: "طرد",
  ban: "حظر",
  unban: "فك الحظر",
  softban: "حظر تنظيفي",
  purge: "حذف رسائل",
  lock: "قفل قناة",
  unlock: "فتح قناة",
  slowmode: "وضع بطيء",
  note: "ملاحظة",
  nickname: "تعديل اللقب",
  role_add: "إضافة رتبة",
  role_remove: "إزالة رتبة",
  strip_roles: "تجريد الرتب",
  antinuke: "Anti-Nuke",
  antiraid: "Anti-Raid",
  antispam: "Anti-Spam",
  honeypot: "المصيدة",
  lockdown: "قفل السيرفر",
  unlockdown: "إنهاء القفل",
  verification: "تحقق",
  unwarn: "إلغاء تحذير",
};

/**
 * Endpoint list (relative to /api/discord/guilds/:guildId):
 *
 * GET    /meta                       -> GuildMeta
 * GET    /settings                   -> { settings, botInstalled, botOnline, permissions, memberIntentEnabled }
 * PUT    /settings      (patch)      -> { ok: true, settings }
 * GET    /overview                   -> GuildOverview
 * GET    /events?limit=              -> { events }
 * GET    /users?ids=a,b              -> { users: ResolvedUser[] }        (max 50 ids)
 * GET    /cases?limit=&before=&targetId=&type=&source= -> { cases: ModCase[] }
 * POST   /moderation (DashboardModerationInput) -> { ok: true, case: ModCase }
 * GET    /lockdown                   -> LockdownState
 * GET    /lockdown/plan              -> LockdownPlan
 * POST   /lockdown {action:"start"|"end", reason, durationMinutes?} -> LockdownState
 * GET    /backups                    -> { backups: BackupSummary[] }
 * POST   /backups {label?}           -> BackupSummary
 * GET    /backups/:id/plan           -> RestorePlan
 * POST   /backups/:id/restore {confirm:"RESTORE"} -> RestoreResult
 * DELETE /backups/:id                -> { ok: true }
 * GET    /drift                      -> DriftReport
 * GET    /doctor                     -> DoctorReport
 * POST   /automod/apply {confirm:"APPLY_AUTOMOD"} -> { ok, changes, note }
 * POST   /panels/verification        -> PanelPublishResult
 * POST   /panels/tickets             -> PanelPublishResult
 * POST   /panels/selfroles/:panelId  -> PanelPublishResult
 * GET    /tickets?status=            -> { tickets: TicketSummary[] }
 * GET    /tickets/:id                -> TicketDetail
 * GET    /leaderboard?limit=         -> { entries: LeaderboardEntry[] }
 * GET    /suggestions?status=        -> { suggestions: SuggestionSummary[] }
 * GET    /giveaways                  -> { giveaways: GiveawaySummary[] }
 */
export const SYSTEMIX_API_VERSION = 2;
