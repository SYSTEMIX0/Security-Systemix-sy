// Prints which runtime settings are present without ever printing their values.
type Env = Record<string, string | undefined>;

function has(env: Env, key: string): boolean {
  return Boolean(env[key]?.trim());
}

export function describeStartupConfig(env: Env = process.env): string[] {
  const production = env.NODE_ENV === "production";
  let gateway: string;
  if (!has(env, "DISCORD_BOT_TOKEN")) {
    gateway = "missing DISCORD_BOT_TOKEN";
  } else if (production && env.SYSTEMIX_ENABLE_PRODUCTION_GATEWAY !== "true") {
    gateway = "off by policy (set SYSTEMIX_ENABLE_PRODUCTION_GATEWAY=true after the database is ready)";
  } else {
    gateway = "starting";
  }

  return [
    `Discord dashboard login: ${has(env, "DISCORD_CLIENT_SECRET") ? "ready" : "missing DISCORD_CLIENT_SECRET"}`,
    `Dashboard session key: ${has(env, "MANUS_JWT_SECRET") ? "ready" : "missing MANUS_JWT_SECRET"}`,
    `Database: ${has(env, "DATABASE_URL") ? "configured" : "missing DATABASE_URL (saving settings and audit logs is disabled)"}`,
    `Discord bot gateway: ${gateway}`,
    `Manus account login: ${has(env, "MANUS_OAUTH_API_URL") ? "enabled" : "not used on this host (optional)"}`,
  ];
}

export function logStartupReport(env: Env = process.env): void {
  for (const line of describeStartupConfig(env)) console.log(`[Systemix] ${line}`);
}
