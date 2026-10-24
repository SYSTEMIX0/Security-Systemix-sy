import { describe, expect, it } from "vitest";
import { describeStartupConfig } from "./startupReport";

describe("describeStartupConfig", () => {
  it("names missing settings and treats Manus login as optional", () => {
    const lines = describeStartupConfig({ NODE_ENV: "production" });
    expect(lines).toContain("Discord dashboard login: missing DISCORD_CLIENT_SECRET");
    expect(lines).toContain("Dashboard session key: missing MANUS_JWT_SECRET");
    expect(lines.join("\n")).toContain("missing DATABASE_URL");
    expect(lines).toContain("Discord bot gateway: missing DISCORD_BOT_TOKEN");
    expect(lines).toContain("Manus account login: not used on this host (optional)");
  });

  it("reports configured state without printing secret values", () => {
    const env = {
      NODE_ENV: "production",
      DISCORD_CLIENT_SECRET: "client-secret-value",
      DISCORD_BOT_TOKEN: "bot-token-value",
      MANUS_JWT_SECRET: "session-secret-value",
      DATABASE_URL: "mysql://user:password@db.example:4000/systemix",
    };
    const text = describeStartupConfig(env).join("\n");
    expect(text).toContain("Discord dashboard login: ready");
    expect(text).toContain("Database: configured");
    expect(text).toContain("off by policy");
    for (const value of Object.values(env).slice(1)) expect(text).not.toContain(value);
  });

  it("shows the gateway starting once production policy allows it", () => {
    const lines = describeStartupConfig({
      NODE_ENV: "production",
      DISCORD_BOT_TOKEN: "x",
      SYSTEMIX_ENABLE_PRODUCTION_GATEWAY: "true",
    });
    expect(lines).toContain("Discord bot gateway: starting");
  });
});
