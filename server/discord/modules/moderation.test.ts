import { describe, expect, it } from "vitest";
import { chooseEscalationAction } from "./moderation";

describe("moderation warning escalation", () => {
  it("prefers the strongest configured threshold", () => {
    expect(chooseEscalationAction(5, { enabled: true, timeoutAt: 3, kickAt: 4, banAt: 5 })).toBe("ban");
    expect(chooseEscalationAction(4, { enabled: true, timeoutAt: 3, kickAt: 4, banAt: 0 })).toBe("kick");
    expect(chooseEscalationAction(3, { enabled: true, timeoutAt: 3, kickAt: 0, banAt: 0 })).toBe("timeout");
  });

  it("keeps escalation disabled unless explicitly enabled", () => {
    expect(chooseEscalationAction(100, { enabled: false, timeoutAt: 1, kickAt: 2, banAt: 3 })).toBeNull();
    expect(chooseEscalationAction(1, { enabled: true, timeoutAt: 0, kickAt: 0, banAt: 0 })).toBeNull();
  });
});
