import { describe, expect, it } from "vitest";
import { canUseDelegationRole, isGrantActor } from "./delegation";

describe("capability delegation", () => {
  it("permits only configured non-protected roles", () => {
    expect(canUseDelegationRole("role-a", ["role-a", "role-b"], ["role-b"])).toBe(true);
    expect(canUseDelegationRole("role-b", ["role-a", "role-b"], ["role-b"])).toBe(false);
    expect(canUseDelegationRole("role-c", ["role-a"], [])).toBe(false);
  });

  it("requires one explicitly authorized actor role", () => {
    expect(isGrantActor(["staff", "helper"], ["helper"])).toBe(true);
    expect(isGrantActor(["member"], ["helper"])).toBe(false);
  });
});
