import { randomBytes } from "node:crypto";
import type { Express, Request, Response as ExpressResponse } from "express";
import {
  clearOAuthStateCookie,
  clearDiscordSessionCookie,
  decryptSession,
  readCookies,
  safeTokenEquals,
  setDiscordSessionCookie,
  setOAuthStateCookie,
  type DiscordOAuthSession,
} from "./session";
import { discordRedirectUri } from "./redirect";

export { discordRedirectUri } from "./redirect";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DEFAULT_CLIENT_ID = "1553314620477804544";
const GUILD_ADMINISTRATOR = 0x8n;
const GUILD_MANAGE = 0x20n;

export class DiscordHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Discord HTTP ${status}`);
    this.name = "DiscordHttpError";
  }
}

export type DiscordGuildSummary = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
};

type DiscordTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type DiscordUserResponse = {
  id: string;
  username: string;
  avatar: string | null;
};

type DiscordRawGuild = DiscordGuildSummary;

export function discordClientId(): string {
  return process.env.DISCORD_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
}

export function discordClientSecret(): string | null {
  const value = process.env.DISCORD_CLIENT_SECRET?.trim();
  return value ? value : null;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: globalThis.Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new DiscordHttpError(503);
  }
  if (response.status === 429) {
    const retryHeader = Number(response.headers.get("retry-after") ?? "0");
    const body = await response.json().catch(() => ({})) as { retry_after?: number };
    const retrySeconds = Number.isFinite(body.retry_after) ? body.retry_after! : retryHeader;
    if (retrySeconds > 0 && retrySeconds <= 2) {
      await new Promise((resolve) => setTimeout(resolve, Math.ceil(retrySeconds * 1000)));
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
      } catch {
        throw new DiscordHttpError(503);
      }
    }
  }
  if (!response.ok) throw new DiscordHttpError(response.status);
  return response.json() as Promise<T>;
}

async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  const secret = discordClientSecret();
  if (!secret) throw new DiscordHttpError(503);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: discordRedirectUri(),
    client_id: discordClientId(),
    client_secret: secret,
  });
  return requestJson<DiscordTokenResponse>(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function refreshSession(session: DiscordOAuthSession): Promise<DiscordOAuthSession | null> {
  const secret = discordClientSecret();
  if (!secret || !session.refreshToken) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: discordClientId(),
    client_secret: secret,
  });
  try {
    const token = await requestJson<DiscordTokenResponse>(`${DISCORD_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    return {
      ...session,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || session.refreshToken,
      expiresAt: Date.now() + Math.max(60, token.expires_in) * 1000,
    };
  } catch {
    return null;
  }
}

export async function getActiveDiscordSession(req: Request, res: ExpressResponse): Promise<DiscordOAuthSession | null> {
  const encrypted = readCookies(req).systemix_discord_session;
  const session = decryptSession(encrypted);
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  const refreshed = await refreshSession(session);
  if (!refreshed) {
    clearDiscordSessionCookie(res);
    return null;
  }
  setDiscordSessionCookie(res, refreshed);
  return refreshed;
}

export async function discordUserRequest<T>(session: DiscordOAuthSession, path: string): Promise<T> {
  return requestJson<T>(`${DISCORD_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

function canManageGuild(guild: DiscordRawGuild): boolean {
  try {
    const permissions = BigInt(guild.permissions || "0");
    return guild.owner || (permissions & GUILD_ADMINISTRATOR) !== 0n || (permissions & GUILD_MANAGE) !== 0n;
  } catch {
    return guild.owner;
  }
}

export async function listManagedDiscordGuilds(session: DiscordOAuthSession): Promise<DiscordGuildSummary[]> {
  const guilds = await discordUserRequest<DiscordRawGuild[]>(session, "/users/@me/guilds?limit=200");
  return guilds.filter(canManageGuild).map((guild) => ({
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    owner: guild.owner,
    permissions: guild.permissions,
  }));
}

export async function requireManagedDiscordGuild(
  session: DiscordOAuthSession,
  guildId: string,
): Promise<DiscordGuildSummary> {
  const guilds = await listManagedDiscordGuilds(session);
  const guild = guilds.find((item) => item.id === guildId);
  if (!guild) throw new DiscordHttpError(403);
  return guild;
}

function getParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerDiscordOAuthRoutes(app: Express): void {
  app.get("/api/discord/login", (_req: Request, res: ExpressResponse) => {
    res.set("Cache-Control", "no-store");
    if (!discordClientSecret()) {
      res.status(503).json({ error: "discord_oauth_not_configured" });
      return;
    }
    const state = randomBytes(32).toString("base64url");
    setOAuthStateCookie(res, state);
    const params = new URLSearchParams({
      client_id: discordClientId(),
      redirect_uri: discordRedirectUri(),
      response_type: "code",
      scope: "identify guilds",
      state,
      prompt: "consent",
    });
    res.redirect(302, `https://discord.com/oauth2/authorize?${params.toString()}`);
  });

  app.get("/api/discord/callback", async (req: Request, res: ExpressResponse) => {
    res.set("Cache-Control", "no-store");
    const code = getParam(req, "code");
    const state = getParam(req, "state");
    const cookies = readCookies(req);
    const expectedState = cookies.systemix_discord_oauth_state;
    clearOAuthStateCookie(res);

    if (getParam(req, "error")) {
      res.redirect(302, "/?discord=denied");
      return;
    }
    if (!code || !state || !safeTokenEquals(state, expectedState)) {
      res.status(403).send("تعذر التحقق من جلسة Discord. ابدأ الربط مرة أخرى.");
      return;
    }

    try {
      const token = await exchangeCode(code);
      const identity = await requestJson<DiscordUserResponse>(`${DISCORD_API_BASE}/users/@me`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!token.access_token || !token.refresh_token || !identity.id || !identity.username) {
        res.status(502).send("لم يرجع Discord بيانات جلسة صالحة.");
        return;
      }
      const session: DiscordOAuthSession = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + Math.max(60, token.expires_in) * 1000,
        user: { id: identity.id, username: identity.username, avatar: identity.avatar },
      };
      setDiscordSessionCookie(res, session);
      res.redirect(302, "/");
    } catch (error) {
      const status = error instanceof DiscordHttpError ? error.status : 502;
      res.status(status >= 500 ? 502 : status).send("تعذر إكمال ربط Discord. تحقق من إعداد OAuth ثم أعد المحاولة.");
    }
  });
}
