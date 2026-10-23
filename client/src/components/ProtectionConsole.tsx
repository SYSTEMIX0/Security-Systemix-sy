import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Save, ShieldCheck } from "lucide-react";
import type { GuildSecurityConfig, GuildSecurityPatch } from "../../../server/discord/config";
import type { GuildMeta } from "../../../shared/systemix-api";
import { DiscordApiError, discordApi, type DiscordGuildSnapshot } from "@/lib/discord-api";
import "./ProtectionConsole.css";

type Props = { guildId: string; guildName: string };
type EditableSection = "general" | "antiNuke" | "antiRaid" | "antiSpam" | "autoMod" | "logging" | "verification";
type Confirmation = "CONFIRM_SETTINGS" | "ENABLE_PROTECTION";

function errorMessage(error: unknown): string {
  if (error instanceof DiscordApiError) {
    if (error.code === "audit_precondition_failed") return "تعذّر تسجيل التغيير في سجل التدقيق؛ لم تُحفظ الإعدادات. حاول مجدداً بعد استعادة قاعدة البيانات.";
    if (error.code === "settings_confirmation_required" || error.code === "protect_confirmation_required") return "انتهت صلاحية التأكيد. راجع التغييرات وأكّد الحفظ مرة أخرى.";
    if (error.status === 403) return "لا تملك صلاحية إدارة هذا السيرفر في Discord.";
  }
  return "تعذّر تحميل إعدادات الحماية أو حفظها. تحقق من الاتصال ثم أعد المحاولة.";
}

