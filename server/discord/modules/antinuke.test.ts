import { AuditLogEvent } from "discord.js";
import { describe, expect, it } from "vitest";
import { advanceNukeWindow, mapAuditAction } from "./antinuke";

describe("Anti-Nuke audit mapping and threshold windows", () => {
  it("maps protected audit actions and ignores unrelated event types", () => {
    expect(mapAuditAction(AuditLogEvent.ChannelDelete)).toBe("channel_delete");
    expect(mapAuditAction(AuditLogEvent.GuildUpdate)).toBe("guild_update");
    expect(mapAuditAction(AuditLogEvent.EmojiDelete)).toBe("emoji_delete");
    expect(mapAuditAction(AuditLogEvent.MessagePin)).toBeNull();
  });

  it("triggers once when the threshold is crossed, then allows a fresh incident after the window", () => {
    let state = { samples: [] as number[], lastTriggeredAt: Number.NEGATIVE_INFINITY };
    for (const now of [1_000, 2_000]) {
      const result = advanceNukeWindow(state, now, 10_000, 3);
      state = result.state;
      expect(result.triggered).toBe(false);
    }
    const crossing = advanceNukeWindow(state, 3_000, 10_000, 3);
    state = crossing.state;
    expect(crossing.triggered).toBe(true);
    expect(crossing.count).toBe(3);
    const repeated = advanceNukeWindow(state, 4_000, 10_000, 3);
    expect(repeated.triggered).toBe(false);
    let next = advanceNukeWindow(state, 20_000, 10_000, 3);
    expect(next.triggered).toBe(false);
    next = advanceNukeWindow(next.state, 21_000, 10_000, 3);
    expect(next.triggered).toBe(false);
    next = advanceNukeWindow(next.state, 22_000, 10_000, 3);
    expect(next.triggered).toBe(true);
  });
});
