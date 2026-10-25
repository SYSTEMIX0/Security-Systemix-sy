import { afterEach, describe, expect, it } from "vitest";
import { discordClientId, discordRedirectUri } from "./oauth";

describe("Discord OAuth redirect URI", () => {
  const originalRedirect = process.env.DISCORD_REDIRECT_URI;
  const originalLocalHttp = process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT;
  const originalClientId = process.env.DISCORD_CLIENT_ID;

  afterEach(() => {
    if (originalRedirect === undefined) delete process.env.DISCORD_REDIRECT_URI;
    else process.env.DISCORD_REDIRECT_URI = originalRedirect;
    if (originalLocalHttp === undefined) delete process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT;
    else process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT = originalLocalHttp;
    if (originalClientId === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = originalClientId;
  });

  it("uses the selected Systemix Discord application by default", () => {
    delete process.env.DISCORD_CLIENT_ID;
    expect(discordClientId()).toBe("1553314620477804544");
    process.env.DISCORD_CLIENT_ID = "12345678901234567";
    expect(discordClientId()).toBe("12345678901234567");
  });

  it("allows localhost HTTP callbacks only outside production", () => {
    process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT = "true";
    process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/discord/callback";
    expect(discordRedirectUri()).toBe("http://localhost:3000/api/discord/callback");
  });

  it("rejects arbitrary HTTP callbacks and query strings", () => {
    process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT = "true";
    process.env.DISCORD_REDIRECT_URI = "http://example.com/callback";
    expect(discordRedirectUri()).toBe("https://security-systemix-sy.onrender.com/api/discord/callback");
    process.env.DISCORD_REDIRECT_URI = "https://example.com/callback?next=https://evil.example";
    expect(discordRedirectUri()).toBe("https://security-systemix-sy.onrender.com/api/discord/callback");
  });

  it("keeps a production redirect HTTPS even when a local HTTP value is configured", () => {
    process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT = "false";
    process.env.DISCORD_REDIRECT_URI = "http://127.0.0.1:3000/api/discord/callback";
    expect(discordRedirectUri()).toBe("https://security-systemix-sy.onrender.com/api/discord/callback");
  });
});
