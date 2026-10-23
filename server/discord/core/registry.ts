import type { Client, Interaction } from "discord.js";
import { systemixModules } from "../modules";
import { logSafe, replyEphemeral } from "./context";
import { parseCustomId, type CommandJSON, type EventHooks, type SystemixModule } from "./types";

const commandOwners = new Map<string, SystemixModule>();
const componentOwners = new Map<string, SystemixModule>();

function buildIndexes(): void {
  commandOwners.clear();
  componentOwners.clear();
  for (const module of systemixModules) {
    for (const command of module.commands ?? []) {
      if (commandOwners.has(command.name)) {
        logSafe(`Duplicate slash command "${command.name}" in module ${module.name}; keeping the first owner`);
        continue;
      }
      commandOwners.set(command.name, module);
    }
    if (module.componentPrefix) {
      if (componentOwners.has(module.componentPrefix)) logSafe(`Duplicate component prefix "${module.componentPrefix}"`);
      else componentOwners.set(module.componentPrefix, module);
    }
  }
}
buildIndexes();

export function allCommands(): CommandJSON[] {
  return [...commandOwners.entries()].map(([name, module]) => module.commands!.find((command) => command.name === name)!);
}

export function moduleNames(): string[] {
  return systemixModules.map((module) => module.name);
}

export function implementedModuleNames(): string[] {
  return systemixModules.filter((module) => module.implemented === true).map((module) => module.name);
}

/** Fans a gateway event out to every module implementing the hook, concurrently and isolated. */
export async function dispatch<K extends keyof EventHooks>(hook: K, ...args: EventHooks[K]): Promise<void> {
  const handlers = systemixModules
    .map((module) => ({ module, fn: module[hook] as ((...a: EventHooks[K]) => Promise<void> | void) | undefined }))
    .filter((entry) => typeof entry.fn === "function");
  if (!handlers.length) return;
  await Promise.allSettled(handlers.map(async ({ module, fn }) => {
    try {
      await fn!(...args);
    } catch (error) {
      logSafe(`${module.name}.${hook} failed`, error);
    }
  }));
}

export async function runReadyHooks(client: Client<true>): Promise<void> {
  await Promise.allSettled(systemixModules.map(async (module) => {
    try {
      await module.onReady?.(client);
    } catch (error) {
      logSafe(`${module.name}.onReady failed`, error);
    }
  }));
}

export function intervalTasks() {
  return systemixModules.flatMap((module) => (module.intervals ?? []).map((task) => ({ module: module.name, ...task })));
}

const GENERIC_FAILURE = "تعذر تنفيذ الطلب بسبب خطأ غير متوقع. حاول مرة أخرى، وإن تكرر الخطأ راجع صلاحيات البوت.";

export async function routeInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    if (interaction.isRepliable()) await replyEphemeral(interaction, "أوامر Security Systemix تعمل داخل السيرفرات فقط.");
    return;
  }
  let owner: SystemixModule | undefined;
  try {
    if (interaction.isChatInputCommand()) {
      owner = commandOwners.get(interaction.commandName);
      if (owner?.onCommand) await owner.onCommand(interaction);
      return;
    }
    if (interaction.isAutocomplete()) {
      owner = commandOwners.get(interaction.commandName);
      if (owner?.onAutocomplete) await owner.onAutocomplete(interaction);
      return;
    }
    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
      const parsed = parseCustomId(interaction.customId);
      if (!parsed) return;
      owner = componentOwners.get(parsed.prefix);
      if (!owner) return;
      if (interaction.isModalSubmit()) await owner.onModal?.(interaction);
      else await owner.onComponent?.(interaction);
    }
  } catch (error) {
    logSafe(`Interaction failed in ${owner?.name ?? "unknown"}`, error);
    if (interaction.isRepliable()) await replyEphemeral(interaction, GENERIC_FAILURE);
  }
}
