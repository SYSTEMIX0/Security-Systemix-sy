import { describe, expect, it } from "vitest";
import { defaultGuildSecurityConfig } from "../config";
import { evaluateSpamEdit, evaluateSpamMessage, extractLinkDomains } from "./antispam";

const base = defaultGuildSecurityConfig.antiSpam;
const empty = { messages: [] as number[], hashes: [] as Array<{ hash: string; at: number }>, lastActionAt: 0, lastAlertAt: 0 };

describe("Anti-Spam privacy-safe signals", () => {
  it("normalizes URL hosts and detects allowed subdomains", () => {
    expect(extractLinkDomains("see https://bad.example/path and www.safe.test/page")).toEqual(["bad.example", "safe.test"]);
    const result = evaluateSpamMessage({
      previous: empty, now: 1_000, content: "https://sub.safe.test/ok", userMentions: 0, roleMentions: 0,
      mentionEveryone: false, config: { ...base, blockLinks: true, allowedDomains: ["safe.test"] },
    });
    expect(result.flags).not.toContain("blocked_link");
  });

  it("flags repeated content by in-memory hash but returns no raw message text", () => {
    const config = { ...base, duplicateLimit: 2 };
    const first = evaluateSpamMessage({
      previous: empty, now: 1_000, content: "same text", userMentions: 0, roleMentions: 0,
      mentionEveryone: false, config,
    });
    const second = evaluateSpamMessage({
      previous: first.next, now: 2_000, content: "SAME   TEXT", userMentions: 0, roleMentions: 0,
      mentionEveryone: false, config,
    });
    expect(second.flags).toContain("duplicate_content");
    expect(JSON.stringify(second.next)).not.toContain("same text");
  });

  it("does not increment the message-rate count for an edit and detects a blocked link", () => {
    const previous = { ...empty, messages: [900, 950] };
    const result = evaluateSpamEdit({
      previous, now: 1_000, content: "visit https://bad.example/path", userMentions: 0, roleMentions: 0,
      mentionEveryone: false, config: { ...base, maxMessages: 1, blockLinks: true, allowedDomains: [] },
    });
    expect(result.messageCount).toBe(2);
    expect(result.next.messages).toEqual(previous.messages);
    expect(result.flags).not.toContain("message_rate");
    expect(result.flags).toContain("blocked_link");
  });

  it("detects mention and caps signals in edited content", () => {
    const result = evaluateSpamEdit({
      previous: empty, now: 1_000, content: "THIS IS A VERY LOUD MESSAGE", userMentions: 2, roleMentions: 0,
      mentionEveryone: false, config: { ...base, maxMentions: 2, capsPercent: 80 },
    });
    expect(result.flags).toContain("mention_burst");
    expect(result.flags).toContain("excessive_caps");
  });

  it("detects edited content duplicated against the existing in-memory sample", () => {
    const config = { ...base, duplicateLimit: 2 };
    const original = evaluateSpamMessage({
      previous: empty, now: 1_000, content: "same edited text", userMentions: 0, roleMentions: 0,
      mentionEveryone: false, config,
    });
    const edited = evaluateSpamEdit({
      previous: original.next, now: 2_000, content: "SAME EDITED TEXT", userMentions: 0, roleMentions: 0,
      mentionEveryone: false, config,
    });
    expect(edited.flags).toContain("duplicate_content");
    expect(edited.messageCount).toBe(1);
    expect(edited.next.messages).toEqual(original.next.messages);
  });

  it("applies no cap or mention threshold when their configured limits are zero", () => {
    const result = evaluateSpamMessage({
      previous: empty, now: 1_000, content: "HELLO WORLD THIS IS A VERY LONG TEST", userMentions: 50,
      roleMentions: 50, mentionEveryone: true, config: { ...base, capsPercent: 0, maxMentions: 0 },
    });
    expect(result.flags).not.toContain("excessive_caps");
    expect(result.flags).not.toContain("mention_burst");
  });
});
