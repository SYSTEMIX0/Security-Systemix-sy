import { PermissionFlagsBits } from "discord.js";
import type { Express, Request, Response, NextFunction } from "express";
import * as db from "../db";
import { applyNativeAutoModRules, AutoModRuleConflict } from "./automod";
import { getDiscordBotState, getDiscordClient } from "./bot";
import {
  defaultGuildSecurityConfig,
  guildSecurityPatchSchema,
  mergeGuildSecurityConfig,
  normalizeGuildSecurityConfig,
  snowflakeSchema,
} from "./config";
import {
  DiscordHttpError,
  discordClientId,
  discordClientSecret,
  discordRedirectUri,
  getActiveDiscordSession,
  listManagedDiscordGuilds,
  registerDiscordOAuthRoutes,
  requireManagedDiscordGuild,
  type DiscordGuildSummary,
} from "./oauth";
import {
  clearCsrfCookie,
  clearDiscordSessionCookie,
  createCsrfToken,
  DISCORD_CSRF_COOKIE,
  DISCORD_SESSION_COOKIE,
  decryptSession,
  readCookies,
  safeTokenEquals,
  setCsrfCookie,
} from "./session";

const WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 30;
const MAX_WRITE_BUCKETS = 5_000;
const writeCounts = new Map<string, { start: number; count: number }>();
let lastWriteSweepAt = 0;

function apiError(res: Response, error: unknown): void {
  if (error instanceof DiscordHttpError) {
    if (error.status === 401) {
      res.status(401).json({ error: "discord_session_expired" });
      return;
    }
    if (error.status === 403) {
      res.status(403).json({ error: "discord_manage_server_required" });
      return;
    }
    if (error.status === 429) {
      res.status(429).json({ error: "discord_rate_limited" });
      return;
    }
    res.status(error.status === 503 ? 503 : 502).json({ error: "discord_api_unavailable" });
    return;
  }
  if (error instanceof AutoModRuleConflict) {
    res.status(409).json({ error: "automod_rule_name_conflict" });
    return;
  }
  console.error("[Discord API] Request failed", error instanceof Error ? error.name : "unknown");
  res.status(500).json({ error: "systemix_request_failed" });
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:") {
      return url.origin === new URL(discordRedirectUri()).origin;
    }
    return process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function rateLimitKey(req: Request): string {
  const session = decryptSession(readCookies(req)[DISCORD_SESSION_COOKIE]);
  if (session) return `discord-user:${session.user.id}`;
  return `socket:${req.socket.remoteAddress ?? "unknown"}`;
}

function pruneWriteCounts(now: number): void {
  if (now - lastWriteSweepAt < 10_000 && writeCounts.size < MAX_WRITE_BUCKETS) return;
  lastWriteSweepAt = now;
  for (const [key, bucket] of writeCounts) {
    if (now - bucket.start >= WINDOW_MS) writeCounts.delete(key);
  }
  while (writeCounts.size >= MAX_WRITE_BUCKETS) {
    const oldestKey = writeCounts.keys().next().value;
    if (oldestKey === undefined) break;
    writeCounts.delete(oldestKey);
  }
}

