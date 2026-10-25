import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import * as db from "../../db";
import { ENV } from "../../_core/env";
import { asyncRoute, validateMutation } from "./common";
import { getDiscordBotState, getDiscordClient } from "../bot";
import { provisionLogsForGuild } from "../modules/logging";
import { provisionTicketsForGuild } from "../modules/tickets";
import { discordClientSecret, getActiveDiscordSession } from "../oauth";
import {
  clearOwnerCookie, createOwnerCookie, isOwnerEligible, isOwnerPasswordConfigured,
  ownerCookieFromRequest, parseOwnerIds, setOwnerCookie, verifyOwnerCookie, verifyOwnerPassword,
} from "../owner-auth";

const WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_ATTEMPTS = 8;
const MAX_BUCKETS = 5_000;
const attempts = new Map<string, { start: number; count: number }>();
function attemptKey(req: Request, userId?: string): string {
  // Render may place many visitors behind the same socket-facing proxy. Rate-limit
  // authenticated attempts by Discord identity; use the remote address only pre-login.
  const identity = userId ? `discord:${userId}` : `remote:${req.socket.remoteAddress ?? "unknown"}`;
  return createHash("sha256").update(identity).digest("hex");
}
function allowLoginAttempt(req: Request, userId?: string): boolean {
  const now = Date.now();
  for (const [key, bucket] of attempts) if (now - bucket.start >= WINDOW_MS) attempts.delete(key);
  while (attempts.size >= MAX_BUCKETS) attempts.delete(attempts.keys().next().value!);
  const key = attemptKey(req, userId);
  const bucket = attempts.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return true;
  }
  if (bucket.count >= MAX_LOGIN_ATTEMPTS) return false;
  bucket.count += 1;
  return true;
}
function ownerConfigured(): boolean {
  return isOwnerPasswordConfigured() && parseOwnerIds() !== null && Boolean(ENV.cookieSecret);
}
function ownerAuthenticated(userId: string | undefined, cookie: string | undefined): boolean {
  return Boolean(userId && isOwnerEligible(userId) && verifyOwnerCookie(cookie, userId));
}

async function requireOwnerSession(req: Request, res: Response) {
  let session;
  try { session = await getActiveDiscordSession(req, res); } catch { session = null; }
  if (!session || !ownerConfigured() || !ownerAuthenticated(session.user.id, ownerCookieFromRequest(req))) {
    res.status(401).json({ error: "owner_auth_required" });
    return null;
  }
  return session;
}

const snowflakeInput = z.string().regex(/^\d{17,20}$/);
const subscriptionMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["activate", "renew"]),
    guildId: snowflakeInput,
    plan: z.enum(["monthly", "annual"]),
    note: z.string().trim().max(300).optional(),
    confirmation: z.literal("RENEW_SUBSCRIPTION"),
  }).strict(),
  z.object({
    action: z.literal("suspend"),
    guildId: snowflakeInput,
    note: z.string().trim().max(300).optional(),
    confirmation: z.literal("SUSPEND_SUBSCRIPTION"),
  }).strict(),
]);

const guildProvisionSchema = z.object({
  guildId: snowflakeInput,
  kind: z.enum(["logs", "tickets"]),
  confirmation: z.literal("PROVISION_GUILD_CHANNELS"),
}).strict();

