import { describe, expect, it } from "vitest";
import { isTicketTranscriptParticipant, parseTicketTranscript, renderTranscriptPage } from "./transcript-page";

const ticket = {
  id: 42,
  guildId: "123456789012345678",
  ticketNumber: 7,
  openerId: "111111111111111111",
  claimedById: "222222222222222222",
  closedById: "333333333333333333",
  topic: "technical-support",
  createdAt: new Date("2026-10-26T18:00:00.000Z"),
  closedAt: new Date("2026-10-26T18:05:00.000Z"),
  status: "closed",
  channelId: "444444444444444444",
  transcript: "",
  messageCount: 1,
} as never;

describe("protected ticket transcript page", () => {
  it("allows only ticket participants through the direct participant check", () => {
    expect(isTicketTranscriptParticipant(ticket, "111111111111111111")).toBe(true);
    expect(isTicketTranscriptParticipant(ticket, "222222222222222222")).toBe(true);
    expect(isTicketTranscriptParticipant(ticket, "333333333333333333")).toBe(true);
    expect(isTicketTranscriptParticipant(ticket, "999999999999999999")).toBe(false);
  });

  it("parses only the bounded Systemix shape and strips unsafe attachment values", () => {
    const parsed = parseTicketTranscript(JSON.stringify({
      version: 1,
      channelName: "ticket-support-7",
      exportedAt: "2026-10-26T18:05:00.000Z",
      truncated: false,
      messages: [{
        authorId: "111111111111111111",
        authorName: "<img src=x>",
        bot: false,
        content: "<script>alert('x')</script>",
        attachments: ["private-file.png", 12, { url: "https://not-kept.example" }],
        createdAt: "2026-10-26T18:01:00.000Z",
      }],
    }));
    expect(parsed?.messages[0]?.attachments).toEqual(["private-file.png"]);
    const html = renderTranscriptPage(ticket, parsed!);
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("https://not-kept.example");
  });

  it("rejects malformed or unknown transcript payloads", () => {
    expect(parseTicketTranscript("not json")).toBeNull();
    expect(parseTicketTranscript(JSON.stringify({ version: 2, messages: [] }))).toBeNull();
  });
});
