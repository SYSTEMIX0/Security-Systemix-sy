import { describe, expect, it } from "vitest";
import { canManageTicket, cleanTicketChannelName } from "./tickets";

describe("ticket safety helpers", () => {
  it("only lets opener or staff close a ticket", () => {
    expect(canManageTicket("opener", "opener", false)).toBe(true);
    expect(canManageTicket("other", "opener", false)).toBe(false);
    expect(canManageTicket("staff", "opener", true)).toBe(true);
  });

  it("normalizes channel names and falls back when no safe characters remain", () => {
    expect(cleanTicketChannelName("Ticket: Foo / Bar" )).toBe("ticket-foo-bar");
    expect(cleanTicketChannelName("🔥🔥")).toBe("ticket");
    expect(cleanTicketChannelName("A".repeat(80))).toHaveLength(40);
  });
});
