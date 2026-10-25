const DEFAULT_REDIRECT_URI = "https://security-systemix-sy.onrender.com/api/discord/callback";

export function resolveDiscordRedirectUri(configuredUri: string | undefined, allowLocalHttp: boolean): string {
  const configured = configuredUri?.trim() || DEFAULT_REDIRECT_URI;
  try {
    const parsed = new URL(configured);
    const validHttps = parsed.protocol === "https:";
    const validLocalHttp = allowLocalHttp &&
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if ((!validHttps && !validLocalHttp) || parsed.username || parsed.password || parsed.hash || parsed.search) {
      return DEFAULT_REDIRECT_URI;
    }
    return parsed.toString();
  } catch {
    return DEFAULT_REDIRECT_URI;
  }
}

export function discordRedirectUri(): string {
  const localHttpAllowed = process.env.NODE_ENV !== "production" &&
    process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT === "true";
  return resolveDiscordRedirectUri(process.env.DISCORD_REDIRECT_URI, localHttpAllowed);
}
