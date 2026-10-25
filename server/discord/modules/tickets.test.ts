import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canManageTicket, cleanTicketChannelName, ticketChannelPrefix, ticketPanelChannelName } from "./tickets";

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

  it("uses a clear and stable channel prefix for each supported ticket type", () => {
    expect(ticketChannelPrefix("open-ticket")).toBe("open-ticket");
    expect(ticketChannelPrefix("middleman-ticket")).toBe("middleman-ticket");
    expect(ticketChannelPrefix("levelup-ticket")).toBe("levelup-ticket");
  });

  it("uses one fixed panel channel per ticket type", () => {
    expect(ticketPanelChannelName("open-ticket")).toBe("🎫・open-ticket");
    expect(ticketPanelChannelName("middleman-ticket")).toBe("🤝・middleman-ticket");
    expect(ticketPanelChannelName("levelup-ticket")).toBe("📈・levelup-ticket");
  });

  it("captures a select value before React schedules its state update", async () => {
    const source = await readFile("client/src/components/ProtectionConsole.tsx", "utf8");
    expect(source).toContain('const mode = event.currentTarget.value as GuildSecurityConfig["mode"];');
    expect(source).toContain("setDraft((current) => current ? { ...current, mode } : current);");
  });

  it("keeps the guided ticket setup command with an explicit support-role", async () => {
    const source = await readFile("server/discord/modules/tickets.ts", "utf8");
    expect(source).toContain('sub.setName("setup")');
    expect(source).toContain('option.setName("support-role")');
    expect(source).toContain('ticketCommand("systemix-tickets")');
    expect(source).toContain('customId("tickets", "open", topic.id)');
    expect(source).toContain("ACTIVE_TICKETS_CATEGORY_NAME");
  });

  it("creates a configurable ticket centre and records lifecycle events without ticket text", async () => {
    const source = await readFile("server/discord/modules/tickets.ts", "utf8");
    expect(source).toContain('TICKET_CENTER_CHANNEL_NAME = "🎟️・ticket-center"');
    expect(source).toContain("new StringSelectMenuBuilder()");
    expect(source).toContain("writeTicketLifecycleLog");
    expect(source).toContain('eventType: "opened"');
    expect(source).toContain('eventType: "claimed"');
    expect(source).toContain('eventType: "closed"');
    expect(source).toContain('customId("tickets", "closeconfirm", ticket.id)');
  });

  it("avoids reusing a ticket category hidden from the bot", async () => {
    const source = await readFile("server/discord/modules/tickets.ts", "utf8");
    expect(source).toContain("hasTicketCategoryAccess(channel, member)");
    expect(source).toContain("PermissionFlagsBits.ViewChannel");
  });
});
