import { describe, expect, it } from "vitest";
import { safeDiscordErrorCode } from "./security";

describe("safeDiscordErrorCode", () => {
  it("preserves a safe HTTP status from the outer error", () => {
    const error = Object.assign(new Error("not logged"), { status: 401 });
    expect(safeDiscordErrorCode(error)).toBe("discord_http_401");
  });

  it("extracts a validated network code from a nested cause", () => {
    const cause = Object.assign(new Error("socket message is not logged"), { code: "ECONNRESET" });
    const error = Object.assign(new Error("outer message is not logged"), { cause });
    expect(safeDiscordErrorCode(error)).toBe("econnreset");
  });

  it("does not expose exception messages or accept unsafe codes", () => {
    expect(safeDiscordErrorCode(new Error("private token-like detail"))).toBe("discord_operation_failed");
    const error = Object.assign(new Error("not logged"), { code: "secret.value" });
    expect(safeDiscordErrorCode(error)).toBe("discord_operation_failed");
  });

  it("stops safely when causes contain a cycle", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(safeDiscordErrorCode(error)).toBe("discord_operation_failed");
  });
});
