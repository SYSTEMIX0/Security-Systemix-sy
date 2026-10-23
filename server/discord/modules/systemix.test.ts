import { describe, expect, it } from "vitest";
import { missingBotPermissions } from "./systemix";

describe("Systemix permission doctor", () => {
  it("only reports permissions required by enabled modules", () => {
    expect(missingBotPermissions({
      antiNuke: false, lockdown: false, autoMod: false, moderation: false, roleManagement: false,
      hasViewAuditLog: false, hasManageChannels: false, hasManageGuild: false,
      hasManageRoles: false, hasModerateMembers: false, hasKickMembers: false, hasBanMembers: false,
    })).toEqual([]);
  });

  it("deduplicates required role-management permission and lists required capabilities", () => {
    expect(missingBotPermissions({
      antiNuke: true, lockdown: true, autoMod: true, moderation: true, roleManagement: true,
      hasViewAuditLog: false, hasManageChannels: false, hasManageGuild: false,
      hasManageRoles: false, hasModerateMembers: false, hasKickMembers: false, hasBanMembers: false,
    })).toEqual(["View Audit Log", "Manage Channels", "Manage Guild", "Moderate Members", "Kick Members", "Ban Members", "Manage Roles"]);
  });
});
