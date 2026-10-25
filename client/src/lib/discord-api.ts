import type { GuildSecurityConfig, GuildSecurityPatch } from "../../../server/discord/config";
import type { GuildMeta } from "../../../shared/systemix-api";

export type DiscordBotState = {
  status: "not_configured" | "disabled_by_policy" | "blocked_by_readiness" | "connecting" | "ready" | "degraded";
  readyAt: string | null;
  guildCount: number;
  memberIntentEnabled: boolean;
  messageContentIntentEnabled: boolean;
  lastErrorCode: string | null;
  commandCount: number | null;
  commandSyncStatus: "not_started" | "pending" | "synced" | "failed";
  commandSyncErrorCode: string | null;
  moduleCount: number;
  implementedModules: string[];
  totalModuleCount: number;
  pingMs: number | null;
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
  databaseConfigured: boolean;
  sessionKeyConfigured: boolean;
};

export type OwnerPanelStatus = {
  configured: boolean;
  authenticated: boolean;
  eligible: boolean;
  userId: string | null;
};

export type OwnerPanelOverview = {
  bot: Pick<DiscordBotState, "status">;
  readiness: {
    oauthConfigured: boolean;
    sessionKeyConfigured: boolean;
    ownerPasswordConfigured: boolean;
    ownerAllowlistConfigured: boolean;
  };
};

export type OwnerSubscription = {
  guildId: string;
  plan: "monthly" | "annual";
  status: "active" | "suspended" | "expired";
  startsAt: string;
  endsAt: string;
  note: string | null;
  updatedByDiscordId: string;
  updatedAt: string;
};

export type OwnerSubscriptionMutation =
  | { action: "activate" | "renew"; guildId: string; plan: "monthly" | "annual"; note?: string; confirmation: "RENEW_SUBSCRIPTION" }
  | { action: "suspend"; guildId: string; note?: string; confirmation: "SUSPEND_SUBSCRIPTION" };

export type RuntimeReadiness = {
  ready: boolean;
  status: "ready" | "not_ready";
  code?: "database_unavailable" | "migrations_pending";
  migration: {
    state: "not_requested" | "running" | "ready" | "missing_database" | "connection_failed" | "failed";
    mode: "automatic" | "external";
  };
};

type RuntimeReadinessPayload = {
  status: RuntimeReadiness["status"];
  code?: RuntimeReadiness["code"];
  migration: RuntimeReadiness["migration"]["state"];
  migrationMode: RuntimeReadiness["migration"]["mode"];
};

export function normalizeRuntimeReadiness(payload: RuntimeReadinessPayload): RuntimeReadiness {
  return {
    ready: payload.status === "ready" && payload.migration === "ready",
    status: payload.status,
    ...(payload.code ? { code: payload.code } : {}),
    migration: { state: payload.migration, mode: payload.migrationMode },
  };
}

export type DiscordGuildSnapshot = {
  settings: GuildSecurityConfig;
  subscription: {
    status: "active" | "suspended" | "expired" | "not_provisioned";
    plan: "monthly" | "annual" | null;
    endsAt: string | null;
  };
  botInstalled: boolean;
  botOnline: boolean;
  permissions: {
    viewAuditLog: boolean;
    manageGuild: boolean;
    manageRoles: boolean;
    moderateMembers: boolean;
  };
  memberIntentEnabled: boolean;
  messageContentIntentEnabled: boolean;
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

async function readJson<T>(path: string, init?: RequestInit, acceptedStatusCodes: number[] = []): Promise<T> {
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
  if (!response.ok && !acceptedStatusCodes.includes(response.status)) {
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
  loadGuildMeta: (guildId: string) => readJson<GuildMeta>(`/api/discord/guilds/${encodeURIComponent(guildId)}/meta`),
  loadGuildEvents: (guildId: string) => readJson<{ events: DiscordSecurityEvent[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/events?limit=30`),
  async saveGuildSettings(guildId: string, patch: GuildSecurityPatch, confirmation: "CONFIRM_SETTINGS" | "ENABLE_PROTECTION") {
    return readJson<{ ok: true; settings: GuildSecurityConfig }>(
      `/api/discord/guilds/${encodeURIComponent(guildId)}/settings`,
      { method: "PUT", headers: { "Content-Type": "application/json", "x-systemix-confirm": confirmation, ...(await csrfHeader()) }, body: JSON.stringify(patch) },
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
  loadOwnerStatus: () => readJson<OwnerPanelStatus>("/api/owner/status"),
  loadOwnerOverview: () => readJson<OwnerPanelOverview>("/api/owner/overview"),
  loadOwnerSubscriptions: () => readJson<{ subscriptions: OwnerSubscription[] }>("/api/owner/subscriptions"),
  loadReadiness: async () => normalizeRuntimeReadiness(await readJson<RuntimeReadinessPayload>("/api/ready", undefined, [503])),
  async loginOwner(password: string) {
    return readJson<{ authenticated: true }>("/api/owner/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await csrfHeader()) },
      body: JSON.stringify({ password }),
    });
  },
  async logoutOwner() {
    return readJson<{ ok: true }>("/api/owner/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await csrfHeader()) },
      body: JSON.stringify({}),
    });
  },
  async updateOwnerSubscription(input: OwnerSubscriptionMutation) {
    return readJson<{ ok: true; subscription: OwnerSubscription }>("/api/owner/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await csrfHeader()) },
      body: JSON.stringify(input),
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
