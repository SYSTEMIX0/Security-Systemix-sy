import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import {
  clearOAuthStateCookie,
  decryptSession,
  encryptSession,
  safeTokenEquals,
  setCsrfCookie,
  setOAuthStateCookie,
  type DiscordOAuthSession,
} from "./session";

describe("Discord OAuth session protection", () => {
  const originalSecret = process.env.MANUS_JWT_SECRET;
  const originalRedirectUri = process.env.DISCORD_REDIRECT_URI;
  const originalLocalHttp = process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT;

  beforeEach(() => {
    process.env.MANUS_JWT_SECRET = "test-only-session-key-that-is-never-committed";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.MANUS_JWT_SECRET;
    else process.env.MANUS_JWT_SECRET = originalSecret;
    if (originalRedirectUri === undefined) delete process.env.DISCORD_REDIRECT_URI;
    else process.env.DISCORD_REDIRECT_URI = originalRedirectUri;
    if (originalLocalHttp === undefined) delete process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT;
    else process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT = originalLocalHttp;
  });

  const session: DiscordOAuthSession = {
    accessToken: "access-token-test-value",
    refreshToken: "refresh-token-test-value",
    expiresAt: 1_900_000_000_000,
    user: { id: "123456789012345678", username: "systemix-test", avatar: null },
  };

  it("encrypts and recovers a Discord session without changing its fields", () => {
    const cookie = encryptSession(session);
    expect(cookie).not.toContain(session.accessToken);
    expect(cookie).not.toContain(session.refreshToken);
    expect(decryptSession(cookie)).toEqual(session);
  });

  it("rejects altered, malformed, oversized, and missing cookies", () => {
    const cookie = encryptSession(session);
    const [iv, tag, ciphertext] = cookie.split(".");
    const changedTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    expect(decryptSession(`${iv}.${changedTag}.${ciphertext}`)).toBeNull();
    expect(decryptSession("not-a-valid-cookie")).toBeNull();
    expect(decryptSession("x".repeat(8193))).toBeNull();
    expect(decryptSession(undefined)).toBeNull();
  });

  it("compares OAuth state strings only when both values match", () => {
    expect(safeTokenEquals("state-token", "state-token")).toBe(true);
    expect(safeTokenEquals("state-token", "different-token")).toBe(false);
    expect(safeTokenEquals("state-token", undefined)).toBe(false);
  });

  it("uses cross-site Secure cookies for an HTTPS Preview or published callback", () => {
    process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT = "false";
    process.env.DISCORD_REDIRECT_URI = "https://preview.example.com/api/discord/callback";
    const cookie = vi.fn();
    const response = { cookie } as unknown as Response;

    setOAuthStateCookie(response, "state");
    setCsrfCookie(response, "csrf");

    expect(cookie.mock.calls[0]?.[2]).toMatchObject({ sameSite: "none", secure: true, httpOnly: true });
    expect(cookie.mock.calls[1]?.[2]).toMatchObject({ sameSite: "none", secure: true, httpOnly: false });
  });

  it("uses Lax only for plain-HTTP localhost development callbacks", () => {
    process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT = "true";
    process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/discord/callback";
    const cookie = vi.fn();
    const response = { cookie } as unknown as Response;

    setOAuthStateCookie(response, "state");
    setCsrfCookie(response, "csrf");

    expect(cookie.mock.calls[0]?.[2]).toMatchObject({ sameSite: "lax", secure: false, httpOnly: true });
    expect(cookie.mock.calls[1]?.[2]).toMatchObject({ sameSite: "lax", secure: false, httpOnly: false });
  });

  it("never downgrades a production cookie for a localhost HTTP redirect", () => {
    process.env.SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT = "false";
    process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/discord/callback";
    const cookie = vi.fn();
    const response = { cookie } as unknown as Response;

    setOAuthStateCookie(response, "state");

    expect(cookie.mock.calls[0]?.[2]).toMatchObject({ sameSite: "none", secure: true, httpOnly: true });
  });

  it("clears the OAuth state with the same HTTPS cookie attributes used when setting it", () => {
    process.env.DISCORD_REDIRECT_URI = "https://preview.example.com/api/discord/callback";
    const clearCookie = vi.fn();
    const response = { clearCookie } as unknown as Response;

    clearOAuthStateCookie(response);

    expect(clearCookie.mock.calls[0]?.[1]).toMatchObject({ sameSite: "none", secure: true, httpOnly: true });
  });
});
