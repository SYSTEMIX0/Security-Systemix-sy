import { describe, expect, it } from "vitest";
import { MAX_BACKUP_BYTES, serializeGuildStructure } from "./backups";

describe("structural backup serialization", () => {
  it("whitelists roles, channels and overwrites without exporting unknown private fields", () => {
    const input = {
      roles: [{
        id: "role-1", name: "Member", permissions: "0", position: 1, color: 0,
        hoist: false, mentionable: false, managed: false, messageContent: "private",
      }],
      channels: [{
        id: "channel-1", name: "general", type: 0, parentId: null, position: 1,
        topic: "Rules", overwrites: [{ id: "role-1", type: 0, allow: "0", deny: "0" }],
        lastMessageContent: "private",
      }],
    } as never;
    const result = serializeGuildStructure(input);
    expect(result.roleCount).toBe(1);
    expect(result.channelCount).toBe(1);
    expect(result.data).not.toContain("private");
    expect(JSON.parse(result.data).version).toBe(1);
  });

  it("rejects a snapshot that exceeds the explicit one-megabyte limit", () => {
    const result = () => serializeGuildStructure({
      roles: [],
      channels: [{
        id: "c", name: "c", type: 0, parentId: null, position: 0,
        topic: "x".repeat(MAX_BACKUP_BYTES + 10), overwrites: [],
      }],
    });
    expect(result).toThrow("backup_size_limit");
  });
});
