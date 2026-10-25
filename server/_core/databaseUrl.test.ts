import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "./databaseUrl";

function sslOf(url: string): unknown {
  const value = new URL(url).searchParams.get("ssl");
  return value === null ? null : JSON.parse(value);
}

describe("normalizeDatabaseUrl", () => {
  it("keeps an explicit mysql2 ssl option unchanged", () => {
    const url = 'mysql://u:p@gateway01.example.tidbcloud.com:4000/app?ssl={"rejectUnauthorized":true}';
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("adds verified TLS for TiDB Cloud hosts without an ssl option", () => {
    const result = normalizeDatabaseUrl("mysql://u:p@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/test");
    expect(sslOf(result)).toEqual({ rejectUnauthorized: true });
  });

  it("converts Prisma and MySQL CLI TLS hints", () => {
    for (const hint of ["sslaccept=strict", "ssl-mode=REQUIRED", "sslmode=require"]) {
      const result = normalizeDatabaseUrl(`mysql://u:p@db.example.com:3306/app?${hint}`);
      const params = new URL(result).searchParams;
      expect(sslOf(result)).toEqual({ rejectUnauthorized: true });
      expect(params.has("sslaccept") || params.has("ssl-mode") || params.has("sslmode")).toBe(false);
    }
  });

  it("attaches a supplied Aiven CA certificate without disabling verification", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nexample-ca\n-----END CERTIFICATE-----\n";
    const result = normalizeDatabaseUrl(
      "mysql://avnadmin:password@systemix-db.example.aivencloud.com:1939/defaultdb?ssl-mode=REQUIRED",
      ca,
    );
    expect(sslOf(result)).toEqual({ rejectUnauthorized: true, ca: ca.trim() });
  });

  it("normalizes escaped newlines in the CA environment variable", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nexample-ca\n-----END CERTIFICATE-----";
    const result = normalizeDatabaseUrl(
      "mysql://u:p@db.example.com:1939/app?ssl-mode=REQUIRED",
      ca.replace(/\n/g, "\\n"),
    );
    expect(sslOf(result)).toEqual({ rejectUnauthorized: true, ca });
  });

  it("leaves plain local URLs without TLS and keeps credentials intact", () => {
    const result = normalizeDatabaseUrl("mysql://user:p%40ss@localhost:3306/app");
    expect(sslOf(result)).toBeNull();
    expect(decodeURIComponent(new URL(result).password)).toBe("p@ss");
  });

  it("returns non-URL input unchanged", () => {
    expect(normalizeDatabaseUrl("not a url")).toBe("not a url");
  });
});
