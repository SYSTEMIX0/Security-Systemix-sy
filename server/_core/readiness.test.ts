import { describe, expect, it } from "vitest";
import { shouldStartProductionGateway } from "./readiness";

describe("production Discord Gateway readiness gate", () => {
  it("holds a production Gateway when DB or migrations are not ready", () => {
    expect(shouldStartProductionGateway({ NODE_ENV: "production", SYSTEMIX_ENABLE_PRODUCTION_GATEWAY: "true" }, false)).toBe(false);
  });

  it("permits production startup only when the explicit gateway flag and readiness both pass", () => {
    expect(shouldStartProductionGateway({ NODE_ENV: "production", SYSTEMIX_ENABLE_PRODUCTION_GATEWAY: "true" }, true)).toBe(true);
  });

  it("keeps a production Gateway opt-in when the flag is missing or false", () => {
    expect(shouldStartProductionGateway({ NODE_ENV: "production" }, true)).toBe(false);
    expect(shouldStartProductionGateway({ NODE_ENV: "production", SYSTEMIX_ENABLE_PRODUCTION_GATEWAY: "false" }, true)).toBe(false);
    expect(shouldStartProductionGateway({ NODE_ENV: "production" }, false)).toBe(false);
    expect(shouldStartProductionGateway({ NODE_ENV: "production", SYSTEMIX_ENABLE_PRODUCTION_GATEWAY: "false" }, false)).toBe(false);
  });

  it("does not impose the production DB gate on local development", () => {
    expect(shouldStartProductionGateway({ NODE_ENV: "development", SYSTEMIX_ENABLE_PRODUCTION_GATEWAY: "true" }, false)).toBe(true);
  });
});
