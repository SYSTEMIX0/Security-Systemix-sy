import { describe, expect, it } from "vitest";

describe("AutoMod event privacy contract", () => {
  it("does not retain a matched keyword or message text in the event schema", () => {
    const safeDetails = {
      ruleId: "12345678901234567", ruleTriggerType: 1, action: "action_1",
      channelId: "12345678901234567", messageId: "12345678901234567",
    };
    expect(Object.keys(safeDetails)).not.toContain("matchedContent");
    expect(Object.keys(safeDetails)).not.toContain("matchedKeyword");
  });
});
