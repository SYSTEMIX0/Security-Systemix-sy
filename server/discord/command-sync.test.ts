import { describe, expect, it } from "vitest";
import { commandSyncRetryDelay } from "./command-sync";

describe("commandSyncRetryDelay", () => {
  it("retries a transient Undici socket failure with bounded backoff", () => {
    expect(commandSyncRetryDelay("und_err_socket", null, 0)).toBe(10_000);
    expect(commandSyncRetryDelay("UND_ERR_SOCKET", null, 1)).toBe(30_000);
    expect(commandSyncRetryDelay("und_err_socket", null, 2)).toBeNull();
  });

  it("retries rate limits and server failures but not permanent client errors", () => {
    expect(commandSyncRetryDelay("discord_api_error", 429, 0)).toBe(10_000);
    expect(commandSyncRetryDelay("discord_api_error", 503, 1)).toBe(30_000);
    expect(commandSyncRetryDelay("discord_api_error", 401, 0)).toBeNull();
    expect(commandSyncRetryDelay("invalid_application_id", 400, 0)).toBeNull();
  });

  it("rejects invalid attempt indexes", () => {
    expect(commandSyncRetryDelay("und_err_socket", null, -1)).toBeNull();
    expect(commandSyncRetryDelay("und_err_socket", null, 0.5)).toBeNull();
  });
});
