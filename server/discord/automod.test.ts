import { describe, expect, it, vi } from "vitest";
import type { Guild } from "discord.js";
import { applyNativeAutoModRules, AutoModRuleConflict, isSystemixAutoModRule } from "./automod";
import { defaultGuildSecurityConfig } from "./config";

function makeRule(name: string, creatorId: string, enabled = true) {
  const rule = {
    id: `rule-${name}`,
    name,
    creatorId,
    enabled,
    edit: vi.fn(async (patch: { enabled?: boolean }) => {
      Object.assign(rule, patch);
      return rule;
    }),
  };
  return rule;
}

function makeGuild(rules: ReturnType<typeof makeRule>[]) {
  const manager = {
    fetch: vi.fn().mockResolvedValue(rules),
    create: vi.fn(async (options: { name: string }) => makeRule(options.name, "systemix-bot")),
  };
  const guild = {
    client: { user: { id: "systemix-bot" } },
    autoModerationRules: manager,
  } as unknown as Guild;
  return { guild, manager };
}

describe("Discord AutoMod synchronization", () => {
  it("recognizes only exact Systemix rule names owned by this bot", () => {
    expect(isSystemixAutoModRule({ name: "Systemix — روابط ودعوات", creatorId: "systemix-bot" }, "systemix-bot")).toBe(true);
    expect(isSystemixAutoModRule({ name: "Systemix — روابط ودعوات", creatorId: "human-moderator" }, "systemix-bot")).toBe(false);
    expect(isSystemixAutoModRule({ name: "Community rule", creatorId: "systemix-bot" }, "systemix-bot")).toBe(false);
  });

  it("disables only enabled Systemix-owned rules when the saved module is off", async () => {
    const owned = makeRule("Systemix — روابط ودعوات", "systemix-bot");
    const other = makeRule("Community rule", "human-moderator");
    const { guild, manager } = makeGuild([owned, other]);
    const disabledConfig = {
      ...defaultGuildSecurityConfig,
      autoMod: { ...defaultGuildSecurityConfig.autoMod, enabled: false },
    };

    const changes = await applyNativeAutoModRules(guild, disabledConfig);

    expect(owned.edit).toHaveBeenCalledOnce();
    expect(owned.edit).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(owned.enabled).toBe(false);
    expect(other.edit).not.toHaveBeenCalled();
    expect(manager.create).not.toHaveBeenCalled();
    expect(changes.map((change) => change.action)).toEqual(["disabled"]);
  });

  it("does not overwrite a same-name rule created by someone else", async () => {
    const other = makeRule("Systemix — روابط ودعوات", "human-moderator");
    const { guild, manager } = makeGuild([other]);
    const enabledConfig = {
      ...defaultGuildSecurityConfig,
      autoMod: {
        ...defaultGuildSecurityConfig.autoMod,
        enabled: true,
        blockInvites: true,
      },
    };

    await expect(applyNativeAutoModRules(guild, enabledConfig)).rejects.toBeInstanceOf(AutoModRuleConflict);
    expect(other.edit).not.toHaveBeenCalled();
    expect(manager.create).not.toHaveBeenCalled();
  });

  it("creates the selected native Discord rule only after an enabled configuration is applied", async () => {
    const { guild, manager } = makeGuild([]);
    const enabledConfig = {
      ...defaultGuildSecurityConfig,
      autoMod: {
        ...defaultGuildSecurityConfig.autoMod,
        enabled: true,
        blockInvites: true,
      },
    };

    const changes = await applyNativeAutoModRules(guild, enabledConfig);

    expect(manager.create).toHaveBeenCalledOnce();
    expect(manager.create).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(changes.map((change) => change.action)).toEqual(["created"]);
  });
});
