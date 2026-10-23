import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  AutoModerationActionExecution,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildAuditLogsEntry,
  GuildMember,
  Message,
  ModalSubmitInteraction,
  PartialGuildMember,
  PartialMessage,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  VoiceState,
} from "discord.js";

export type CommandJSON = RESTPostAPIChatInputApplicationCommandsJSONBody;

/** Gateway events fanned out to every module that implements the hook. */
export type EventHooks = {
  onMessage: [message: Message<true>];
  onMessageDelete: [message: Message<true> | PartialMessage];
  onMessageUpdate: [before: Message<true> | PartialMessage, after: Message<true>];
  onMemberAdd: [member: GuildMember];
  onMemberRemove: [member: GuildMember | PartialGuildMember];
  onMemberUpdate: [before: GuildMember | PartialGuildMember, after: GuildMember];
  onAuditLog: [entry: GuildAuditLogsEntry, guild: Guild];
  onAutoModAction: [execution: AutoModerationActionExecution];
  onVoiceState: [before: VoiceState, after: VoiceState];
  onGuildCreate: [guild: Guild];
};

export type ComponentInteraction = ButtonInteraction<"cached"> | AnySelectMenuInteraction<"cached">;

export type IntervalTask = {
  name: string;
  everyMs: number;
  run: (client: Client<true>) => Promise<void>;
};

/**
 * A Systemix feature module.
 *
 * - `commands`: slash command JSON registered globally (bulk overwrite on every start).
 * - `onCommand`: called for any chat-input command whose name is in this module's `commands`.
 * - Component and modal interactions are routed by custom ID `sx:<componentPrefix>:<rest>`.
 * - Event hooks run concurrently across modules; errors are caught and logged per module.
 */
export type SystemixModule = {
  name: string;
  /** Set true only when the module has real, tested live handlers; placeholders stay false. */
  implemented?: boolean;
  commands?: CommandJSON[];
  onCommand?: (interaction: ChatInputCommandInteraction<"cached">) => Promise<void>;
  onAutocomplete?: (interaction: AutocompleteInteraction<"cached">) => Promise<void>;
  componentPrefix?: string;
  onComponent?: (interaction: ComponentInteraction) => Promise<void>;
  onModal?: (interaction: ModalSubmitInteraction<"cached">) => Promise<void>;
  onReady?: (client: Client<true>) => Promise<void> | void;
  intervals?: IntervalTask[];
} & { [K in keyof EventHooks]?: (...args: EventHooks[K]) => Promise<void> | void };

/** Builds a routed custom ID. Keep the total under Discord's 100-character limit. */
export function customId(prefix: string, ...parts: Array<string | number>): string {
  const value = ["sx", prefix, ...parts.map(String)].join(":");
  if (value.length > 100) throw new Error("custom_id_too_long");
  return value;
}

/** Splits a routed custom ID into its parts after `sx:<prefix>:`. */
export function parseCustomId(value: string): { prefix: string; parts: string[] } | null {
  const segments = value.split(":");
  if (segments.length < 2 || segments[0] !== "sx") return null;
  return { prefix: segments[1], parts: segments.slice(2) };
}
