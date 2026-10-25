import { describe, expect, it, vi } from "vitest";
import { previousSendMessagesState, restoredSendMessagesValue, withAuditPrecondition } from "./lockdown";

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

describe("lockdown audit precondition", () => {
  it("records the attempt before running a side effect", async () => {
    const calls: string[] = [];
    const result = await withAuditPrecondition(
      async () => { calls.push("audit"); return true; },
      async () => { calls.push("effect"); return "done"; },
    );
    expect(calls).toEqual(["audit", "effect"]);
    expect(result).toEqual({ ok: true, value: "done" });
  });

  it("blocks the side effect when the audit precondition is unavailable", async () => {
    const effect = vi.fn(async () => "done");
    const result = await withAuditPrecondition(async () => false, effect);
    expect(result).toEqual({ ok: false });
    expect(effect).not.toHaveBeenCalled();
  });
});
