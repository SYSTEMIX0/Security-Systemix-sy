import type { Express } from "express";
import { registerAutoModApi } from "./api/automod";
import { asyncRoute, apiError, validateMutation } from "./api/common";
import { registerCommunityApi } from "./api/community";
import { registerCoreApi } from "./api/core";
import { registerModerationApi } from "./api/moderation";
import { registerSecurityApi } from "./api/security";
import { getDiscordBotState, getDiscordClient } from "./bot";
import {
  discordClientSecret,
  getActiveDiscordSession,
  listManagedDiscordGuilds,
  registerDiscordOAuthRoutes,
} from "./oauth";
import { clearCsrfCookie, clearDiscordSessionCookie, createCsrfToken, setCsrfCookie } from "./session";

export function registerDiscordRoutes(app: Express): void {
  app.use("/api/discord", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  registerDiscordOAuthRoutes(app);

  app.get("/api/discord/status", (_req, res) => {
    res.json({ oauthConfigured: Boolean(discordClientSecret()), bot: getDiscordBotState() });
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

  registerCoreApi(app);
  registerAutoModApi(app);
  registerSecurityApi(app);
  registerModerationApi(app);
  registerCommunityApi(app);
}
