import { describe, expect, it } from "vitest";
import { defaultGuildSecurityConfig } from "../config";
import { evaluateSpamMessage, extractLinkDomains } from "./antispam";

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

  it("applies no cap or mention threshold when their configured limits are zero", () => {
    const result = evaluateSpamMessage({
      previous: empty, now: 1_000, content: "HELLO WORLD THIS IS A VERY LONG TEST", userMentions: 50,
      roleMentions: 50, mentionEveryone: true, config: { ...base, capsPercent: 0, maxMentions: 0 },
    });
    expect(result.flags).not.toContain("excessive_caps");
    expect(result.flags).not.toContain("mention_burst");
  });
});
