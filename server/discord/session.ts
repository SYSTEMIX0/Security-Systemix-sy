import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "../_core/env";
import { discordRedirectUri } from "./redirect";

export const DISCORD_SESSION_COOKIE = "systemix_discord_session";
export const DISCORD_STATE_COOKIE = "systemix_discord_oauth_state";
export const DISCORD_CSRF_COOKIE = "systemix_discord_csrf";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type DiscordOAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; username: string; avatar: string | null };
};

function sessionKey(): Buffer {
  if (!ENV.cookieSecret) throw new Error("Session key is unavailable");
  return createHmac("sha256", ENV.cookieSecret)
    .update("security-systemix-discord-session-v1")
    .digest();
}

export function encryptSession(session: DiscordOAuthSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptSession(value: string | undefined): DiscordOAuthSession | null {
  if (!value || value.length > 8192) return null;
  try {
    const [ivPart, tagPart, ciphertextPart, extra] = value.split(".");
    if (!ivPart || !tagPart || !ciphertextPart || extra !== undefined) return null;
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const session = JSON.parse(plaintext) as DiscordOAuthSession;
    if (
      typeof session.accessToken !== "string" ||
      typeof session.refreshToken !== "string" ||
      !Number.isFinite(session.expiresAt) ||
      typeof session.user?.id !== "string" ||
      typeof session.user?.username !== "string" ||
      !(session.user.avatar === null || typeof session.user.avatar === "string")
    ) return null;
    return session;
  } catch {
    return null;
  }
}

function cookieOptions(httpOnly: boolean) {
  const secure = new URL(discordRedirectUri()).protocol === "https:";
  return {
    httpOnly,
    path: "/",
    sameSite: secure ? "none" as const : "lax" as const,
    secure,
    // Allows the encrypted session to persist in browser contexts that partition third-party cookies.
    partitioned: secure,
  };
}

export function readCookies(req: Request): Record<string, string> {
  return parseCookieHeader(req.headers.cookie ?? "");
}

export function setDiscordSessionCookie(res: Response, session: DiscordOAuthSession): void {
  const remaining = Math.max(60_000, Math.min(session.expiresAt - Date.now(), SESSION_MAX_AGE_MS));
  res.cookie(DISCORD_SESSION_COOKIE, encryptSession(session), {
    ...cookieOptions(true),
    maxAge: remaining,
  });
}

export function clearDiscordSessionCookie(res: Response): void {
  res.clearCookie(DISCORD_SESSION_COOKIE, cookieOptions(true));
}

export function setOAuthStateCookie(res: Response, state: string): void {
  res.cookie(DISCORD_STATE_COOKIE, state, {
    ...cookieOptions(true),
    maxAge: 5 * 60 * 1000,
  });
}

export function clearOAuthStateCookie(res: Response): void {
  res.clearCookie(DISCORD_STATE_COOKIE, cookieOptions(true));
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(DISCORD_CSRF_COOKIE, token, {
    ...cookieOptions(false),
    maxAge: 30 * 60 * 1000,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(DISCORD_CSRF_COOKIE, cookieOptions(false));
}

export function safeTokenEquals(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
