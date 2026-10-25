import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import { ENV } from "../../_core/env";
import { asyncRoute, validateMutation } from "./common";
import { getDiscordBotState } from "../bot";
import { discordClientSecret, getActiveDiscordSession } from "../oauth";
import {
  clearOwnerCookie, createOwnerCookie, isOwnerEligible, isOwnerPasswordConfigured,
  ownerCookieFromRequest, parseOwnerIds, setOwnerCookie, verifyOwnerCookie, verifyOwnerPassword,
} from "../owner-auth";

const WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_ATTEMPTS = 8;
const MAX_BUCKETS = 5_000;
const attempts = new Map<string, { start: number; count: number }>();
function attemptKey(req: Request, userId?: string): string {
  // Render may place many visitors behind the same socket-facing proxy. Rate-limit
  // authenticated attempts by Discord identity; use the remote address only pre-login.
  const identity = userId ? `discord:${userId}` : `remote:${req.socket.remoteAddress ?? "unknown"}`;
  return createHash("sha256").update(identity).digest("hex");
}
function allowLoginAttempt(req: Request, userId?: string): boolean {
  const now = Date.now();
  for (const [key, bucket] of attempts) if (now - bucket.start >= WINDOW_MS) attempts.delete(key);
  while (attempts.size >= MAX_BUCKETS) attempts.delete(attempts.keys().next().value!);
  const key = attemptKey(req, userId);
  const bucket = attempts.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return true;
  }
  if (bucket.count >= MAX_LOGIN_ATTEMPTS) return false;
  bucket.count += 1;
  return true;
}
function ownerConfigured(): boolean {
  return isOwnerPasswordConfigured() && parseOwnerIds() !== null && Boolean(ENV.cookieSecret);
}
function ownerAuthenticated(userId: string | undefined, cookie: string | undefined): boolean {
  return Boolean(userId && isOwnerEligible(userId) && verifyOwnerCookie(cookie, userId));
}
export function registerOwnerApi(app: Express): void {
  app.use("/api/owner", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/owner/status", asyncRoute(async (req, res) => {
    let userId: string | undefined;
    try { userId = (await getActiveDiscordSession(req, res))?.user.id; } catch { userId = undefined; }
    res.json({
      configured: ownerConfigured(),
      authenticated: ownerConfigured() && ownerAuthenticated(userId, ownerCookieFromRequest(req)),
      userId: userId ?? null,
      eligible: isOwnerEligible(userId),
    });
  }));
  app.post("/api/owner/login", asyncRoute(async (req, res) => {
    if (!validateMutation(req, res)) return;
    let session;
    try { session = await getActiveDiscordSession(req, res); } catch { session = null; }
    if (!allowLoginAttempt(req, session?.user.id)) { res.status(429).json({ error: "owner_auth_failed" }); return; }
    const password = typeof req.body?.password === "string" && req.body.password.length <= 128 ? req.body.password : "";
    const eligible = isOwnerEligible(session?.user.id);
    const validPassword = Boolean(session && eligible) && await verifyOwnerPassword(password);
    // Do not reveal whether any individual credential was correct.
    if (!session || !eligible || !validPassword || !ownerConfigured()) {
      res.status(401).json({ error: "owner_auth_failed" });
      return;
    }
    const cookie = createOwnerCookie(session.user.id);
    if (!cookie) { res.status(503).json({ error: "owner_auth_failed" }); return; }
    setOwnerCookie(res, cookie);
    res.json({ authenticated: true });
  }));
  app.post("/api/owner/logout", (_req, res) => {
    if (!validateMutation(_req, res)) return;
    clearOwnerCookie(res);
    res.json({ ok: true });
  });
  app.get("/api/owner/overview", asyncRoute(async (req, res) => {
    let session;
    try { session = await getActiveDiscordSession(req, res); } catch { session = null; }
    if (!session || !isOwnerEligible(session.user.id) || !verifyOwnerCookie(ownerCookieFromRequest(req), session.user.id) || !ownerConfigured()) {
      res.status(401).json({ error: "owner_auth_required" });
      return;
    }
    const bot = getDiscordBotState();
    res.json({
      bot: { status: bot.status },
      readiness: {
        oauthConfigured: Boolean(discordClientSecret()),
        sessionKeyConfigured: Boolean(ENV.cookieSecret),
        ownerPasswordConfigured: isOwnerPasswordConfigured(),
        ownerAllowlistConfigured: parseOwnerIds() !== null,
      },
    });
  }));
}
/** Small test-only reset hook for isolated rate-limit tests. */
export function resetOwnerLoginAttemptsForTests(): void { attempts.clear(); }
