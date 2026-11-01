import { AuditLogEvent } from "discord.js";

export const monitoredAuditActionNames = new Map<number, string>([
  [AuditLogEvent.ChannelCreate, "channel_create"],
  [AuditLogEvent.ChannelDelete, "channel_delete"],
  [AuditLogEvent.ChannelUpdate, "channel_update"],
  [AuditLogEvent.RoleCreate, "role_create"],
  [AuditLogEvent.RoleDelete, "role_delete"],
  [AuditLogEvent.RoleUpdate, "role_update"],
  [AuditLogEvent.MemberKick, "member_kick"],
  [AuditLogEvent.MemberBanAdd, "member_ban"],
  [AuditLogEvent.MemberPrune, "member_prune"],
  [AuditLogEvent.MemberRoleUpdate, "member_role_update"],
  [AuditLogEvent.WebhookCreate, "webhook_create"],
  [AuditLogEvent.WebhookUpdate, "webhook_update"],
  [AuditLogEvent.WebhookDelete, "webhook_delete"],
  [AuditLogEvent.BotAdd, "bot_add"],
  [AuditLogEvent.MessageBulkDelete, "message_bulk_delete"],
  [AuditLogEvent.GuildUpdate, "guild_update"],
  [AuditLogEvent.EmojiDelete, "emoji_delete"],
]);

export type RaidSignalInput = {
  accountAgeMs: number;
  accountAgeThresholdMs: number;
  joinsInWindow: number;
  joinThreshold: number;
};

export function evaluateRaidSignals(input: RaidSignalInput): {
  suspicious: boolean;
  signals: string[];
} {
  const signals: string[] = [];
  if (input.accountAgeMs >= 0 && input.accountAgeMs < input.accountAgeThresholdMs) {
    signals.push("new_account");
  }
  if (input.joinsInWindow >= input.joinThreshold) {
    signals.push("join_burst");
  }
  return { suspicious: signals.length > 0, signals };
}

export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

export function matchesDiscordApplicationId(expected: unknown, actual: unknown): boolean {
  return isSnowflake(expected) && isSnowflake(actual) && expected === actual;
}

function safeErrorCodeAtLevel(error: object): string | null {
  const record = error as Record<string, unknown>;
  if ("status" in error) {
    const status = Number(record.status);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return `discord_http_${status}`;
  }
  if ("code" in error) {
    const code = String(record.code);
    if (/^[A-Z0-9_]{1,40}$/.test(code)) return code.toLowerCase();
  }
  return null;
}

/** Returns only validated status/code identifiers; never logs exception messages, stacks, or tokens. */
export function safeDiscordErrorCode(error: unknown): string {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const safeCode = safeErrorCodeAtLevel(current);
    if (safeCode) return safeCode;
    current = "cause" in current ? (current as Record<string, unknown>).cause : undefined;
  }
  return "discord_operation_failed";
}