function allowWrite(req: Request): boolean {
  const now = Date.now();
  pruneWriteCounts(now);
  const key = rateLimitKey(req);
  const current = writeCounts.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    writeCounts.set(key, { start: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_WRITES_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function validateMutation(req: Request, res: Response): boolean {
  if (!allowedOrigin(req.get("origin"))) {
    res.status(403).json({ error: "origin_not_allowed" });
    return false;
  }
  const cookieToken = readCookies(req)[DISCORD_CSRF_COOKIE];
  const headerToken = req.get("x-systemix-csrf");
  if (!safeTokenEquals(cookieToken, headerToken)) {
    res.status(403).json({ error: "csrf_validation_failed" });
    return false;
  }
  if (!allowWrite(req)) {
    res.status(429).json({ error: "systemix_rate_limited" });
    return false;
  }
  return true;
}

async function getSessionOrReply(req: Request, res: Response) {
  const session = await getActiveDiscordSession(req, res);
  if (!session) {
    res.status(401).json({ error: "discord_login_required" });
    return null;
  }
  return session;
}

async function authorizeGuild(
  req: Request,
  res: Response,
  guildId: string,
): Promise<{ session: NonNullable<Awaited<ReturnType<typeof getActiveDiscordSession>>>; guild: DiscordGuildSummary } | null> {
  if (!snowflakeSchema.safeParse(guildId).success) {
    res.status(400).json({ error: "invalid_guild_id" });
    return null;
  }
  const session = await getSessionOrReply(req, res);
  if (!session) return null;
  const guild = await requireManagedDiscordGuild(session, guildId);
  return { session, guild };
}

function noStore(res: Response): void {
  res.set("Cache-Control", "no-store");
}

export function registerDiscordRoutes(app: Express): void {
  app.use("/api/discord", (_req, res, next) => {
    noStore(res);
    next();
  });
  registerDiscordOAuthRoutes(app);

  app.get("/api/discord/status", (_req, res) => {
    res.json({
      oauthConfigured: Boolean(discordClientSecret()),
      bot: getDiscordBotState(),
    });
  });

  app.get("/api/discord/csrf", (_req, res) => {
    const token = createCsrfToken();
    setCsrfCookie(res, token);
    res.json({ token });
  });

  app.get("/api/discord/me", asyncRoute(async (req, res) => {
    try {
      const session = await getActiveDiscordSession(req, res);
      if (!session) {
        res.json({ user: null, guilds: [], bot: getDiscordBotState(), oauthConfigured: Boolean(discordClientSecret()) });
        return;
      }
      const managedGuilds = await listManagedDiscordGuilds(session);
      const botClient = getDiscordClient();
      res.json({
        user: { id: session.user.id, username: session.user.username, avatar: session.user.avatar },
        guilds: managedGuilds.map((guild) => ({
          id: guild.id,
          name: guild.name,
          icon: guild.icon,
          owner: guild.owner,
          botInstalled: Boolean(botClient?.guilds.cache.has(guild.id)),
        })),
        bot: getDiscordBotState(),
        oauthConfigured: Boolean(discordClientSecret()),
      });
    } catch (error) {
      apiError(res, error);
    }
  }));

  app.post("/api/discord/logout", asyncRoute(async (req, res) => {
    if (!validateMutation(req, res)) return;
    clearDiscordSessionCookie(res);
    clearCsrfCookie(res);
    res.json({ ok: true });
  }));

  app.get("/api/discord/guilds/:guildId/invite", asyncRoute(async (req, res) => {
    try {
      const result = await authorizeGuild(req, res, req.params.guildId);
      if (!result) return;
      const params = new URLSearchParams({
        client_id: discordClientId(),
        scope: "bot applications.commands",
        permissions: "3232",
        guild_id: result.guild.id,
        disable_guild_select: "true",
      });
      res.json({
        url: `https://discord.com/oauth2/authorize?${params.toString()}`,
        permissions: ["VIEW_AUDIT_LOG", "MANAGE_GUILD", "VIEW_CHANNEL", "SEND_MESSAGES"],
        administratorRequested: false,
      });
    } catch (error) {
      apiError(res, error);
    }
  }));

  app.get("/api/discord/guilds/:guildId/settings", asyncRoute(async (req, res) => {
    try {
      const result = await authorizeGuild(req, res, req.params.guildId);
      if (!result) return;
      const row = await db.getGuildSecuritySettings(result.guild.id);
      const config = normalizeGuildSecurityConfig(row?.settings ?? defaultGuildSecurityConfig);
      const botClient = getDiscordClient();
      const botGuild = botClient?.guilds.cache.get(result.guild.id);
      res.json({
        settings: config,
        botInstalled: Boolean(botGuild),
        botOnline: getDiscordBotState().status === "ready",
        permissions: {
          viewAuditLog: Boolean(botGuild?.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)),
          manageGuild: Boolean(botGuild?.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)),
          manageRoles: Boolean(botGuild?.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)),
          moderateMembers: Boolean(botGuild?.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers)),
        },
        memberIntentEnabled: getDiscordBotState().memberIntentEnabled,
      });
    } catch (error) {
      apiError(res, error);
    }
  }));

  app.put("/api/discord/guilds/:guildId/settings", asyncRoute(async (req, res) => {
    if (!validateMutation(req, res)) return;
    try {
      const result = await authorizeGuild(req, res, req.params.guildId);
      if (!result) return;
      const patchResult = guildSecurityPatchSchema.safeParse(req.body);
      if (!patchResult.success) {
        res.status(400).json({ error: "invalid_settings", details: patchResult.error.issues.map((issue) => issue.path.join(".")) });
        return;
      }
      const row = await db.getGuildSecuritySettings(result.guild.id);
      const current = normalizeGuildSecurityConfig(row?.settings ?? defaultGuildSecurityConfig);
      const settings = mergeGuildSecurityConfig(current, patchResult.data);
      await db.upsertGuildSecuritySettings(result.guild.id, result.session.user.id, settings);
      res.json({ ok: true, settings, mode: "observe" });
    } catch (error) {
      apiError(res, error);
    }
  }));

  app.get("/api/discord/guilds/:guildId/events", asyncRoute(async (req, res) => {
    try {
      const result = await authorizeGuild(req, res, req.params.guildId);
      if (!result) return;
      const requested = Number(req.query.limit ?? 50);
      const limit = Number.isInteger(requested) ? Math.max(1, Math.min(100, requested)) : 50;
      const events = await db.listSecurityEvents(result.guild.id, limit);
      res.json({ events });
    } catch (error) {
      apiError(res, error);
    }
  }));

  app.post("/api/discord/guilds/:guildId/automod/apply", asyncRoute(async (req, res) => {
    if (!validateMutation(req, res)) return;
    if (req.body?.confirm !== "APPLY_AUTOMOD") {
      res.status(400).json({ error: "explicit_confirmation_required" });
      return;
    }
    try {
      const result = await authorizeGuild(req, res, req.params.guildId);
      if (!result) return;
      const botClient = getDiscordClient();
      const guild = botClient?.guilds.cache.get(result.guild.id);
      if (!botClient || getDiscordBotState().status !== "ready") {
        res.status(409).json({ error: "bot_not_ready" });
        return;
      }
      if (!guild) {
        res.status(409).json({ error: "bot_not_installed" });
        return;
      }
      if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        res.status(403).json({ error: "bot_manage_guild_permission_required" });
        return;
      }
      const row = await db.getGuildSecuritySettings(result.guild.id);
      const settings = normalizeGuildSecurityConfig(row?.settings ?? defaultGuildSecurityConfig);
      const changes = await applyNativeAutoModRules(guild, settings);
      await db.recordSecurityEvent({
        guildId: guild.id,
        eventType: "automod:rules_synced",
        actorId: result.session.user.id,
        severity: "medium",
        details: { ruleNames: changes.map((change) => change.name), actions: changes.map((change) => change.action), count: changes.length },
      });
      res.json({
        ok: true,
        changes,
        note: settings.autoMod.enabled
          ? "تمت مزامنة قواعد Discord الأصلية؛ راجع AutoMod في Discord للتحقق من الاستثناءات."
          : "تم تعطيل قواعد Systemix التي يملكها البوت فقط؛ لم نعدّل قواعد أنشأها أشخاص آخرون.",
      });
    } catch (error) {
      apiError(res, error);
    }
  }));
}
