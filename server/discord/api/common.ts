import type { Guild } from "discord.js";
import type { Express, NextFunction, Request, Response } from "express";
import * as db from "../../db";
import { AutoModRuleConflict } from "../automod";
import { getDiscordBotState, getDiscordClient } from "../bot";
import { defaultGuildSecurityConfig, normalizeGuildSecurityConfig, snowflakeSchema, type GuildSecurityConfig } from "../config";
import {
  DiscordHttpError,
  discordRedirectUri,
  getActiveDiscordSession,
  requireManagedDiscordGuild,
  type DiscordGuildSummary,
} from "../oauth";
import {
  DISCORD_CSRF_COOKIE,
  DISCORD_SESSION_COOKIE,
  decryptSession,
  readCookies,
  safeTokenEquals,
} from "../session";

/** Throw from any route handler to answer with a stable error code. */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "ApiError";
  }
}

export function apiError(res: Response, error: unknown): void {
  if (res.headersSent) return;
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.code });
    return;
  }
  if (error instanceof DiscordHttpError) {
    if (error.status === 401) return void res.status(401).json({ error: "discord_session_expired" });
    if (error.status === 403) return void res.status(403).json({ error: "discord_manage_server_required" });
    if (error.status === 429) return void res.status(429).json({ error: "discord_rate_limited" });
    res.status(error.status === 503 ? 503 : 502).json({ error: "discord_api_unavailable" });
    return;
  }
  if (error instanceof AutoModRuleConflict) {
    res.status(409).json({ error: "automod_rule_name_conflict" });
    return;
  }
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status: unknown }).status) : 0;
  if (status === 403 || status === 50013) {
    res.status(403).json({ error: "bot_missing_permissions" });
    return;
  }
  if (status === 429) {
    res.status(429).json({ error: "discord_rate_limited" });
    return;
  }
  console.error("[Discord API] Request failed", error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : "unknown");
  res.status(500).json({ error: "systemix_request_failed" });
}

/** Wraps a handler so thrown errors (including ApiError) become JSON responses. */
export function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, _next: NextFunction) => {
    handler(req, res).catch((error) => apiError(res, error));
  };
}

function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:") {
      if (url.origin === new URL(discordRedirectUri()).origin) return true;
      return process.env.NODE_ENV !== "production" && url.hostname.endsWith(".manus.computer");
    }
    return process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

const WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 40;
const MAX_WRITE_BUCKETS = 5_000;
const writeCounts = new Map<string, { start: number; count: number }>();
let lastWriteSweepAt = 0;

function rateLimitKey(req: Request): string {
  const session = decryptSession(readCookies(req)[DISCORD_SESSION_COOKIE]);
  if (session) return `discord-user:${session.user.id}`;
  return `socket:${req.socket.remoteAddress ?? "unknown"}`;
}

function allowWrite(req: Request): boolean {
  const now = Date.now();
  if (now - lastWriteSweepAt >= 10_000 || writeCounts.size >= MAX_WRITE_BUCKETS) {
    lastWriteSweepAt = now;
    for (const [key, bucket] of writeCounts) if (now - bucket.start >= WINDOW_MS) writeCounts.delete(key);
    while (writeCounts.size >= MAX_WRITE_BUCKETS) {
      const oldest = writeCounts.keys().next().value;
      if (oldest === undefined) break;
      writeCounts.delete(oldest);
    }
  }
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

/** Origin + double-submit CSRF + per-user write budget. Replies and returns false when rejected. */
export function validateMutation(req: Request, res: Response): boolean {
  if (!allowedOrigin(req.get("origin"))) {
    res.status(403).json({ error: "origin_not_allowed" });
    return false;
  }
  if (!safeTokenEquals(readCookies(req)[DISCORD_CSRF_COOKIE], req.get("x-systemix-csrf"))) {
    res.status(403).json({ error: "csrf_validation_failed" });
    return false;
  }
  if (!allowWrite(req)) {
    res.status(429).json({ error: "systemix_rate_limited" });
    return false;
  }
  return true;
}

export type DashboardSession = NonNullable<Awaited<ReturnType<typeof getActiveDiscordSession>>>;
export type AuthorizedGuild = { session: DashboardSession; guild: DiscordGuildSummary };

/** Verifies the session user can manage `guildId` (checked against Discord on every request). */
export async function authorizeGuild(req: Request, res: Response, guildId: string): Promise<AuthorizedGuild | null> {
  if (!snowflakeSchema.safeParse(guildId).success) {
    res.status(400).json({ error: "invalid_guild_id" });
    return null;
  }
  const session = await getActiveDiscordSession(req, res);
  if (!session) {
    res.status(401).json({ error: "discord_login_required" });
    return null;
  }
  const guild = await requireManagedDiscordGuild(session, guildId);
  return { session, guild };
}

/** Returns the live discord.js Guild for an authorized guild, or throws 409 when the bot is offline/not installed. */
export function requireBotGuild(guildId: string): Guild {
  const client = getDiscordClient();
  if (!client || getDiscordBotState().status !== "ready") throw new ApiError(409, "bot_not_ready");
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new ApiError(409, "bot_not_installed");
  return guild;
}

export async function loadGuildConfig(guildId: string): Promise<GuildSecurityConfig> {
  const row = await db.getGuildSecuritySettings(guildId);
  return normalizeGuildSecurityConfig(row?.settings ?? defaultGuildSecurityConfig);
}

export function parseLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

export function parsePositiveId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ApiError(400, "invalid_id");
  return parsed;
}

/** Registers a guild-scoped GET route. The handler receives the authorized guild. */
export function guildGet(
  app: Express,
  path: string,
  handler: (ctx: AuthorizedGuild, req: Request, res: Response) => Promise<void>,
): void {
  app.get(`/api/discord/guilds/:guildId${path}`, asyncRoute(async (req, res) => {
    const auth = await authorizeGuild(req, res, String(req.params.guildId));
    if (!auth) return;
    await handler(auth, req, res);
  }));
}

/** Registers a guild-scoped mutation (POST/PUT/DELETE) with Origin, CSRF and write-budget checks. */
export function guildMutation(
  app: Express,
  method: "post" | "put" | "delete",
  path: string,
  handler: (ctx: AuthorizedGuild, req: Request, res: Response) => Promise<void>,
): void {
  app[method](`/api/discord/guilds/:guildId${path}`, asyncRoute(async (req, res) => {
    if (!validateMutation(req, res)) return;
    const auth = await authorizeGuild(req, res, String(req.params.guildId));
    if (!auth) return;
    await handler(auth, req, res);
  }));
}
