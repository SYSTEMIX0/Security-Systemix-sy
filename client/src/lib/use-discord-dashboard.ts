import { useCallback, useEffect, useState } from "react";
import { discordApi, type DiscordDashboardData } from "./discord-api";

const emptyData: DiscordDashboardData = {
  user: null,
  guilds: [],
  bot: {
    status: "not_configured",
    readyAt: null,
    guildCount: 0,
    memberIntentEnabled: false,
    messageContentIntentEnabled: false,
    lastErrorCode: null,
    commandCount: null,
    commandSyncStatus: "not_started",
    commandSyncErrorCode: null,
    moduleCount: 0,
    implementedModules: [],
    totalModuleCount: 0,
    pingMs: null,
  },
  oauthConfigured: false,
  databaseConfigured: false,
  sessionKeyConfigured: false,
};

export function useDiscordDashboard() {
  const [data, setData] = useState<DiscordDashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildIdState] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("systemix-selected-guild") ?? "";
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await discordApi.loadDashboard();
      setData(next);
      setError(null);
      setSelectedGuildIdState((current) => {
        if (next.guilds.some((guild) => guild.id === current)) return current;
        const fallback = next.guilds[0]?.id ?? "";
        if (typeof window !== "undefined") {
          if (fallback) window.sessionStorage.setItem("systemix-selected-guild", fallback);
          else window.sessionStorage.removeItem("systemix-selected-guild");
        }
        return fallback;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const selectGuild = useCallback((guildId: string) => {
    setSelectedGuildIdState(guildId);
    if (typeof window !== "undefined") {
      if (guildId) window.sessionStorage.setItem("systemix-selected-guild", guildId);
      else window.sessionStorage.removeItem("systemix-selected-guild");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { data, loading, error, refresh, selectedGuildId, selectGuild };
}
