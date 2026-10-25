import {
  Client,
  Events,
  GatewayIntentBits,
  Options,
  Partials,
  type ApplicationCommandData,
  type ApplicationCommandDataResolvable,
} from "discord.js";
import { logSafe } from "./core/context";
import { allCommands, dispatch, implementedModuleNames, intervalTasks, moduleNames, routeInteraction, runReadyHooks } from "./core/registry";
import { discordClientId } from "./oauth";
import { matchesDiscordApplicationId, safeDiscordErrorCode } from "./security";
import { bumpStat, flushStats } from "./store/stats";
import { commandSyncRetryDelay } from "./command-sync";

export type DiscordBotState = {
  status: "not_configured" | "disabled_by_policy" | "blocked_by_readiness" | "connecting" | "ready" | "degraded";
  readyAt: string | null;
  guildCount: number;
  memberIntentEnabled: boolean;
  messageContentIntentEnabled: boolean;
  lastErrorCode: string | null;
  commandCount: number | null;
  commandSyncStatus: "not_started" | "pending" | "synced" | "failed";
  commandSyncErrorCode: string | null;
  moduleCount: number;
  implementedModules: string[];
  totalModuleCount: number;
  pingMs: number | null;
};

const runtimeState: DiscordBotState = {
  status: "not_configured",
  readyAt: null,
  guildCount: 0,
  memberIntentEnabled: false,
  messageContentIntentEnabled: false,
  lastErrorCode: null,
  commandCount: null,
  commandSyncStatus: "not_started",
  commandSyncErrorCode: null,
  moduleCount: implementedModuleNames().length,
  implementedModules: implementedModuleNames(),
  totalModuleCount: moduleNames().length,
  pingMs: null,
};

let client: Client | null = null;
let startPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
const timers: ReturnType<typeof setInterval>[] = [];
const commandSyncInFlight = new WeakSet<Client>();
const commandSyncRetryAttempts = new WeakMap<Client, number>();
const commandSyncRetryTimers = new WeakMap<Client, ReturnType<typeof setTimeout>>();

const BASE_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildExpressions,
  GatewayIntentBits.AutoModerationConfiguration,
  GatewayIntentBits.AutoModerationExecution,
];

type IntentPlan = { members: boolean; content: boolean };

/** Privileged intents are negotiated independently so one unavailable intent does not disable the other. */
export function getIntentPlans(value: string | undefined): IntentPlan[] {
  const policy = (value ?? "auto").toLowerCase();
  if (policy === "none") return [{ members: false, content: false }];
  if (policy === "members") return [{ members: true, content: false }, { members: false, content: false }];
  return [
    { members: true, content: true },
    { members: true, content: false },
    { members: false, content: true },
    { members: false, content: false },
  ];
}

function intentPlans(): IntentPlan[] {
  return getIntentPlans(process.env.SYSTEMIX_PRIVILEGED_INTENTS);
}

export function getDiscordClient(): Client | null {
  return client;
}

export function getDiscordBotState(): DiscordBotState {
  return {
    ...runtimeState,
    guildCount: client?.guilds.cache.size ?? runtimeState.guildCount,
    pingMs: client?.ws.ping && client.ws.ping > 0 ? Math.round(client.ws.ping) : null,
  };
}

export function blockDiscordBotForReadiness(code: string): void {
  runtimeState.status = "blocked_by_readiness";
  runtimeState.readyAt = null;
  runtimeState.guildCount = 0;
  runtimeState.memberIntentEnabled = false;
  runtimeState.messageContentIntentEnabled = false;
  runtimeState.lastErrorCode = code.slice(0, 80);
  runtimeState.commandCount = null;
  runtimeState.commandSyncStatus = "not_started";
  runtimeState.commandSyncErrorCode = null;
}

function isIntentRejection(error: unknown): boolean {
  const code = safeDiscordErrorCode(error);
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /intent/i.test(code) || /intent/i.test(message) || /4014/.test(message);
}

