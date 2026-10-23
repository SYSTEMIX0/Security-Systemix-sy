import { describe, expect, it } from "vitest";
import { defaultGuildSecurityConfig } from "../config";
import { loggingEnabled } from "./logging";

describe("privacy-conscious logging switches", () => {
  it("requires both module and event switches and respects ignored channels", () => {
    const config = {
      ...defaultGuildSecurityConfig,
      logging: { ...defaultGuildSecurityConfig.logging, enabled: true, messageDelete: true, ignoredChannelIds: ["ignored"] },
    };
    expect(loggingEnabled(config, "messageDelete", "safe")).toBe(true);
    expect(loggingEnabled(config, "messageDelete", "ignored")).toBe(false);
    expect(loggingEnabled({ ...config, logging: { ...config.logging, enabled: false } }, "messageDelete")).toBe(false);
  });
});
