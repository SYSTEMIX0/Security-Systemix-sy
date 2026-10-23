import { describe, expect, it } from "vitest";
import { isHoneypotMessage } from "./honeypot";

describe("honeypot channel matching", () => {
  it("requires enabled state and an exact configured channel match", () => {
    expect(isHoneypotMessage(true, "123", "123")).toBe(true);
    expect(isHoneypotMessage(false, "123", "123")).toBe(false);
    expect(isHoneypotMessage(true, null, "123")).toBe(false);
    expect(isHoneypotMessage(true, "123", "456")).toBe(false);
  });
});
