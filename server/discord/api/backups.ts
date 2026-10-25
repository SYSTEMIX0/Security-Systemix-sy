import { z } from "zod";
import type { Express } from "express";
import * as db from "../../db";
import { createGuildBackup } from "../modules/backups";
import { listGuildBackups } from "../store/backups";
import { ApiError, guildGet, guildMutation, requireBotGuild } from "./common";
import { runWithAuditPrecondition } from "./settings-confirmation";

const backupRequestSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
}).strict();

function backupSummary(row: Awaited<ReturnType<typeof listGuildBackups>>[number]) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    roleCount: row.roleCount,
    channelCount: row.channelCount,
    createdAt: row.createdAt,
  };
}

/**
 * Structural backups deliberately contain channels, roles and permission overwrites only.
 * No message content, members, payment details or access tokens are stored or returned.
 */
export function registerBackupsApi(app: Express): void {
  guildGet(app, "/backups", async ({ guild }, _req, res) => {
    const backups = await listGuildBackups(guild.id, 30);
    res.json({ backups: backups.map(backupSummary) });
  });

  guildMutation(app, "post", "/backups", async ({ guild: summary, session }, req, res) => {
    const parsed = backupRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "invalid_backup_request");

    const guild = requireBotGuild(summary.id);
    const label = parsed.data.label || "نسخة يدوية";
    const outcome = await runWithAuditPrecondition(
      () => db.recordSecurityEvent({
        guildId: summary.id,
        eventType: "dashboard:backup_precondition",
        actorId: session.user.id,
        severity: "medium",
        details: { action: "create_structural_backup", label },
      }),
      () => createGuildBackup(guild, session.user.id, "manual", label),
    );
    if (!outcome.ok) throw new ApiError(503, "audit_precondition_failed");
    if (!outcome.value) throw new ApiError(503, "backup_creation_failed");

    res.status(201).json({ ok: true, backup: backupSummary(outcome.value) });
  });
}
