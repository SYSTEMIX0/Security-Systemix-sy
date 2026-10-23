import { describe, expect, it } from "vitest";
import { acceptsSettingsConfirmation, runWithAuditPrecondition } from "./settings-confirmation";

describe("settings mutation confirmation", () => {
  it("rejects missing or unknown confirmation values", () => {
    expect(acceptsSettingsConfirmation(undefined, "observe")).toBe(false);
    expect(acceptsSettingsConfirmation("yes", "observe")).toBe(false);
  });

  it("requires an explicit confirmation for ordinary settings changes", () => {
    expect(acceptsSettingsConfirmation("CONFIRM_SETTINGS", "observe")).toBe(true);
  });

  it("requires the stronger confirmation for active protection mode", () => {
    expect(acceptsSettingsConfirmation("CONFIRM_SETTINGS", "protect")).toBe(false);
    expect(acceptsSettingsConfirmation("ENABLE_PROTECTION", "protect")).toBe(true);
  });

  it("persists only after the audit precondition succeeds", async () => {
    const order: string[] = [];
    const result = await runWithAuditPrecondition(
      async () => { order.push("audit"); },
      async () => { order.push("persist"); return "saved"; },
    );
    expect(result).toEqual({ ok: true, value: "saved" });
    expect(order).toEqual(["audit", "persist"]);
  });

  it("fails closed and never persists when audit recording fails", async () => {
    const order: string[] = [];
    const result = await runWithAuditPrecondition(
      async () => { order.push("audit"); throw new Error("database unavailable"); },
      async () => { order.push("persist"); return "saved"; },
    );
    expect(result).toEqual({ ok: false });
    expect(order).toEqual(["audit"]);
  });
});
