import { PermissionFlagsBits } from "discord.js";
import type { Express } from "express";
import { z } from "zod";
import { applyNativeAutoModRules } from "../automod";
import { recordEvent } from "../core/context";
import { ApiError, guildMutation, loadGuildConfig, requireBotGuild } from "./common";

export const automodApplyRequestSchema = z.object({ confirm: z.literal("APPLY_AUTOMOD") }).strict();

function safeSyncErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name);
    if (name === "AutoModRuleConflict") return "rule_name_conflict";
    if (name === "DiscordAPIError" || name === "DiscordjsError") return "discord_api_error";
  }
  return "sync_failed";
}

export function registerAutoModApi(app: Express): void {
  guildMutation(app, "post", "/automod/apply", async ({ guild: summary, session }, req, res) => {
    const parsed = automodApplyRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "automod_confirmation_required");

    const guild = requireBotGuild(summary.id);
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      throw new ApiError(403, "bot_manage_guild_permission_required");
    }

    const config = await loadGuildConfig(summary.id);
    if (!config.autoMod.enabled) throw new ApiError(409, "automod_not_enabled_in_settings");

    const auditSaved = await recordEvent({
      guildId: summary.id,
      eventType: "automod:rules_apply_requested",
      actorId: session.user.id,
      severity: "medium",
      details: {
        blockInvites: config.autoMod.blockInvites,
        blockMentionSpam: config.autoMod.blockMentionSpam,
        blockedKeywordCount: config.autoMod.blockedKeywords.length,
      },
    });
    if (!auditSaved) throw new ApiError(503, "audit_store_unavailable");

    try {
      const changes = await applyNativeAutoModRules(guild, config);
      const resultSaved = await recordEvent({
        guildId: summary.id,
        eventType: "automod:rules_synced",
        actorId: session.user.id,
        severity: "low",
        details: {
          created: changes.filter((change) => change.action === "created").length,
          updated: changes.filter((change) => change.action === "updated").length,
          disabled: changes.filter((change) => change.action === "disabled").length,
        },
      });
      if (!resultSaved) throw new ApiError(503, "audit_result_unavailable_discord_may_have_changed");
      res.json({
        ok: true,
        changes,
        note: "تمت مزامنة قواعد Systemix المملوكة للتطبيق فقط؛ لم تُعدّل أي قاعدة يملكها شخص آخر.",
      });
    } catch (error) {
      await recordEvent({
        guildId: summary.id,
        eventType: "automod:rules_sync_failed",
        actorId: session.user.id,
        severity: "high",
        details: { code: safeSyncErrorCode(error) },
      });
      throw error;
    }
  });
}
