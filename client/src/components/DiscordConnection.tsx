import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Unplug,
  Users,
} from "lucide-react";
import {
  discordApi,
  DiscordApiError,
  type DiscordDashboardData,
  type DiscordGuildSnapshot,
  type DiscordSecurityEvent,
} from "@/lib/discord-api";
import type { GuildSecurityConfig } from "../../../server/discord/config";

type Notice = { title: string; detail?: string; kind?: "info" | "success" | "warning" };
type Props = {
  connection: DiscordDashboardData;
  loading: boolean;
  dashboardError: string | null;
  selectedGuildId: string;
  onSelectGuild: (guildId: string) => void;
  onConnect: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (notice: Notice) => void;
};

const botStateLabel: Record<DiscordDashboardData["bot"]["status"], string> = {
  not_configured: "لم تُضف بيانات تشغيل البوت بعد",
  disabled_by_policy: "متوقف بأمان حتى تفعيل الاستضافة الدائمة",
  blocked_by_readiness: "موقوف حتى اتصال قاعدة البيانات ونجاح الترحيلات",
  connecting: "يحاول الاتصال بـDiscord",
  ready: "Gateway متصل",
  degraded: "الاتصال يحتاج مراجعة الإعدادات",
};

function commandSyncDetails(bot: DiscordDashboardData["bot"]): string {
  if (bot.commandSyncStatus === "synced") {
    return bot.commandCount === null ? "تمت مزامنة أوامر Slash." : `تمت مزامنة ${bot.commandCount} أمراً في Discord.`;
  }
  if (bot.commandSyncStatus === "pending") return "جارٍ مزامنة أوامر Slash؛ حالة Gateway وحدها لا تؤكد توفرها.";
  if (bot.commandSyncStatus === "failed") {
    const knownCount = bot.commandCount === null ? "لا يوجد عدد مؤكد" : `آخر عدد مؤكد ${bot.commandCount}`;
    return `تعذرت آخر مزامنة لأوامر Slash (${bot.commandSyncErrorCode ?? "unknown"})؛ ${knownCount}. ستعاد المحاولة عند الاتصال التالي.`;
  }
  return "لم تبدأ مزامنة أوامر Slash في هذه الجلسة.";
}

function botStatusDetails(bot: DiscordDashboardData["bot"]): string {
  if (bot.status === "ready") {
    const guildDetails = bot.guildCount === 0
      ? "البوت غير مضاف إلى أي سيرفر؛ أضفه إلى سيرفر تجريبي عبر رابط الدعوة."
      : `متصل في ${bot.guildCount} سيرفر.`;
    const slashDetails = commandSyncDetails(bot);
    const gatewayError = bot.lastErrorCode && bot.lastErrorCode !== bot.commandSyncErrorCode
      ? bot.lastErrorCode === "depth_zero_self_signed_cert" ? "تعذر تحقق TLS؛ لم نعطل التحقق من الشهادة." : "يوجد خطأ Gateway/REST إضافي؛ راجع سجل الخدمة."
      : "";
    const memberIntent = bot.memberIntentEnabled
      ? "مراقبة انضمام الأعضاء متاحة عبر Guild Members Intent."
      : "Guild Members Intent غير متاح؛ لن ندّعي مراقبة join/leave كاملة.";
    const contentIntent = bot.messageContentIntentEnabled
      ? "Message Content Intent متاح؛ قد تستخدمه قواعد الروابط والتكرار وفق إعدادات السيرفر."
      : "Message Content Intent غير متاح؛ يبقى كشف معدل الرسائل، وتُقيّد قواعد النصوص التي تحتاج قراءة المحتوى.";
    return `${guildDetails} ${slashDetails} ${gatewayError} ${memberIntent} ${contentIntent}`.trim();
  }
  if (bot.lastErrorCode === "bot_application_id_mismatch") {
    return "توكن البوت يعود إلى تطبيق Discord مختلف عن Application ID المعرّف؛ أوقفنا Gateway تلقائياً.";
  }
  if (bot.lastErrorCode === "depth_zero_self_signed_cert") {
    return "تعذر الاتصال الآمن بـDiscord بسبب فشل التحقق من شهادة TLS في بيئة التشغيل. لم يتم تعطيل التحقق من الشهادات.";
  }
  return `الاتصال الحي يحتاج Bot Token آمناً وتشغيلاً مستمراً؛ لا نعرضه كمتصل قبل تأكيد Ready من Discord. ${bot.commandSyncStatus === "failed" ? commandSyncDetails(bot) : ""}`.trim();
}