export function registerOwnerApi(app: Express): void {
  app.use("/api/owner", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/owner/status", asyncRoute(async (req, res) => {
    let userId: string | undefined;
    try { userId = (await getActiveDiscordSession(req, res))?.user.id; } catch { userId = undefined; }
    res.json({
      configured: ownerConfigured(),
      authenticated: ownerConfigured() && ownerAuthenticated(userId, ownerCookieFromRequest(req)),
      userId: userId ?? null,
      eligible: isOwnerEligible(userId),
    });
  }));
  app.post("/api/owner/login", asyncRoute(async (req, res) => {
    if (!validateMutation(req, res)) return;
    let session;
    try { session = await getActiveDiscordSession(req, res); } catch { session = null; }
    if (!allowLoginAttempt(req, session?.user.id)) { res.status(429).json({ error: "owner_auth_failed" }); return; }
    const password = typeof req.body?.password === "string" && req.body.password.length <= 128 ? req.body.password : "";
    const eligible = isOwnerEligible(session?.user.id);
    // Always perform the same password verification for structurally valid input;
    // otherwise timing can disclose whether a Discord account is on the allowlist.
    const validPassword = await verifyOwnerPassword(password);
    // Do not reveal whether any individual credential was correct.
    if (!session || !eligible || !validPassword || !ownerConfigured()) {
      res.status(401).json({ error: "owner_auth_failed" });
      return;
    }
    const cookie = createOwnerCookie(session.user.id);
    if (!cookie) { res.status(503).json({ error: "owner_auth_failed" }); return; }
    setOwnerCookie(res, cookie);
    res.json({ authenticated: true });
  }));
  app.post("/api/owner/logout", (_req, res) => {
    if (!validateMutation(_req, res)) return;
    clearOwnerCookie(res);
    res.json({ ok: true });
  });
  app.get("/api/owner/overview", asyncRoute(async (req, res) => {
    const session = await requireOwnerSession(req, res);
    if (!session) return;
    const bot = getDiscordBotState();
    res.json({
      bot: { status: bot.status },
      readiness: {
        oauthConfigured: Boolean(discordClientSecret()),
        sessionKeyConfigured: Boolean(ENV.cookieSecret),
        ownerPasswordConfigured: isOwnerPasswordConfigured(),
        ownerAllowlistConfigured: parseOwnerIds() !== null,
      },
    });
  }));
  app.get("/api/owner/guilds", asyncRoute(async (req, res) => {
    const session = await requireOwnerSession(req, res);
    if (!session) return;
    const client = getDiscordClient();
    if (!client || getDiscordBotState().status !== "ready") {
      res.status(409).json({ error: "owner_guild_provision_unavailable" });
      return;
    }
    // This endpoint is owner-only. It derives candidates from the active bot
    // connection rather than an OAuth guild list that can be stale after an invite.
    const guilds = [...client.guilds.cache.values()]
      .map((guild) => ({ id: guild.id, name: guild.name }))
      .sort((left, right) => left.name.localeCompare(right.name, "ar"));
    res.json({ guilds });
  }));
  app.get("/api/owner/subscriptions", asyncRoute(async (req, res) => {
    const session = await requireOwnerSession(req, res);
    if (!session) return;
    try {
      const subscriptions = await db.listGuildSubscriptions();
      res.json({ subscriptions });
    } catch {
      res.status(503).json({ error: "owner_subscription_unavailable" });
    }
  }));
  app.post("/api/owner/subscriptions", asyncRoute(async (req, res) => {
    if (!validateMutation(req, res)) return;
    const session = await requireOwnerSession(req, res);
    if (!session) return;
    const parsed = subscriptionMutationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "owner_subscription_invalid" });
      return;
    }
    const client = getDiscordClient();
    if (!client || getDiscordBotState().status !== "ready" || !client.guilds.cache.has(parsed.data.guildId)) {
      res.status(409).json({ error: "owner_subscription_guild_unavailable" });
      return;
    }
    try {
      const subscription = parsed.data.action === "suspend"
        ? await db.suspendGuildSubscription({ guildId: parsed.data.guildId, note: parsed.data.note, actedByDiscordId: session.user.id })
        : await db.renewGuildSubscription({ guildId: parsed.data.guildId, plan: parsed.data.plan, note: parsed.data.note, actedByDiscordId: session.user.id });
      res.json({ ok: true, subscription });
    } catch (error) {
      if (error instanceof Error && error.message === "subscription_not_found") {
        res.status(404).json({ error: "owner_subscription_not_found" });
        return;
      }
      // Includes failure to persist the audit precondition; fail closed and do not claim activation.
      res.status(503).json({ error: "owner_subscription_write_blocked" });
    }
  }));
  app.post("/api/owner/guild-provision", asyncRoute(async (req, res) => {
    if (!validateMutation(req, res)) return;
    const session = await requireOwnerSession(req, res);
    if (!session) return;
    const parsed = guildProvisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "owner_guild_provision_invalid" });
      return;
    }
    const client = getDiscordClient();
    const guild = client?.guilds.cache.get(parsed.data.guildId);
    if (!client || getDiscordBotState().status !== "ready" || !guild) {
      res.status(409).json({ error: "owner_guild_provision_unavailable" });
      return;
    }
    try {
      const result = parsed.data.kind === "logs"
        ? await provisionLogsForGuild(guild, session.user.id)
        : await provisionTicketsForGuild(guild, session.user.id);
      res.json({ ok: true, kind: parsed.data.kind, result });
    } catch (error) {
      // The provisioning helpers audit first, clean up newly created Discord resources on failure,
      // and intentionally avoid reporting provider details to a browser response.
      const code = error instanceof Error ? error.message : "unknown";
      if (code.startsWith("bot_missing_")) {
        res.status(409).json({ error: "owner_guild_provision_bot_permissions" });
        return;
      }
      res.status(503).json({ error: "owner_guild_provision_blocked" });
    }
  }));
}
/** Small test-only reset hook for isolated rate-limit tests. */
export function resetOwnerLoginAttemptsForTests(): void { attempts.clear(); }
