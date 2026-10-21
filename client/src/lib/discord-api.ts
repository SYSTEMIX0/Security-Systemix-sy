import type { GuildSecurityConfig, GuildSecurityPatch } from "../../../server/discord/config";

export type DiscordBotState = {
  status: "not_configured" | "disabled_by_policy" | "connecting" | "ready" | "degraded";
  readyAt: string | null;
  guildCount: number;
  memberIntentEnabled: boolean;
  messageContentIntentEnabled: false;
  lastErrorCode: string | null;
};

export type DiscordGuildChoice = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  botInstalled: boolean;
};

export type DiscordDashboardData = {
  user: { id: string; username: string; avatar: string | null } | null;
  guilds: DiscordGuildChoice[];
  bot: DiscordBotState;
  oauthConfigured: boolean;
};

export type DiscordGuildSnapshot = {
  settings: GuildSecurityConfig;
  botInstalled: boolean;
  botOnline: boolean;
  permissions: {
    viewAuditLog: boolean;
    manageGuild: boolean;
    manageRoles: boolean;
    moderateMembers: boolean;
  };
  memberIntentEnabled: boolean;
};

export type DiscordSecurityEvent = {
  id: number;
  guildId: string;
  eventType: string;
  actorId: string | null;
  targetId: string | null;
  severity: "low" | "medium" | "high";
  details: Record<string, unknown>;
  createdAt: string;
};

export class DiscordApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "DiscordApiError";
  }
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      credentials: "include",
      ...init,
    });
  } catch {
    throw new DiscordApiError(0, "network_unavailable");
  }
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : "request_failed";
    throw new DiscordApiError(response.status, code);
  }
  return payload as T;
}

async function csrfHeader(): Promise<Record<string, string>> {
  const result = await readJson<{ token: string }>("/api/discord/csrf");
  return { "x-systemix-csrf": result.token };
}

export const discordApi = {
  loadDashboard: () => readJson<DiscordDashboardData>("/api/discord/me"),
  loadGuildSettings: (guildId: string) => readJson<DiscordGuildSnapshot>(`/api/discord/guilds/${encodeURIComponent(guildId)}/settings`),
  loadGuildEvents: (guildId: string) => readJson<{ events: DiscordSecurityEvent[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/events?limit=30`),
  async saveGuildSettings(guildId: string, patch: GuildSecurityPatch) {
    return readJson<{ ok: true; settings: GuildSecurityConfig; mode: "observe" }>(
      `/api/discord/guilds/${encodeURIComponent(guildId)}/settings`,
      { method: "PUT", headers: { "Content-Type": "application/json", ...(await csrfHeader()) }, body: JSON.stringify(patch) },
    );
  },
  async applyAutoMod(guildId: string) {
    return readJson<{ ok: true; changes: { name: string; id: string; action: "created" | "updated" | "unchanged" | "disabled" }[]; note: string }>(
      `/api/discord/guilds/${encodeURIComponent(guildId)}/automod/apply`,
      { method: "POST", headers: { "Content-Type": "application/json", ...(await csrfHeader()) }, body: JSON.stringify({ confirm: "APPLY_AUTOMOD" }) },
    );
  },
  async getInviteUrl(guildId: string) {
    return readJson<{ url: string; permissions: string[]; administratorRequested: false }>(
      `/api/discord/guilds/${encodeURIComponent(guildId)}/invite`,
    );
  },
  async logout() {
    return readJson<{ ok: true }>("/api/discord/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await csrfHeader()) },
      body: JSON.stringify({}),
    });
  },
};

export function discordLoginUrl(): string {
  if (typeof window === "undefined") return "/api/discord/login";
  if (window.location.hostname.endsWith(".manus.computer")) {
    return "https://systemix-hc3hycno.manus.space/api/discord/login";
  }
  return "/api/discord/login";
}