const severityLabel = { low: "معلومة", medium: "مراجعة", high: "عالية" } as const;
const eventTitle: Record<string, string> = {
  "anti_nuke:channel_create": "إنشاء قناة",
  "anti_nuke:channel_delete": "حذف قناة",
  "anti_nuke:channel_update": "تعديل قناة",
  "anti_nuke:role_create": "إنشاء رتبة",
  "anti_nuke:role_delete": "حذف رتبة",
  "anti_nuke:role_update": "تعديل رتبة",
  "anti_nuke:member_kick": "طرد عضو",
  "anti_nuke:member_ban": "حظر عضو",
  "anti_nuke:member_prune": "حذف جماعي لأعضاء غير نشطين",
  "anti_nuke:member_role_update": "تغيير رتبة عضو",
  "anti_nuke:webhook_create": "إنشاء Webhook",
  "anti_nuke:webhook_update": "تعديل Webhook",
  "anti_nuke:webhook_delete": "حذف Webhook",
  "anti_nuke:bot_add": "إضافة بوت",
  "anti_nuke:message_bulk_delete": "حذف جماعي للرسائل",
  "anti_nuke:threshold_alert": "تجاوز حد Anti-Nuke",
  "anti_raid:risk_signal": "إشارة Anti-Raid",
  "auto_mod:action": "إجراء Discord AutoMod",
  "automod:rules_applied": "تطبيق قواعد AutoMod",
  "automod:rules_synced": "مزامنة قواعد AutoMod",
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "وقت غير متاح" : date.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
}

function errorText(error: unknown): string {
  if (!(error instanceof DiscordApiError)) return "تعذر الاتصال بخادم اللوحة. أعد المحاولة.";
  switch (error.code) {
    case "discord_login_required": return "اربط حساب Discord أولاً.";
    case "discord_manage_server_required": return "لا يظهر هذا السيرفر ضمن السيرفرات التي تملك فيها صلاحية Manage Server.";
    case "audit_precondition_failed": return "تعذر تسجيل الإجراء في سجل التدقيق؛ لم تُحفظ الإعدادات.";
    case "settings_confirmation_required":
    case "protect_confirmation_required": return "انتهت صلاحية التأكيد؛ راجع التغييرات وأكد الحفظ مجدداً.";
    case "bot_not_ready": return "بوت Discord غير متصل حالياً.";
    case "bot_not_installed": return "أضف البوت إلى السيرفر أولاً.";
    case "bot_manage_guild_permission_required": return "يحتاج البوت صلاحية Manage Server لتطبيق قاعدة AutoMod.";
    case "automod_not_enabled_in_settings": return "فعّل وحدة AutoMod واحفظ الإعدادات أولاً.";
    case "automod_rule_name_conflict": return "يوجد Rule بالاسم نفسه أنشأه شخص آخر؛ لم نعدّله حفاظاً على إعدادات السيرفر.";
    case "invalid_settings": return "توجد قيمة إعداد غير صالحة. راجع حقول ID والحدود.";
    case "csrf_validation_failed": return "انتهت جلسة الحماية. حدّث الصفحة ثم أعد المحاولة.";
    case "discord_rate_limited": return "Discord يحد الطلبات مؤقتاً. انتظر قليلاً ثم أعد المحاولة.";
    case "network_unavailable": return "تعذر الوصول إلى API اللوحة.";
    default: return "تعذر إكمال الطلب. راجع الاتصال والصلاحيات ثم أعد المحاولة.";
  }
}

function mergeSettings(current: GuildSecurityConfig, patch: Partial<GuildSecurityConfig>): GuildSecurityConfig {
  return {
    ...current,
    ...patch,
    antiNuke: { ...current.antiNuke, ...patch.antiNuke },
    antiRaid: { ...current.antiRaid, ...patch.antiRaid },
    autoMod: { ...current.autoMod, ...patch.autoMod },
  };
}

