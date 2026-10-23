import type { SystemixModule } from "../core/types";
import { antiNukeModule } from "./antinuke";
import { antiRaidModule } from "./antiraid";
import { antiSpamModule } from "./antispam";
import { honeypotModule } from "./honeypot";
import { lockdownModule } from "./lockdown";
import { backupsModule } from "./backups";
import { autoModModule } from "./automodEvents";
import { systemixModule } from "./systemix";
import { moderationModule } from "./moderation";
import { loggingModule } from "./logging";
import { verificationModule } from "./verification";
import { delegationModule } from "./delegation";
import { welcomeModule } from "./welcome";
import { selfRolesModule } from "./selfroles";
import { ticketsModule } from "./tickets";
import { levelingModule } from "./leveling";
import { suggestionsModule } from "./suggestions";
import { giveawaysModule } from "./giveaways";
import { utilityModule } from "./utility";

/** Every Systemix module, in dispatch order (security first). */
export const systemixModules: SystemixModule[] = [
  antiNukeModule,
  antiRaidModule,
  antiSpamModule,
  honeypotModule,
  lockdownModule,
  backupsModule,
  autoModModule,
  systemixModule,
  moderationModule,
  loggingModule,
  verificationModule,
  delegationModule,
  welcomeModule,
  selfRolesModule,
  ticketsModule,
  levelingModule,
  suggestionsModule,
  giveawaysModule,
  utilityModule,
];