async function loginAndWaitForReady(bot: Client, token: string, timeoutMs = 25_000): Promise<void> {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (error) rejectReady(error);
    else resolveReady();
  };
  const onReady = () => finish();
  const onError = (error: Error) => {
    if (isIntentRejection(error)) finish(error);
  };
  const onDisconnect = (event: { code: number }) => {
    if (event.code === 4014) finish(new Error("Discord rejected privileged intents (4014)"));
    else if (event.code === 4004) finish(new Error("Discord rejected bot authentication (4004)"));
  };

  bot.once(Events.ClientReady, onReady);
  bot.on(Events.Error, onError);
  bot.on(Events.ShardDisconnect, onDisconnect);
  timer = setTimeout(() => finish(new Error(`Discord Gateway READY timeout after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();
  try {
    await Promise.all([bot.login(token), ready]);
  } finally {
    if (timer) clearTimeout(timer);
    bot.off(Events.ClientReady, onReady);
    bot.off(Events.Error, onError);
    bot.off(Events.ShardDisconnect, onDisconnect);
  }
}

async function registerCommands(bot: Client<true>): Promise<void> {
  if (client !== bot || commandSyncInFlight.has(bot)) return;
  commandSyncInFlight.add(bot);
  const previousSyncErrorCode = runtimeState.commandSyncErrorCode;
  runtimeState.commandSyncStatus = "pending";
  runtimeState.commandSyncErrorCode = null;
  const pendingRetry = commandSyncRetryTimers.get(bot);
  if (pendingRetry) clearTimeout(pendingRetry);
  commandSyncRetryTimers.delete(bot);
  try {
    // Upsert only commands owned by these modules. A bulk `set()` can silently delete
    // unrelated commands belonging to the same application, so stale commands are not
    // removed automatically; an explicit migration can review removals later.
    const manager = bot.application.commands;
    const existing = await manager.fetch();
    if (client !== bot) return;
    runtimeState.commandCount = existing.size;
    const commands = allCommands();
    let created = 0;
    let updated = 0;
    for (const desired of commands) {
      if (client !== bot) return;
      const desiredType = desired.type ?? 1;
      const createPayload = desired as unknown as ApplicationCommandDataResolvable;
      const editPayload = desired as unknown as Partial<ApplicationCommandData>;
      const current = existing.find((command) => command.name === desired.name && command.type === desiredType);
      if (!current) {
        await manager.create(createPayload);
        created += 1;
        runtimeState.commandCount = existing.size + created;
        continue;
      }
      const before = commandFingerprint(current.toJSON() as unknown as Record<string, unknown>);
      const after = commandFingerprint(desired as unknown as Record<string, unknown>);
      if (before !== after) {
        await current.edit(editPayload);
        updated += 1;
      }
    }
    runtimeState.commandCount = existing.size + created;
    runtimeState.commandSyncStatus = "synced";
    runtimeState.commandSyncErrorCode = null;
    if (previousSyncErrorCode && runtimeState.lastErrorCode === previousSyncErrorCode) runtimeState.lastErrorCode = null;
    commandSyncRetryAttempts.delete(bot);
    console.info(`[Discord] Slash commands synchronized safely: ${created} created, ${updated} updated, ${existing.size - updated} retained`);
  } catch (error) {
    if (client !== bot) return;
    const errorCode = safeDiscordErrorCode(error);
    runtimeState.commandSyncStatus = "failed";
    runtimeState.commandSyncErrorCode = errorCode;
    runtimeState.lastErrorCode = errorCode;
    logSafe("Slash command registration failed", error);
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;
    const attempt = commandSyncRetryAttempts.get(bot) ?? 0;
    const delay = commandSyncRetryDelay(errorCode, status, attempt);
    if (delay !== null && runtimeState.status === "ready") {
      commandSyncRetryAttempts.set(bot, attempt + 1);
      const timer = setTimeout(() => {
        commandSyncRetryTimers.delete(bot);
        if (client === bot && runtimeState.status === "ready") void registerCommands(bot);
      }, delay);
      timer.unref?.();
      commandSyncRetryTimers.set(bot, timer);
    }
  } finally {
    commandSyncInFlight.delete(bot);
  }
}

function commandFingerprint(value: Record<string, unknown>): string {
  const comparableKeys = [
    "type", "name", "description", "options", "default_member_permissions",
    "dm_permission", "nsfw", "contexts", "integration_types",
    "name_localizations", "description_localizations",
  ];
  const comparable: Record<string, unknown> = {};
  for (const key of comparableKeys) {
    const entry = value[key];
    if (entry !== undefined) comparable[key] = entry;
  }
  if (comparable.type === undefined) comparable.type = 1;
  return stableJson(comparable);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function startIntervals(bot: Client<true>): void {
  stopIntervals();
  const flush = setInterval(() => void flushStats(), 30_000);
  flush.unref?.();
  timers.push(flush);
  for (const task of intervalTasks()) {
    const timer = setInterval(() => {
      if (client !== bot || runtimeState.status !== "ready") return;
      task.run(bot).catch((error) => logSafe(`${task.module}.${task.name} interval failed`, error));
    }, Math.max(5_000, task.everyMs));
    timer.unref?.();
    timers.push(timer);
  }
}

function stopIntervals(): void {
  while (timers.length) clearInterval(timers.pop()!);
}

function createClient(plan: IntentPlan): Client {
  const intents = [...BASE_INTENTS];
  if (plan.members) intents.push(GatewayIntentBits.GuildMembers);
  if (plan.content) intents.push(GatewayIntentBits.MessageContent);
  const bot = new Client({
    intents,
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User, Partials.Reaction],
    allowedMentions: { parse: [], repliedUser: false },
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 200,
      ReactionManager: 0,
      PresenceManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 900, lifetime: 3_600 },
    },
  });

  bot.once(Events.ClientReady, (readyClient) => {
    if (!matchesDiscordApplicationId(discordClientId(), readyClient.user.id)) {
      runtimeState.status = "degraded";
      runtimeState.readyAt = null;
      runtimeState.guildCount = 0;
      runtimeState.lastErrorCode = "bot_application_id_mismatch";
      runtimeState.commandSyncStatus = "failed";
      runtimeState.commandSyncErrorCode = "bot_application_id_mismatch";
      logSafe("Bot identity does not match the configured Discord application ID");
      void bot.destroy();
      if (client === bot) client = null;
      return;
    }
    runtimeState.status = "ready";
    runtimeState.readyAt = new Date().toISOString();
    runtimeState.guildCount = readyClient.guilds.cache.size;
    runtimeState.lastErrorCode = null;
    runtimeState.memberIntentEnabled = plan.members;
    runtimeState.messageContentIntentEnabled = plan.content;
    retryCount = 0;
    console.info(`[Discord] Gateway ready for ${runtimeState.guildCount} guild(s); members=${plan.members} content=${plan.content}`);
    void registerCommands(readyClient);
    startIntervals(readyClient);
    void runReadyHooks(readyClient);
  });

  bot.on(Events.GuildCreate, (guild) => {
    runtimeState.guildCount = bot.guilds.cache.size;
    void dispatch("onGuildCreate", guild);
  });
  bot.on(Events.GuildDelete, () => {
    runtimeState.guildCount = bot.guilds.cache.size;
  });
  bot.on(Events.ShardDisconnect, () => {
    if (runtimeState.status === "ready") runtimeState.status = "connecting";
  });
  bot.on(Events.ShardReconnecting, () => {
    if (runtimeState.status !== "degraded") runtimeState.status = "connecting";
  });
  bot.on(Events.ShardResume, () => {
    runtimeState.status = "ready";
    runtimeState.readyAt ??= new Date().toISOString();
    runtimeState.guildCount = bot.guilds.cache.size;
  });
  bot.on(Events.ShardReady, () => {
    if (runtimeState.readyAt) runtimeState.status = "ready";
  });
  bot.on(Events.Invalidated, () => {
    runtimeState.status = "degraded";
    runtimeState.lastErrorCode = "session_invalidated";
  });
  bot.on(Events.Error, (error) => {
    runtimeState.lastErrorCode = safeDiscordErrorCode(error);
    logSafe("Gateway error", error);
  });

  bot.on(Events.InteractionCreate, (interaction) => void routeInteraction(interaction));
  bot.on(Events.MessageCreate, (message) => {
    if (!message.inGuild() || message.author.id === bot.user?.id) return;
    bumpStat(message.guildId, "messages");
    void dispatch("onMessage", message);
  });
  bot.on(Events.MessageDelete, (message) => {
    if (!message.guildId || message.author?.id === bot.user?.id) return;
    void dispatch("onMessageDelete", message as never);
  });
  bot.on(Events.MessageUpdate, (before, after) => {
    if (!after.inGuild() || after.author?.id === bot.user?.id) return;
    void dispatch("onMessageUpdate", before as never, after);
  });
  bot.on(Events.GuildMemberAdd, (member) => {
    bumpStat(member.guild.id, "joins");
    void dispatch("onMemberAdd", member);
  });
  bot.on(Events.GuildMemberRemove, (member) => {
    bumpStat(member.guild.id, "leaves");
    void dispatch("onMemberRemove", member);
  });
  bot.on(Events.GuildMemberUpdate, (before, after) => void dispatch("onMemberUpdate", before, after));
  bot.on(Events.GuildAuditLogEntryCreate, (entry, guild) => void dispatch("onAuditLog", entry, guild));
  bot.on(Events.AutoModerationActionExecution, (execution) => void dispatch("onAutoModAction", execution));
  bot.on(Events.VoiceStateUpdate, (before, after) => void dispatch("onVoiceState", before, after));
  return bot;
}

function scheduleRetry(): void {
  if (retryTimer || retryCount >= 5) return;
  retryCount += 1;
  const delay = Math.min(60_000, 5_000 * 2 ** (retryCount - 1));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void startDiscordBot();
  }, delay);
  retryTimer.unref?.();
}

export async function startDiscordBot(): Promise<void> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    if (!token) {
      runtimeState.status = "not_configured";
      return;
    }
    if (process.env.NODE_ENV === "production" && process.env.SYSTEMIX_ENABLE_PRODUCTION_GATEWAY !== "true") {
      runtimeState.status = "disabled_by_policy";
      return;
    }
    runtimeState.status = "connecting";
    runtimeState.readyAt = null;
    runtimeState.guildCount = 0;
    runtimeState.lastErrorCode = null;
    runtimeState.commandCount = null;
    runtimeState.commandSyncStatus = "not_started";
    runtimeState.commandSyncErrorCode = null;
    runtimeState.memberIntentEnabled = false;
    runtimeState.messageContentIntentEnabled = false;
    const plans = intentPlans();
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const bot = createClient(plan);
      client = bot;
      try {
        await loginAndWaitForReady(bot, token);
        return;
      } catch (error) {
        const errorCode = safeDiscordErrorCode(error);
        await bot.destroy().catch(() => undefined);
        if (client === bot) client = null;
        if (isIntentRejection(error) && index < plans.length - 1) {
          logSafe(`Privileged intents rejected (members=${plan.members}, content=${plan.content}); retrying with fewer`);
          continue;
        }
        runtimeState.status = "degraded";
        runtimeState.lastErrorCode = errorCode;
        logSafe("Gateway login failed", error);
        startPromise = null;
        const message = error instanceof Error ? error.message : String(error ?? "");
        const permanent = ["discord_http_401", "discord_http_403", "tokeninvalid"].some((code) => errorCode.includes(code)) || /4004/.test(message) || isIntentRejection(error);
        if (!permanent) scheduleRetry();
        return;
      }
    }
  })();
  return startPromise;
}

export async function stopDiscordBot(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  stopIntervals();
  await flushStats().catch(() => undefined);
  if (client) {
    const stoppingClient = client;
    const syncTimer = commandSyncRetryTimers.get(stoppingClient);
    if (syncTimer) clearTimeout(syncTimer);
    commandSyncRetryTimers.delete(stoppingClient);
    commandSyncRetryAttempts.delete(stoppingClient);
    await stoppingClient.destroy().catch(() => undefined);
    client = null;
  }
  runtimeState.status = process.env.DISCORD_BOT_TOKEN ? "disabled_by_policy" : "not_configured";
  runtimeState.readyAt = null;
  runtimeState.guildCount = 0;
  runtimeState.commandCount = null;
  runtimeState.commandSyncStatus = "not_started";
  runtimeState.commandSyncErrorCode = null;
  startPromise = null;
}
