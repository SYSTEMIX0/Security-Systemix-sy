import { describe, expect, it } from "vitest";
import { normalizeRuntimeReadiness } from "../../client/src/lib/discord-api";

describe("dashboard readiness API contract", () => {
  it("maps the successful /api/ready wire payload to the dashboard contract", () => {
    expect(normalizeRuntimeReadiness({
      status: "ready",
      migration: "ready",
      migrationMode: "automatic",
    })).toEqual({
      ready: true,
      status: "ready",
      migration: { state: "ready", mode: "automatic" },
    });
  });

  it("keeps readiness closed when the API reports a failure", () => {
    expect(normalizeRuntimeReadiness({
      status: "not_ready",
      code: "database_unavailable",
      migration: "connection_failed",
      migrationMode: "automatic",
    })).toEqual({
      ready: false,
      status: "not_ready",
      code: "database_unavailable",
      migration: { state: "connection_failed", mode: "automatic" },
    });
  });

  it("does not report ready when migration has not completed", () => {
    expect(normalizeRuntimeReadiness({
      status: "ready",
      migration: "running",
      migrationMode: "automatic",
    }).ready).toBe(false);
  });
});
