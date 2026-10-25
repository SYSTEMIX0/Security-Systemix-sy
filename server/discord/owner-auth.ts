import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { ENV } from "../_core/env";
import { discordRedirectUri } from "./redirect";

const scrypt = (password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, length, options, (error, key) => error ? reject(error) : resolve(key)));
export const OWNER_COOKIE = "systemix_owner_session";
const OWNER_COOKIE_PATH = "/api/owner";
const OWNER_SESSION_SECONDS = 15 * 60;
const SNOWFLAKE = /^[0-9]{17,20}$/;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 32;
const DOMAIN = "systemix:owner-session:v1";

type PasswordHash = { salt: Buffer; key: Buffer };
export function parseOwnerIds(value = process.env.SYSTEMIX_OWNER_DISCORD_IDS ?? ""): string[] | null {
  if (!value.trim()) return null;
  const ids = value.split(",").map((id) => id.trim());
  if (ids.some((id) => !SNOWFLAKE.test(id))) return null;
  return [...new Set(ids)];
}
export function isOwnerEligible(userId: string | undefined): boolean {
  const ids = parseOwnerIds();
  return Boolean(userId && SNOWFLAKE.test(userId) && ids?.includes(userId));
}
export function isOwnerPasswordConfigured(): boolean {
  return parseOwnerPasswordHash() !== null;
}
function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const result = Buffer.from(value, "base64url");
    return result.length > 0 && result.toString("base64url") === value ? result : null;
  } catch { return null; }
}
function parseOwnerPasswordHash(value = process.env.SYSTEMIX_OWNER_PASSWORD_HASH ?? ""): PasswordHash | null {
  const parts = value.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== String(SCRYPT_N) || parts[2] !== String(SCRYPT_R) || parts[3] !== String(SCRYPT_P)) return null;
  const salt = decodeBase64Url(parts[4]);
  const key = decodeBase64Url(parts[5]);
  if (!salt || salt.length < 16 || salt.length > 64 || !key || key.length !== SCRYPT_KEY_BYTES) return null;
  return { salt, key };
}
export async function verifyOwnerPassword(password: string): Promise<boolean> {
  const parsed = parseOwnerPasswordHash();
  // Fail closed on invalid/missing configuration while still doing a fixed-size comparison.
  const salt = parsed?.salt ?? Buffer.alloc(16);
  const expected = parsed?.key ?? Buffer.alloc(SCRYPT_KEY_BYTES);
  let actual: Buffer;
  try {
    actual = await scrypt(password, salt, SCRYPT_KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }) as Buffer;
  } catch { return false; }
  return timingSafeEqual(actual, expected) && parsed !== null;
}
function ownerSigningKey(): Buffer | null {
  if (!ENV.cookieSecret) return null;
  return createHmac("sha256", ENV.cookieSecret)
    .update(DOMAIN)
    .update("\0")
    .update(process.env.SYSTEMIX_OWNER_PASSWORD_HASH ?? "")
    .digest();
}
function signature(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(`${DOMAIN}.${payload}`).digest();
}
export function createOwnerCookie(userId: string, now = Date.now()): string | null {
  const key = ownerSigningKey();
  if (!key || !SNOWFLAKE.test(userId) || !isOwnerEligible(userId)) return null;
  const payload = Buffer.from(JSON.stringify({ userId, exp: Math.floor(now / 1000) + OWNER_SESSION_SECONDS }), "utf8").toString("base64url");
  return `${payload}.${signature(payload, key).toString("base64url")}`;
}
export function verifyOwnerCookie(cookie: string | undefined, userId: string, now = Date.now()): boolean {
  try {
    const key = ownerSigningKey();
    if (!key || !cookie || cookie.length > 2048 || !SNOWFLAKE.test(userId)) return false;
    const [payload, encodedSignature, extra] = cookie.split(".");
    if (!payload || !encodedSignature || extra !== undefined) return false;
    const provided = decodeBase64Url(encodedSignature);
    if (!provided || provided.length !== 32 || !timingSafeEqual(signature(payload, key), provided)) return false;
    const bytes = decodeBase64Url(payload);
    if (!bytes) return false;
    const data: unknown = JSON.parse(bytes.toString("utf8"));
    if (!data || typeof data !== "object") return false;
    const value = data as { userId?: unknown; exp?: unknown };
    return value.userId === userId && typeof value.exp === "number" && Number.isSafeInteger(value.exp) && value.exp > Math.floor(now / 1000) && value.exp <= Math.floor(now / 1000) + OWNER_SESSION_SECONDS + 30 && isOwnerEligible(userId);
  } catch { return false; }
}
export function setOwnerCookie(res: Response, value: string): void {
  const secure = new URL(discordRedirectUri()).protocol === "https:";
  res.cookie(OWNER_COOKIE, value, { httpOnly: true, secure, sameSite: secure ? "none" : "lax", path: OWNER_COOKIE_PATH, maxAge: OWNER_SESSION_SECONDS * 1000 });
}
export function clearOwnerCookie(res: Response): void {
  const secure = new URL(discordRedirectUri()).protocol === "https:";
  res.clearCookie(OWNER_COOKIE, { httpOnly: true, secure, sameSite: secure ? "none" : "lax", path: OWNER_COOKIE_PATH });
}
export function ownerCookieFromRequest(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== OWNER_COOKIE) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}
export async function hashOwnerPassword(password: string): Promise<string> {
  if (password.length < 20 || password.length > 128) {
    throw new Error("Owner password must be between 20 and 128 characters.");
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