function SwitchRow({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="discord-switch-row">
      <span><strong>{title}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function PermissionStatus({ label, granted }: { label: string; granted: boolean }) {
  return <span className={`discord-permission ${granted ? "permission-ok" : "permission-missing"}`}><i />{label}: {granted ? "متاحة" : "ناقصة"}</span>;
}

export default function DiscordConnection({ connection, loading, dashboardError, selectedGuildId, onSelectGuild, onConnect, onRefresh, onNotice }: Props) {
  const [snapshot, setSnapshot] = useState<DiscordGuildSnapshot | null>(null);
  const [settings, setSettings] = useState<GuildSecurityConfig | null>(null);
  const [events, setEvents] = useState<DiscordSecurityEvent[]>([]);
  const [loadingGuild, setLoadingGuild] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingAutoMod, setApplyingAutoMod] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const selectedGuild = connection.guilds.find((guild) => guild.id === selectedGuildId) ?? null;

  const refreshGuild = async () => {
    if (!selectedGuildId || !connection.user) {
      setSnapshot(null);
      setSettings(null);
      setEvents([]);
      return;
    }
    setLoadingGuild(true);
    try {
      const [nextSnapshot, nextEvents] = await Promise.all([
        discordApi.loadGuildSettings(selectedGuildId),
        discordApi.loadGuildEvents(selectedGuildId),
      ]);
      setSnapshot(nextSnapshot);
      setSettings(nextSnapshot.settings);
      setEvents(nextEvents.events);
      setDirty(false);
      setInviteUrl(null);
    } catch (error) {
      setSnapshot(null);
      setSettings(null);
      onNotice({ title: "تعذر تحميل إعدادات السيرفر", detail: errorText(error), kind: "warning" });
    } finally {
      setLoadingGuild(false);
    }
  };

  useEffect(() => { void refreshGuild(); }, [selectedGuildId, connection.user?.id]);

  const updateSettings = (patch: Partial<GuildSecurityConfig>) => {
    setSettings((current) => current ? mergeSettings(current, patch) : current);
    setDirty(true);
  };

  const saveSettings = async () => {
    if (!selectedGuildId || !settings) return;
    const confirmation = settings.mode === "protect" ? "ENABLE_PROTECTION" : "CONFIRM_SETTINGS";
    const accepted = window.confirm(settings.mode === "protect"
      ? "تأكيد حفظ إعدادات هذا السيرفر في نمط الحماية الفعّالة؟ قد تنفّذ الوحدات إجراءات تلقائية وفق إعداداتها."
      : "تأكيد حفظ إعدادات هذا السيرفر في قاعدة Systemix؟ سيتم تسجيل التغيير قبل حفظه.");
    if (!accepted) return;
    setSaving(true);
    try {
      const result = await discordApi.saveGuildSettings(selectedGuildId, {
        antiNuke: settings.antiNuke,
        antiRaid: settings.antiRaid,
        autoMod: settings.autoMod,
      }, confirmation);
      setSettings(result.settings);
      setDirty(false);
      onNotice({ title: "حُفظت إعدادات السيرفر", detail: "الحفظ يحدّث قاعدة بيانات Systemix فقط؛ لا يغيّر Discord وحده.", kind: "success" });
    } catch (error) {
      onNotice({ title: "لم تُحفظ الإعدادات", detail: errorText(error), kind: "warning" });
    } finally {
      setSaving(false);
    }
  };

  const requestInvite = async () => {
    if (!selectedGuildId) return;
    try {
      const result = await discordApi.getInviteUrl(selectedGuildId);
      setInviteUrl(result.url);
    } catch (error) {
      onNotice({ title: "تعذر تجهيز رابط البوت", detail: errorText(error), kind: "warning" });
    }
  };

  const applyAutoMod = async () => {
    if (!selectedGuildId || !settings) return;
    const selectedRules = [settings.autoMod.blockInvites, settings.autoMod.blockMentionSpam, settings.autoMod.blockedKeywords.length > 0].some(Boolean);
    if (settings.autoMod.enabled && !selectedRules) {
      onNotice({ title: "لا توجد قواعد جاهزة للتطبيق", detail: "حدد قاعدة واحدة على الأقل ثم احفظها.", kind: "warning" });
      return;
    }
    const message = settings.autoMod.enabled
      ? "سيُنشئ أو يحدّث قواعد Discord AutoMod المحددة لحجب أنواع الرسائل المختارة، ما قد يؤثر على الأعضاء. لن نعدّل قواعد أنشأها شخص آخر. هل تؤكد؟"
      : "سيُعطّل فقط قواعد AutoMod السابقة التي أنشأها بوت Systemix نفسه. لن يحذفها ولن يغيّر قواعد أي شخص آخر. هل تؤكد؟";
    const confirmed = window.confirm(message);
    if (!confirmed) return;
    setApplyingAutoMod(true);
    try {
      const result = await discordApi.applyAutoMod(selectedGuildId);
      onNotice({ title: `تمت مزامنة ${result.changes.length} قاعدة AutoMod`, detail: result.note, kind: "success" });
      await refreshGuild();
    } catch (error) {
      onNotice({ title: "لم تُطبق القواعد", detail: errorText(error), kind: "warning" });
    } finally {
      setApplyingAutoMod(false);
    }
  };

  const logout = async () => {
    try {
      await discordApi.logout();
      await onRefresh();
      onNotice({ title: "تم فصل حساب Discord", detail: "تم حذف جلسة اللوحة من هذا المتصفح.", kind: "success" });
    } catch (error) {
      onNotice({ title: "تعذر فصل الجلسة", detail: errorText(error), kind: "warning" });
    }
  };

  const loadInviteThenOpen = async () => {
    await requestInvite();
  };

  return (
    <div className="discord-connection-page">
      <div className="discord-page-heading">
        <div><span className="overline">SECURE ACCOUNT LINK</span><h1>ربط Discord</h1><p>اختر السيرفر الذي تديره، ثم تحقق من صلاحيات البوت وحالة Gateway الحقيقية.</p></div>
        <button className="button button-secondary" onClick={() => { void onRefresh(); void refreshGuild(); }} disabled={loading || loadingGuild}><RefreshCw size={15} /> تحديث الحالة</button>
      </div>

      <div className="discord-state-grid">
        <section className="panel discord-account-card">
          <div className="discord-card-icon"><Users size={18} /></div>
          <div className="discord-card-copy"><span className="overline">حساب الإدارة</span><h2>{connection.user ? connection.user.username : "اربط حساب Discord"}</h2><p>{connection.user ? "تمت مصادقة حساب Discord. قائمة السيرفرات تُفلتر بصلاحية Manage Server أو ملكية السيرفر." : "نستخدم OAuth بصلاحية identify وguilds فقط؛ لا نطلب كلمة مرورك ولا رمز البوت من المتصفح."}</p></div>
          {connection.user ? <button className="button button-ghost" onClick={() => void logout()}><Unplug size={15} /> فصل الحساب</button> : <button className="button button-primary" onClick={onConnect} disabled={!connection.oauthConfigured}><LockKeyhole size={15} /> ربط حساب Discord</button>}
        </section>
        <section className="panel discord-gateway-card">
          <div className={`discord-live-mark state-${connection.bot.status}`}><Bot size={18} /></div>
          <div className="discord-card-copy"><span className="overline">DISCORD GATEWAY</span><h2>{connection.bot.status === "degraded" && connection.bot.lastErrorCode === "depth_zero_self_signed_cert" ? "تعذر تحقق TLS مع Discord" : botStateLabel[connection.bot.status]}</h2><p>{botStatusDetails(connection.bot)}</p></div>
          <span className={`discord-status-chip ${connection.bot.status === "ready" ? "chip-ready" : "chip-idle"}`}><i />{connection.bot.status === "ready" ? "LIVE" : "NOT READY"}</span>
        </section>
      </div>

      {!connection.oauthConfigured && <div className="discord-setup-note"><AlertTriangle size={16} /><div><strong>إعداد OAuth غير مكتمل</strong><span>أضف DISCORD_CLIENT_SECRET في مخزن الأسرار الآمن، وسجّل Redirect URI المطابق في Discord Developer Portal قبل تسجيل الدخول.</span></div></div>}
      {dashboardError && <div className="discord-setup-note"><CircleHelp size={16} /><div><strong>تعذر جلب الحالة</strong><span>حدّث الصفحة أو افتح الموقع المنشور في تبويب مستقل إذا كان المتصفح يمنع Cookies المعاينة المضمّنة.</span></div></div>}

      {connection.user && <section className="panel discord-guild-panel">
        <div className="panel-heading"><div><span className="overline">SERVERS YOU CAN MANAGE</span><h2>اختر السيرفر</h2><p>يُسمح بالتعديل فقط إذا أعاد Discord صلاحية إدارة هذا السيرفر لحسابك.</p></div><span className="discord-count">{connection.guilds.length} سيرفر</span></div>
        {connection.guilds.length === 0 ? <div className="discord-empty"><ShieldAlert size={22} /><strong>ما فيه سيرفرات بصلاحية إدارة ظاهرة</strong><span>تأكد من أنك مالك السيرفر أو لديك Manage Server، ثم أعد ربط الحساب.</span></div> : <label className="discord-guild-select"><span>السيرفر المستهدف</span><select value={selectedGuildId} onChange={(event) => onSelectGuild(event.currentTarget.value)}><option value="">اختر السيرفر</option>{connection.guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}{guild.botInstalled ? " · البوت مضاف" : " · البوت غير مضاف"}</option>)}</select><ChevronDown size={15} /></label>}
      </section>}

      {selectedGuild && connection.user && <>
        <section className="panel discord-guild-status">
          <div className="discord-guild-title"><div className="discord-server-avatar">{selectedGuild.icon ? <img src={`https://cdn.discordapp.com/icons/${selectedGuild.id}/${selectedGuild.icon}.png?size=96`} alt="" /> : selectedGuild.name.slice(0, 2)}</div><div><span className="overline">السيرفر المحدد</span><h2>{selectedGuild.name}</h2><small>{selectedGuild.owner ? "مالك السيرفر" : "صلاحية إدارة السيرفر متحققة"}</small></div></div>
          <div className="discord-permissions">
            <PermissionStatus label="VIEW_AUDIT_LOG" granted={snapshot?.permissions.viewAuditLog ?? false} />
            <PermissionStatus label="MANAGE_GUILD" granted={snapshot?.permissions.manageGuild ?? false} />
          </div>
          {!selectedGuild.botInstalled && <div className="discord-inline-warning"><AlertTriangle size={16} /><span>البوت غير مثبت في هذا السيرفر. رابط الدعوة يطلب صلاحيات محدودة ولا يطلب Administrator.</span>{inviteUrl ? <a href={inviteUrl} target="_blank" rel="noreferrer" className="button button-primary">أضف البوت <ExternalLink size={14} /></a> : <button className="button button-secondary" onClick={() => void loadInviteThenOpen()}>تجهيز رابط الدعوة</button>}</div>}
          {selectedGuild.botInstalled && connection.bot.status !== "ready" && <div className="discord-inline-warning"><Clock3 size={16} /><span>{botStateLabel[connection.bot.status]}</span></div>}
        </section>

        {selectedGuild.botInstalled && connection.bot.status === "ready" && <>
          <section className="panel discord-permission-panel">
            <div className="panel-heading"><div><span className="overline">PERMISSION CHECK</span><h2>صلاحيات البوت</h2><p>لا نطلب صلاحية Administrator. بعض الوحدات تتطلب تفعيلاً إضافياً.</p></div></div>
            <div className="discord-permission-list">
              <PermissionStatus label="عرض سجل التدقيق" granted={snapshot?.permissions.viewAuditLog ?? false} />
              <PermissionStatus label="Manage Server / AutoMod" granted={snapshot?.permissions.manageGuild ?? false} />
              <PermissionStatus label="رصد دخول الأعضاء" granted={snapshot?.memberIntentEnabled ?? connection.bot.memberIntentEnabled} />
            </div>
          </section>

          {loadingGuild || !settings ? <div className="panel discord-loading"><RefreshCw size={17} className="spin" /> جار تحميل إعدادات السيرفر...</div> : <section className="panel discord-config-panel">
            <div className="panel-heading"><div><span className="overline">LIVE SETTINGS · OBSERVE FIRST</span><h2>طبقات الحماية الحية</h2><p>Anti-Nuke وAnti-Raid يسجلان إشارات وينبهان فقط؛ العقوبات الآلية غير مفعلة.</p></div><span className="discord-observe-chip"><ShieldCheck size={13} /> مراقبة فقط</span></div>
            <div className="discord-settings-grid">
              <div className="discord-settings-module">
                <div className="discord-module-title"><ShieldAlert size={17} /><div><strong>Anti-Nuke</strong><small>أحداث سجل التدقيق</small></div></div>
                <SwitchRow title="تفعيل الرصد والتنبيه" detail="إنشاء/تعديل/حذف القنوات والرتب، الحظر والطرد الجماعي، الويبهوك وإضافة البوتات." checked={settings.antiNuke.enabled} onChange={(enabled) => updateSettings({ antiNuke: { ...settings.antiNuke, enabled } })} />
                <label className="discord-field"><span>الحد خلال {settings.antiNuke.windowSeconds} ثانية</span><input type="number" min={2} max={20} value={settings.antiNuke.threshold} onChange={(event) => updateSettings({ antiNuke: { ...settings.antiNuke, threshold: Number(event.currentTarget.value) } })} /></label>
                <label className="discord-field"><span>معرّف قناة التنبيهات (اختياري)</span><input inputMode="numeric" placeholder="معرّف قناة Discord" value={settings.antiNuke.alertChannelId ?? ""} onChange={(event) => updateSettings({ antiNuke: { ...settings.antiNuke, alertChannelId: event.currentTarget.value || null } })} /></label>
                <label className="discord-field discord-field-stack"><span>معرّفات أعضاء الثقة — تفصل بفاصلة أو سطر</span><textarea rows={3} placeholder="مثال: 123456789012345678" value={settings.antiNuke.allowlistedActorIds.join("\n")} onChange={(event) => updateSettings({ antiNuke: { ...settings.antiNuke, allowlistedActorIds: event.currentTarget.value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean).slice(0, 100) } })} /></label>
                <small className="discord-caveat">لن يحظر البوت المنفذ أو يسترجع تغييرات لا تسمح بها Discord.</small>
              </div>
              <div className="discord-settings-module">
                <div className="discord-module-title"><Activity size={17} /><div><strong>Anti-Raid</strong><small>إشارات انضمام للمراجعة</small></div></div>
                <SwitchRow title="تفعيل مراقبة الانضمام" detail="يتطلب GUILD_MEMBERS Intent المميز؛ لا يعاقب عضواً تلقائياً." checked={settings.antiRaid.enabled} onChange={(enabled) => updateSettings({ antiRaid: { ...settings.antiRaid, enabled } })} />
                <label className="discord-field"><span>عدد الانضمامات في {settings.antiRaid.windowSeconds} ثانية</span><input type="number" min={2} max={100} value={settings.antiRaid.joinThreshold} onChange={(event) => updateSettings({ antiRaid: { ...settings.antiRaid, joinThreshold: Number(event.currentTarget.value) } })} /></label>
                <label className="discord-field"><span>عمر الحساب الذي يضيف إشارة (بالساعات)</span><input type="number" min={0} max={8760} value={settings.antiRaid.minAccountAgeHours} onChange={(event) => updateSettings({ antiRaid: { ...settings.antiRaid, minAccountAgeHours: Number(event.currentTarget.value) } })} /></label>
                <label className="discord-field"><span>معرّف قناة تنبيه Anti-Raid (اختياري)</span><input inputMode="numeric" placeholder="معرّف قناة Discord" value={settings.antiRaid.alertChannelId ?? ""} onChange={(event) => updateSettings({ antiRaid: { ...settings.antiRaid, alertChannelId: event.currentTarget.value || null } })} /></label>
                <small className="discord-caveat">العمر وحده ليس دليلاً قاطعاً؛ يُعرض كإشارة مساعدة فقط.</small>
              </div>
              <div className="discord-settings-module discord-automod-module">
                <div className="discord-module-title"><LockKeyhole size={17} /><div><strong>Discord AutoMod</strong><small>قواعد أصلية من Discord</small></div></div>
                <SwitchRow title="إتاحة تطبيق القواعد" detail="لا يحدث تغييراً حتى تضغط زر التطبيق وتؤكد في النافذة." checked={settings.autoMod.enabled} onChange={(enabled) => updateSettings({ autoMod: { ...settings.autoMod, enabled } })} />
                <SwitchRow title="حظر دعوات Discord" detail="ينشئ قاعدة AutoMod لروابط الدعوات المعروفة." checked={settings.autoMod.blockInvites} onChange={(blockInvites) => updateSettings({ autoMod: { ...settings.autoMod, blockInvites } })} />
                <SwitchRow title="حظر المنشن الجماعي" detail="يستخدم حد Discord الأصلي للمنشن في الرسالة." checked={settings.autoMod.blockMentionSpam} onChange={(blockMentionSpam) => updateSettings({ autoMod: { ...settings.autoMod, blockMentionSpam } })} />
                <label className="discord-field"><span>حد المنشن</span><input type="number" min={2} max={50} value={settings.autoMod.mentionLimit} onChange={(event) => updateSettings({ autoMod: { ...settings.autoMod, mentionLimit: Number(event.currentTarget.value) } })} /></label>
                <label className="discord-field discord-field-stack"><span>كلمات محظورة — كلمة في كل سطر</span><textarea rows={3} placeholder="اكتب الكلمات التي تريد حجبها" value={settings.autoMod.blockedKeywords.join("\n")} onChange={(event) => updateSettings({ autoMod: { ...settings.autoMod, blockedKeywords: event.currentTarget.value.split("\n").map((value) => value.trim()).filter(Boolean).slice(0, 100) } })} /></label>
                <label className="discord-field"><span>معرّف قناة تنبيه AutoMod (اختياري)</span><input inputMode="numeric" placeholder="معرّف قناة Discord" value={settings.autoMod.alertChannelId ?? ""} onChange={(event) => updateSettings({ autoMod: { ...settings.autoMod, alertChannelId: event.currentTarget.value || null } })} /></label>
                <div className="discord-action-row"><button className="button button-secondary" onClick={() => void saveSettings()} disabled={!dirty || saving}><Save size={14} />{saving ? "جار الحفظ" : "حفظ الإعدادات"}</button><button className="button button-primary" onClick={() => void applyAutoMod()} disabled={dirty || applyingAutoMod || (settings.autoMod.enabled && !(settings.autoMod.blockInvites || settings.autoMod.blockMentionSpam || settings.autoMod.blockedKeywords.length))}><ShieldCheck size={14} />{applyingAutoMod ? "جار المزامنة" : settings.autoMod.enabled ? "تطبيق AutoMod" : "مزامنة الإيقاف"}</button></div>
                <small className="discord-caveat">التطبيق يحجب الرسائل المطابقة بعد التأكيد. إيقاف الوحدة يعطّل قواعد Systemix المملوكة للبوت فقط؛ قواعد الآخرين لا تُمس.</small>
              </div>
            </div>
            {dirty && <div className="discord-unsaved"><AlertTriangle size={14} /> لديك تغييرات غير محفوظة في قاعدة Systemix. اضغط «حفظ الإعدادات» قبل تطبيق AutoMod.</div>}
            <div className="discord-page-actions"><button className="button button-primary" onClick={() => void saveSettings()} disabled={!dirty || saving}><Save size={15} />{saving ? "جار الحفظ" : "حفظ إعدادات الحماية"}</button></div>
          </section>}

          <section className="panel discord-events-panel">
            <div className="panel-heading"><div><span className="overline">SECURITY EVENTS</span><h2>أحداث موثقة من هذا السيرفر</h2><p>سجلات فعلية يضيفها البوت بعد اتصال Gateway؛ لا يتم حفظ محتوى الرسائل.</p></div><button className="icon-button" aria-label="تحديث الأحداث" onClick={() => void refreshGuild()}><RefreshCw size={15} /></button></div>
            {events.length === 0 ? <div className="discord-empty compact"><CheckCircle2 size={20} /><strong>لا توجد أحداث موثقة بعد</strong><span>فعّل Anti-Nuke أو Anti-Raid واحفظ الإعدادات. قد يحتاج Anti-Raid إلى Intent إضافي.</span></div> : <div className="discord-event-list">{events.map((event) => <article className="discord-event-row" key={event.id}><span className={`discord-event-severity severity-${event.severity}`}><i />{severityLabel[event.severity]}</span><div><strong>{eventTitle[event.eventType] ?? event.eventType}</strong><small>{event.actorId ? `المنفذ/العضو: ${event.actorId}` : "حدث نظام"}{event.targetId ? ` · المستهدف: ${event.targetId}` : ""}</small></div><time>{formatTime(event.createdAt)}</time></article>)}</div>}
          </section>
        </>}
      </>}

      <section className="discord-safety-foot"><ShieldCheck size={16} /><span>الرابط لا يطلب Administrator. OAuth يعطي Identify وGuilds فقط. لا نقرأ محتوى الرسائل، ولا نخزن رموز OAuth في JavaScript؛ جلسة Discord مشفّرة وHttpOnly، والتحقق من Manage Server يجري على الخادم لكل طلب حساس.</span><a href="https://discord.com/developers/docs" target="_blank" rel="noreferrer">توثيق Discord <ArrowUpLeft size={12} /></a></section>
    </div>
  );
}
