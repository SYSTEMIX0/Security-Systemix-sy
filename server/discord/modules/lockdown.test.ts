import { describe, expect, it } from "vitest";
import { previousSendMessagesState, restoredSendMessagesValue } from "./lockdown";

describe("lockdown overwrite preservation", () => {
  it("restores allow, deny and inherited permissions exactly", () => {
    expect(restoredSendMessagesValue(previousSendMessagesState(true, false))).toBe(true);
    expect(restoredSendMessagesValue(previousSendMessagesState(false, true))).toBe(false);
    expect(restoredSendMessagesValue(previousSendMessagesState(false, false))).toBeNull();
  });

  it("treats an allow bit as the original state when malformed input contains both bits", () => {
    expect(previousSendMessagesState(true, true)).toBe("allow");
  });
});
