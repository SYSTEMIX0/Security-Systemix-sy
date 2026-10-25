import { afterEach, describe, expect, it } from "vitest";
import { createOwnerCookie, hashOwnerPassword, isOwnerEligible, parseOwnerIds, verifyOwnerCookie, verifyOwnerPassword } from "./owner-auth";

describe("owner authentication primitives", () => {
  const original = {
    passwordHash: process.env.SYSTEMIX_OWNER_PASSWORD_HASH,
    ids: process.env.SYSTEMIX_OWNER_DISCORD_IDS,
    secret: process.env.MANUS_JWT_SECRET,
  };
  afterEach(() => {
    for (const [key, value] of Object.entries({ SYSTEMIX_OWNER_PASSWORD_HASH: original.passwordHash, SYSTEMIX_OWNER_DISCORD_IDS: original.ids, MANUS_JWT_SECRET: original.secret })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it("creates and verifies the documented strong scrypt hash format", async () => {
    const password = "long test-only owner password";
    const hash = await hashOwnerPassword(password);
    process.env.SYSTEMIX_OWNER_PASSWORD_HASH = hash;
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await verifyOwnerPassword(password)).toBe(true);
    expect(await verifyOwnerPassword(`${password}!`)).toBe(false);
    process.env.SYSTEMIX_OWNER_PASSWORD_HASH = "scrypt$1$1$1$bad$bad";
    expect(await verifyOwnerPassword(password)).toBe(false);
  });
  it("enforces the same 20–128 character limit as the owner login field", async () => {
    await expect(hashOwnerPassword("too-short")).rejects.toThrow("20 and 128");
    await expect(hashOwnerPassword("x".repeat(129))).rejects.toThrow("20 and 128");
  });
  it("rejects any malformed allowlist and checks membership without exposing it", () => {
    process.env.SYSTEMIX_OWNER_DISCORD_IDS = "123456789012345678,234567890123456789";
    expect(parseOwnerIds()).toEqual(["123456789012345678", "234567890123456789"]);
    expect(isOwnerEligible("123456789012345678")).toBe(true);
    expect(isOwnerEligible(undefined)).toBe(false);
    process.env.SYSTEMIX_OWNER_DISCORD_IDS = "123456789012345678,not-a-snowflake";
    expect(parseOwnerIds()).toBeNull();
    expect(isOwnerEligible("123456789012345678")).toBe(false);
  });
  it("signs short-lived cookies bound to eligible Discord users", () => {
    process.env.MANUS_JWT_SECRET = "test-only-cookie-secret";
    process.env.SYSTEMIX_OWNER_DISCORD_IDS = "123456789012345678";
    const now = 1_900_000_000_000;
    const cookie = createOwnerCookie("123456789012345678", now)!;
    expect(verifyOwnerCookie(cookie, "123456789012345678", now + 60_000)).toBe(true);
    expect(verifyOwnerCookie(cookie, "234567890123456789", now + 60_000)).toBe(false);
    expect(verifyOwnerCookie(cookie, "123456789012345678", now + 16 * 60_000)).toBe(false);
    expect(verifyOwnerCookie(`${cookie}x`, "123456789012345678", now)).toBe(false);
  });
});
