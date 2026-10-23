import { describe, expect, it } from "vitest";
import { chunkSelfRoleEntries, isAllowedSelfRole, isValidSelfRolePanelId, parseSelfRoleCustomId } from "./selfroles";

const panel = { roles: [{ roleId: "12345678901234567", label: "One", emoji: "" }, { roleId: "22345678901234567", label: "Two", emoji: "" }] };

describe("self-role boundaries", () => {
  it("only allows role IDs listed in the selected panel", () => {
    expect(isAllowedSelfRole(panel, "12345678901234567")).toBe(true);
    expect(isAllowedSelfRole(panel, "32345678901234567")).toBe(false);
    expect(isAllowedSelfRole(undefined, "12345678901234567")).toBe(false);
  });
  it("validates bounded config panel slugs", () => {
    expect(isValidSelfRolePanelId("community_roles-1")).toBe(true);
    expect(isValidSelfRolePanelId("roles:admin")).toBe(false);
    expect(isValidSelfRolePanelId("a".repeat(25))).toBe(false);
  });
  it("keeps toggle buttons within Discord's five-buttons-per-row limit", () => {
    expect(chunkSelfRoleEntries(Array.from({ length: 25 }, (_, index) => index)).map((row) => row.length)).toEqual([5, 5, 5, 5, 5]);
    expect(chunkSelfRoleEntries([1, 2, 3, 4, 5, 6]).map((row) => row.length)).toEqual([5, 1]);
    expect(() => chunkSelfRoleEntries([1], 6)).toThrow("invalid_chunk_size");
  });
  it("accepts only exactly routed bounded custom IDs", () => {
    expect(parseSelfRoleCustomId("sx:selfroles:colors_1:toggle")).toEqual({ panelId: "colors_1", action: "toggle" });
    expect(parseSelfRoleCustomId("sx:selfroles:colors:select")).toEqual({ panelId: "colors", action: "select" });
    expect(parseSelfRoleCustomId("sx:selfroles:colors:toggle:12345678901234567")).toBeNull();
    expect(parseSelfRoleCustomId("sx:selfroles:colors:delete")).toBeNull();
    expect(parseSelfRoleCustomId(`sx:selfroles:${"a".repeat(24)}:select:extra`)).toBeNull();
    expect(parseSelfRoleCustomId("x:selfroles:colors:select")).toBeNull();
  });
});
