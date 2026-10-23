import { z } from "zod";
import type { Express } from "express";
import { ApiError, guildGet, guildMutation, loadGuildConfig, requireBotGuild } from "./common";
import { buildLockdownPlan, activateLockdown, deactivateLockdown, getCurrentLockdownState } from "../modules/lockdown";

const lockdownMutationSchema = z.object({
  action: z.enum(["start", "end"]),
  reason: z.string().trim().min(3).max(300),
  durationMinutes: z.number().int().min(1).max(1_440).optional(),
  confirmation: z.string().optional(),
}).strict();

export function registerSecurityApi(app: Express): void {
  guildGet(app, "/lockdown", async (ctx, _req, res) => {
    res.json({ state: await getCurrentLockdownState(ctx.guild.id) });
  });

  guildGet(app, "/lockdown/plan", async (ctx, _req, res) => {
    const guild = requireBotGuild(ctx.guild.id);
    const config = await loadGuildConfig(ctx.guild.id);
    const state = await getCurrentLockdownState(ctx.guild.id);
    res.json({ plan: { ...buildLockdownPlan(guild, config), active: state.active } });
  });

  guildMutation(app, "post", "/lockdown", async (ctx, req, res) => {
    const parsed = lockdownMutationSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "invalid_lockdown_request");
    const expected = parsed.data.action === "start" ? "LOCKDOWN" : "UNLOCK";
    if (parsed.data.confirmation !== expected) throw new ApiError(400, "lockdown_confirmation_required");
    const guild = requireBotGuild(ctx.guild.id);
    const config = await loadGuildConfig(ctx.guild.id);
    const result = parsed.data.action === "start"
      ? await activateLockdown(guild, config, {
          actorId: ctx.session.user.id,
          reason: parsed.data.reason,
          trigger: "dashboard",
          ...(parsed.data.durationMinutes ? { durationMinutes: parsed.data.durationMinutes } : {}),
        })
      : await deactivateLockdown(guild, { actorId: ctx.session.user.id, reason: parsed.data.reason });
    res.status(result.ok ? 200 : 409).json(result);
  });
}
