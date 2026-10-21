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

export function safeDiscordErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return `discord_http_${status}`;
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (/^[A-Z0-9_]{1,40}$/.test(code)) return code.toLowerCase();
  }
  return "discord_operation_failed";
}