export default function ProtectionConsole({ guildId, guildName }: Props) {
  const [snapshot, setSnapshot] = useState<DiscordGuildSnapshot | null>(null);
  const [meta, setMeta] = useState<GuildMeta | null>(null);
  const [draft, setDraft] = useState<GuildSecurityConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setProblem("");
    Promise.all([discordApi.loadGuildSettings(guildId), discordApi.loadGuildMeta(guildId).catch(() => null)])
      .then(([settings, guildMeta]) => {
        if (!active) return;
        setSnapshot(settings);
        setDraft(settings.settings);
        setMeta(guildMeta);
      })
      .catch((error: unknown) => {
        if (active) setProblem(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [guildId, reloadKey]);

  const dirty = useMemo(() => Boolean(draft && snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot.settings)), [draft, snapshot]);
  const channels = useMemo(() => (meta?.channels ?? []).filter((channel) => channel.type === "text" || channel.type === "announcement"), [meta]);

  const updateSection = <K extends EditableSection>(key: K, changes: Partial<GuildSecurityConfig[K]>) => {
    setDraft((current) => current ? { ...current, [key]: { ...current[key], ...changes } } as GuildSecurityConfig : current);
  };

  const save = async () => {
    if (!draft || !snapshot) return;
    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const confirmation: Confirmation = draft.mode === "protect" ? "ENABLE_PROTECTION" : "CONFIRM_SETTINGS";
      const patch: GuildSecurityPatch = {
        mode: draft.mode,
        general: draft.general,
        antiNuke: draft.antiNuke,
        antiRaid: draft.antiRaid,
        antiSpam: draft.antiSpam,
        autoMod: draft.autoMod,
        logging: draft.logging,
        verification: draft.verification,
      };
      const result = await discordApi.saveGuildSettings(guildId, patch, confirmation);
      setSnapshot((current) => current ? { ...current, settings: result.settings } : current);
      setDraft(result.settings);
      setNotice("حُفظت التغييرات بعد تسجيل إجراء الحفظ مسبقاً في سجل التدقيق.");
      setConfirmOpen(false);
    } catch (error) {
      setProblem(errorMessage(error));
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !draft) return <section className="protection-console"><div className="pc-state"><LoaderCircle className="pc-spin" size={22} /> جارٍ تحميل إعدادات الحماية الحقيقية...</div></section>;
  if (!draft || !snapshot) return <section className="protection-console"><div className="pc-state pc-error"><AlertTriangle size={22} /><span>{problem || "تعذّر تحميل إعدادات السيرفر."}</span><button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={16} /> إعادة المحاولة</button></div></section>;

  return (
    <section className="protection-console" dir="rtl">
      <header className="pc-header">
        <div>
          <div className="pc-eyebrow"><ShieldCheck size={15} /> مركز الحماية الحي</div>
          <h1>حماية {guildName}</h1>
          <p>إعدادات هذا السيرفر مرتبطة مباشرة بقاعدة Systemix. كل حفظ يُسجّل أولاً؛ إذا تعذّر سجل التدقيق يُرفض التغيير.</p>
        </div>
        <button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)} disabled={loading || saving}><RefreshCw size={16} /> تحديث</button>
      </header>

      {problem && <div className="pc-message pc-message-error" role="alert"><AlertTriangle size={18} /> {problem}</div>}
      {notice && <div className="pc-message pc-message-success" role="status"><CheckCircle2 size={18} /> {notice}</div>}

      <div className="pc-status-row">
        <span className={snapshot.botOnline ? "pc-status pc-status-good" : "pc-status pc-status-muted"}><i /> {snapshot.botOnline ? "البوت متصل" : "البوت غير متصل"}</span>
        <span className={snapshot.botInstalled ? "pc-status pc-status-good" : "pc-status pc-status-warn"}><i /> {snapshot.botInstalled ? "مثبّت في السيرفر" : "غير مثبّت في السيرفر"}</span>
        <span className={snapshot.permissions.viewAuditLog ? "pc-status pc-status-good" : "pc-status pc-status-warn"}><i /> {snapshot.permissions.viewAuditLog ? "صلاحية سجل Discord متاحة" : "صلاحية View Audit Log غير متاحة"}</span>
        <span className={snapshot.memberIntentEnabled ? "pc-status pc-status-good" : "pc-status pc-status-warn"}><i /> {snapshot.memberIntentEnabled ? "بوابة الأعضاء مفعّلة" : "بوابة الأعضاء غير مفعّلة"}</span>
      </div>

      {!snapshot.botInstalled && <div className="pc-message pc-message-warn"><AlertTriangle size={18} /> يمكن حفظ الإعدادات، لكن إجراءات البوت لن تعمل في هذا السيرفر حتى تثبيته وتشغيله.</div>}
      {!snapshot.permissions.viewAuditLog && <div className="pc-message pc-message-warn"><AlertTriangle size={18} /> بعض إشارات مكافحة العبث ستكون محدودة دون صلاحية قراءة سجل التدقيق في Discord.</div>}

      <div className="pc-mode-card">
        <div><span className="pc-eyebrow">نمط التشغيل</span><strong>{draft.mode === "observe" ? "مراقبة آمنة" : "حماية فعّالة"}</strong><small>{draft.mode === "observe" ? "يرصد ويُسجّل دون تنفيذ عقوبات تلقائية." : "قد تنفّذ الوحدات إجراءات حسب إعداداتها وصلاحيات Discord."}</small></div>
        <select aria-label="نمط الحماية" value={draft.mode} onChange={(event) => setDraft((current) => current ? { ...current, mode: event.currentTarget.value as GuildSecurityConfig["mode"] } : current)}>
          <option value="observe">مراقبة فقط — افتراضي وآمن</option>
          <option value="protect">حماية فعّالة — تتطلب تأكيداً</option>
        </select>
      </div>

      <div className="pc-grid">
        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-red">01</span><div><h2>Anti-Nuke</h2><p>التقاط العبث الإداري قبل اتساع الضرر</p></div></div><SwitchRow label="تفعيل الوحدة" checked={draft.antiNuke.enabled} onChange={(checked) => updateSection("antiNuke", { enabled: checked })} /></div>
          <div className="pc-fields"><NumberField label="عدد الإجراءات قبل الإنذار" value={draft.antiNuke.threshold} min={2} max={20} onChange={(value) => updateSection("antiNuke", { threshold: value })} /><NumberField label="نافذة الرصد (ثوانٍ)" value={draft.antiNuke.windowSeconds} min={5} max={120} onChange={(value) => updateSection("antiNuke", { windowSeconds: value })} /></div>
          <SelectField label="الإجراء بعد العتبة في وضع الحماية" value={draft.antiNuke.punishment} options={[{ value: "alert", label: "تنبيه فقط" }, { value: "strip_roles", label: "إزالة الرتب الخطرة القابلة للإزالة" }, { value: "timeout", label: "Timeout" }, { value: "kick", label: "طرد" }, { value: "ban", label: "حظر" }]} onChange={(value) => updateSection("antiNuke", { punishment: value as GuildSecurityConfig["antiNuke"]["punishment"] })} />
          {draft.antiNuke.punishment === "timeout" && <NumberField label="مدة Timeout (دقيقة)" value={draft.antiNuke.timeoutMinutes} min={1} max={40_320} onChange={(value) => updateSection("antiNuke", { timeoutMinutes: value })} />}
          <SwitchRow label="قفل احترازي عند التفعيل" checked={draft.antiNuke.lockdownOnTrigger} onChange={(checked) => updateSection("antiNuke", { lockdownOnTrigger: checked })} />
          <ChannelSelect label="قناة تنبيهات Anti-Nuke" value={draft.antiNuke.alertChannelId} channels={channels} onChange={(value) => updateSection("antiNuke", { alertChannelId: value })} />
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-orange">02</span><div><h2>Anti-Raid</h2><p>رصد دفعات الدخول والحسابات الحديثة</p></div></div><SwitchRow label="تفعيل الوحدة" checked={draft.antiRaid.enabled} onChange={(checked) => updateSection("antiRaid", { enabled: checked })} /></div>
          <div className="pc-fields"><NumberField label="حد الدخول الجماعي" value={draft.antiRaid.joinThreshold} min={2} max={100} onChange={(value) => updateSection("antiRaid", { joinThreshold: value })} /><NumberField label="نافذة الرصد (ثوانٍ)" value={draft.antiRaid.windowSeconds} min={5} max={300} onChange={(value) => updateSection("antiRaid", { windowSeconds: value })} /><NumberField label="عمر الحساب الأدنى (ساعات)" value={draft.antiRaid.minAccountAgeHours} min={0} max={8760} onChange={(value) => updateSection("antiRaid", { minAccountAgeHours: value })} /></div>
          <SelectField label="الإجراء عند نمط الغارة" value={draft.antiRaid.raidAction} options={[{ value: "alert", label: "تنبيه فقط" }, { value: "timeout", label: "Timeout" }, { value: "kick", label: "طرد" }, { value: "ban", label: "حظر" }]} onChange={(value) => updateSection("antiRaid", { raidAction: value as GuildSecurityConfig["antiRaid"]["raidAction"] })} />
          <SelectField label="الإجراء للحسابات الحديثة" value={draft.antiRaid.newAccountAction} options={[{ value: "none", label: "لا عقوبة — تنبيه حسب الإشارات" }, { value: "timeout", label: "Timeout" }, { value: "kick", label: "طرد" }]} onChange={(value) => updateSection("antiRaid", { newAccountAction: value as GuildSecurityConfig["antiRaid"]["newAccountAction"] })} />
          <NumberField label="مدة Timeout (دقيقة)" value={draft.antiRaid.timeoutMinutes} min={1} max={40_320} onChange={(value) => updateSection("antiRaid", { timeoutMinutes: value })} />
          <SwitchRow label="قفل تلقائي عند نمط الغارة" checked={draft.antiRaid.autoLockdown} onChange={(checked) => updateSection("antiRaid", { autoLockdown: checked })} />
          <ChannelSelect label="قناة تنبيهات Anti-Raid" value={draft.antiRaid.alertChannelId} channels={channels} onChange={(value) => updateSection("antiRaid", { alertChannelId: value })} />
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-blue">03</span><div><h2>مكافحة السبام</h2><p>تكرار الرسائل والمنشنات والروابط</p></div></div><SwitchRow label="تفعيل الوحدة" checked={draft.antiSpam.enabled} onChange={(checked) => updateSection("antiSpam", { enabled: checked })} /></div>
          <div className="pc-fields"><NumberField label="الرسائل المسموحة" value={draft.antiSpam.maxMessages} min={3} max={30} onChange={(value) => updateSection("antiSpam", { maxMessages: value })} /><NumberField label="الفترة (ثوانٍ)" value={draft.antiSpam.perSeconds} min={2} max={60} onChange={(value) => updateSection("antiSpam", { perSeconds: value })} /><NumberField label="أقصى منشنات" value={draft.antiSpam.maxMentions} min={0} max={50} onChange={(value) => updateSection("antiSpam", { maxMentions: value })} /></div>
          <SelectField label="الإجراء" value={draft.antiSpam.action} options={[{ value: "delete", label: "حذف الرسالة" }, { value: "warn", label: "تحذير" }, { value: "timeout", label: "Timeout" }, { value: "kick", label: "طرد" }]} onChange={(value) => updateSection("antiSpam", { action: value as GuildSecurityConfig["antiSpam"]["action"] })} />
          {draft.antiSpam.action === "timeout" && <NumberField label="مدة Timeout (دقيقة)" value={draft.antiSpam.timeoutMinutes} min={1} max={1_440} onChange={(value) => updateSection("antiSpam", { timeoutMinutes: value })} />}
          <SwitchRow label="حظر الروابط غير المسموحة" checked={draft.antiSpam.blockLinks} onChange={(checked) => updateSection("antiSpam", { blockLinks: checked })} />
          <ChannelSelect label="قناة تنبيهات السبام" value={draft.antiSpam.alertChannelId} channels={channels} onChange={(value) => updateSection("antiSpam", { alertChannelId: value })} />
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-violet">04</span><div><h2>AutoMod</h2><p>قواعد الرسائل والدعوات والمنشنات</p></div></div><SwitchRow label="تفعيل الوحدة" checked={draft.autoMod.enabled} onChange={(checked) => updateSection("autoMod", { enabled: checked })} /></div>
          <SwitchRow label="حظر روابط دعوات Discord" checked={draft.autoMod.blockInvites} onChange={(checked) => updateSection("autoMod", { blockInvites: checked })} />
          <SwitchRow label="حظر إغراق المنشنات" checked={draft.autoMod.blockMentionSpam} onChange={(checked) => updateSection("autoMod", { blockMentionSpam: checked })} />
          <SwitchRow label="حظر الروابط" checked={draft.autoMod.blockLinks} onChange={(checked) => updateSection("autoMod", { blockLinks: checked })} />
          <SwitchRow label="رصد تكرار المحتوى" checked={draft.autoMod.blockSpamContent} onChange={(checked) => updateSection("autoMod", { blockSpamContent: checked })} />
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-green">05</span><div><h2>سجل الأحداث</h2><p>تحديد ما يظهر في سجل السيرفر</p></div></div><SwitchRow label="تفعيل التسجيل" checked={draft.logging.enabled} onChange={(checked) => updateSection("logging", { enabled: checked })} /></div>
          <ChannelSelect label="قناة السجلات" value={draft.logging.channelId} channels={channels} onChange={(value) => updateSection("logging", { channelId: value })} />
          <SwitchRow label="دخول ومغادرة الأعضاء" checked={draft.logging.memberJoinLeave} onChange={(checked) => updateSection("logging", { memberJoinLeave: checked })} />
          <SwitchRow label="حذف وتعديل الرسائل" checked={draft.logging.messageDelete || draft.logging.messageEdit} onChange={(checked) => updateSection("logging", { messageDelete: checked, messageEdit: checked })} />
          <SwitchRow label="تغييرات الرتب والقنوات" checked={draft.logging.roleChanges || draft.logging.channelChanges} onChange={(checked) => updateSection("logging", { roleChanges: checked, channelChanges: checked })} />
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-cyan">06</span><div><h2>بوابة التحقق</h2><p>تجهيز العضو قبل فتح المجتمع</p></div></div><SwitchRow label="تفعيل الوحدة" checked={draft.verification.enabled} onChange={(checked) => updateSection("verification", { enabled: checked })} /></div>
          <ChannelSelect label="قناة التحقق" value={draft.verification.channelId} channels={channels} onChange={(value) => updateSection("verification", { channelId: value })} />
          <NumberField label="عمر الحساب الأدنى (ساعات)" value={draft.verification.minAccountAgeHours} min={0} max={8760} onChange={(value) => updateSection("verification", { minAccountAgeHours: value })} />
          <p className="pc-hint">رتبة التحقق ورسالة البوابة تُضبطان من إعدادات الوحدة التفصيلية. تشغيل الوحدة وحده لا ينشئ رسالة Discord تلقائياً.</p>
        </article>
      </div>

      <footer className="pc-savebar">
        <span>{dirty ? "لديك تغييرات غير محفوظة" : "الإعدادات متزامنة مع قاعدة Systemix"}</span>
        <button className="pc-button pc-button-primary" onClick={() => { setProblem(""); setConfirmOpen(true); }} disabled={!dirty || saving}><Save size={17} /> مراجعة وحفظ التغييرات</button>
      </footer>

      {confirmOpen && <div className="pc-modal-backdrop" role="presentation"><section className="pc-modal" role="dialog" aria-modal="true" aria-labelledby="pc-confirm-title">
        <span className="pc-modal-icon"><AlertTriangle size={22} /></span>
        <h2 id="pc-confirm-title">تأكيد تغيير إعدادات الحماية</h2>
        <p>{draft.mode === "protect" ? "أنت تؤكد حفظ الإعدادات في نمط الحماية الفعّالة. قد تنفّذ الوحدات إجراءات تلقائية وفق إعداداتها وصلاحيات البوت." : "أنت تؤكد حفظ الإعدادات في قاعدة Systemix. نمط المراقبة لا ينفّذ عقوبات تلقائية."}</p>
        <p className="pc-modal-audit">سيُسجّل طلب التغيير أولاً. إذا فشل سجل التدقيق، سيرفض الخادم حفظ الإعدادات.</p>
        <div className="pc-modal-actions"><button className="pc-button pc-button-secondary" onClick={() => setConfirmOpen(false)} disabled={saving}>مراجعة لاحقاً</button><button className="pc-button pc-button-primary" onClick={() => void save()} disabled={saving}>{saving ? <><LoaderCircle className="pc-spin" size={16} /> جارٍ الحفظ</> : "أؤكد الحفظ"}</button></div>
      </section></div>}
    </section>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="pc-switch-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} /></label>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="pc-field"><span>{label}</span><input type="number" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Math.round(Number(event.currentTarget.value) || min))))} /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <label className="pc-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.currentTarget.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function ChannelSelect({ label, value, channels, onChange }: { label: string; value: string | null; channels: GuildMeta["channels"]; onChange: (value: string | null) => void }) {
  return <label className="pc-field"><span>{label}</span><select value={value ?? ""} onChange={(event) => onChange(event.currentTarget.value || null)}><option value="">غير محددة</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label>;
}
