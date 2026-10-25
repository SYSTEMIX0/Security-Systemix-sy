import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Clock3, LoaderCircle, LockKeyhole, RefreshCw, Save, Settings2, ShieldAlert } from "lucide-react";
import type { GuildSecurityConfig, GuildSecurityPatch } from "../../../server/discord/config";
import type { GuildMeta } from "../../../shared/systemix-api";
import { DiscordApiError, discordApi, type DiscordGuildSnapshot } from "@/lib/discord-api";
import "./ProtectionConsole.css";

type Props = { guildId: string; guildName: string };
type EditableSection = "general" | "logging" | "antiNuke";

function errorMessage(error: unknown): string {
  if (error instanceof DiscordApiError) {
    if (error.code === "audit_precondition_failed") return "تعذّر تسجيل التغيير في سجل التدقيق؛ لم تُحفظ الإعدادات.";
    if (error.code === "settings_confirmation_required" || error.code === "protect_confirmation_required") return "يلزم تأكيد صريح جديد قبل الحفظ.";
    if (error.code === "guild_config_unavailable") return "تعذّر قراءة إعدادات السيرفر من قاعدة البيانات؛ لم يُنفذ أي تغيير.";
    if (error.status === 403) return "لا تملك صلاحية إدارة هذا السيرفر في Discord.";
  }
  return "تعذّر تحميل إعدادات السيرفر أو حفظها. تحقق من الاتصال ثم أعد المحاولة.";
}

export default function SystemSettingsConsole({ guildId, guildName }: Props) {
  const [snapshot, setSnapshot] = useState<DiscordGuildSnapshot | null>(null);
  const [meta, setMeta] = useState<GuildMeta | null>(null);
  const [draft, setDraft] = useState<GuildSecurityConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const activeGuildId = useRef(guildId);

  useEffect(() => {
    let active = true;
    activeGuildId.current = guildId;
    setLoading(true);
    setProblem("");
    setNotice("");
    setConfirmOpen(false);
    setSnapshot(null);
    setDraft(null);
    setMeta(null);
    Promise.all([discordApi.loadGuildSettings(guildId), discordApi.loadGuildMeta(guildId).catch(() => null)])
      .then(([settings, guildMeta]) => {
        if (!active) return;
        setSnapshot(settings);
        setDraft(settings.settings);
        setMeta(guildMeta);
      })
      .catch((error: unknown) => { if (active) setProblem(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [guildId, reloadKey]);

  const dirty = useMemo(() => Boolean(draft && snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot.settings)), [draft, snapshot]);
  const channels = useMemo(() => (meta?.channels ?? []).filter((channel) => channel.type === "text" || channel.type === "announcement"), [meta]);

  const updateSection = <K extends EditableSection>(key: K, changes: Partial<GuildSecurityConfig[K]>) => {
    setDraft((current) => current ? { ...current, [key]: { ...current[key], ...changes } } as GuildSecurityConfig : current);
  };

  const save = async () => {
    if (!draft) return;
    const saveGuildId = guildId;
    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const patch: GuildSecurityPatch = {
        general: draft.general,
        logging: draft.logging,
        antiNuke: draft.antiNuke,
      };
      const result = await discordApi.saveGuildSettings(guildId, patch, draft.mode === "protect" ? "ENABLE_PROTECTION" : "CONFIRM_SETTINGS");
      if (activeGuildId.current !== saveGuildId) return;
      setSnapshot((current) => current ? { ...current, settings: result.settings } : current);
      setDraft(result.settings);
      setConfirmOpen(false);
      setNotice("حُفظت الإعدادات الحية بعد تسجيل طلب الحفظ في سجل التدقيق.");
    } catch (error) {
      setConfirmOpen(false);
      setProblem(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !draft) return <section className="protection-console"><div className="pc-state"><LoaderCircle className="pc-spin" size={22} /> جارٍ تحميل إعدادات {guildName} الحية...</div></section>;
  if (!draft || !snapshot) return <section className="protection-console"><div className="pc-state pc-error"><AlertTriangle size={22} /><span>{problem || "تعذّر تحميل إعدادات السيرفر."}</span><button className="pc-button pc-button-secondary" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} /> إعادة المحاولة</button></div></section>;

  return (
    <section className="protection-console" dir="rtl">
      <header className="pc-header">
        <div>
          <div className="pc-eyebrow"><Settings2 size={15} /> إعدادات الحوكمة الحية</div>
          <h1>إعدادات {guildName}</h1>
          <p>هذه القيم تخص السيرفر المحدد وتُحفظ في قاعدة Systemix. لا يوجد هنا وضع عرض أو مفاتيح محلية مؤقتة.</p>
        </div>
        <button className="pc-button pc-button-secondary" onClick={() => setReloadKey((value) => value + 1)} disabled={loading || saving}><RefreshCw size={16} /> تحديث</button>
      </header>

      {problem && <div className="pc-message pc-message-error" role="alert"><AlertTriangle size={18} /> {problem}</div>}
      {notice && <div className="pc-message pc-message-success" role="status"><CheckCircle2 size={18} /> {notice}</div>}

      <div className="pc-status-row">
        <span className={snapshot.botOnline ? "pc-status pc-status-good" : "pc-status pc-status-warn"}><i /> {snapshot.botOnline ? "Gateway متصل" : "Gateway غير متصل"}</span>
        <span className={snapshot.botInstalled ? "pc-status pc-status-good" : "pc-status pc-status-warn"}><i /> {snapshot.botInstalled ? "البوت مثبّت" : "البوت غير مثبّت"}</span>
        <span className={snapshot.permissions.viewAuditLog ? "pc-status pc-status-good" : "pc-status pc-status-warn"}><i /> {snapshot.permissions.viewAuditLog ? "View Audit Log متاح" : "View Audit Log غير متاح"}</span>
      </div>

      <div className="pc-grid">
        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-green"><Bell size={16} /></span><div><h2>سجل الأحداث والتنبيهات</h2><p>إعدادات حقيقية لوحدة تسجيل أحداث Discord.</p></div></div><SwitchRow label="تفعيل سجل الأحداث" checked={draft.logging.enabled} onChange={(value) => updateSection("logging", { enabled: value })} /></div>
          <ChannelSelect label="قناة السجل والتنبيهات" value={draft.logging.channelId} channels={channels} onChange={(value) => updateSection("logging", { channelId: value })} />
          <SwitchRow label="دخول ومغادرة الأعضاء" checked={draft.logging.memberJoinLeave} onChange={(value) => updateSection("logging", { memberJoinLeave: value })} />
          <SwitchRow label="تغييرات القنوات والرتب" checked={draft.logging.channelChanges && draft.logging.roleChanges} onChange={(value) => updateSection("logging", { channelChanges: value, roleChanges: value })} />
          <SwitchRow label="إجراءات الإشراف" checked={draft.logging.moderation} onChange={(value) => updateSection("logging", { moderation: value })} />
          <p className="pc-hint">إذا لم تحدد قناة، تبقى الأحداث في سجل Systemix فقط ولا يرسل البوت رسالة إلى Discord.</p>
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-cyan"><Clock3 size={16} /></span><div><h2>المنطقة الزمنية والقنوات الأساسية</h2><p>تستخدمها وحدات Systemix التي تعرض وقتاً أو تنبيهًا.</p></div></div></div>
          <SelectField label="المنطقة الزمنية" value={draft.general.timezone} options={[{ value: "Asia/Riyadh", label: "الرياض — UTC+3" }, { value: "UTC", label: "UTC" }, { value: "Asia/Dubai", label: "دبي — UTC+4" }, { value: "Europe/London", label: "لندن" }]} onChange={(value) => updateSection("general", { timezone: value })} />
          <ChannelSelect label="قناة سجل الإشراف" value={draft.general.modLogChannelId} channels={channels} onChange={(value) => updateSection("general", { modLogChannelId: value })} />
          <ChannelSelect label="قناة تنبيهات الحماية" value={draft.general.securityLogChannelId} channels={channels} onChange={(value) => updateSection("general", { securityLogChannelId: value })} />
          <div className="pc-message pc-message-warn"><AlertTriangle size={16} /> لغة لوحة الويب حالياً عربية فقط. لا نوهمك بخيار لغة لا يغيّر المنتج فعلياً.</div>
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-red"><ShieldAlert size={16} /></span><div><h2>إعداد Anti-Nuke الافتراضي</h2><p>إعداد فعلي يُستخدم عندما تكون سياسة الحماية مفعلة.</p></div></div><SwitchRow label="تفعيل Anti-Nuke" checked={draft.antiNuke.enabled} onChange={(value) => updateSection("antiNuke", { enabled: value })} /></div>
          <div className="pc-fields"><NumberField label="العتبة" value={draft.antiNuke.threshold} min={2} max={20} onChange={(value) => updateSection("antiNuke", { threshold: value })} /><NumberField label="نافذة الرصد (ثوان)" value={draft.antiNuke.windowSeconds} min={5} max={120} onChange={(value) => updateSection("antiNuke", { windowSeconds: value })} /></div>
          <SelectField label="الإجراء بعد العتبة" value={draft.antiNuke.punishment} options={[{ value: "alert", label: "تنبيه فقط" }, { value: "strip_roles", label: "إزالة رتب خطرة قابلة للإزالة" }, { value: "timeout", label: "Timeout" }, { value: "kick", label: "طرد" }, { value: "ban", label: "حظر" }]} onChange={(value) => updateSection("antiNuke", { punishment: value as GuildSecurityConfig["antiNuke"]["punishment"] })} />
          <p className="pc-hint">لا يطبق البوت هذا الإجراء إذا كان النمط «مراقبة فقط»، أو إذا فشل سجل التدقيق، أو لم تسمح أذونات Discord وترتيب الرتب.</p>
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-violet"><LockKeyhole size={16} /></span><div><h2>الخصوصية والسياسة</h2><p>حقائق ثابتة، وليست مفاتيح شكلية.</p></div></div></div>
          <div className="pc-message pc-message-success"><CheckCircle2 size={16} /> لا يحفظ Systemix محتوى الرسائل الخام في سجل الحماية.</div>
          <div className="pc-message pc-message-success"><CheckCircle2 size={16} /> كل تعديل من هذه الصفحة يسجل هوية مدير Discord ونطاق الإعداد قبل الكتابة.</div>
          <div className="pc-message pc-message-warn"><AlertTriangle size={16} /> الملخصات المجدولة والبريد والتنبيهات الخاصة غير مفعلة حالياً، لذلك لا توجد أزرار ادعائية لها.</div>
        </article>
      </div>

      <footer className="pc-savebar"><span>{dirty ? "لديك تغييرات حية غير محفوظة" : "الإعدادات متزامنة مع قاعدة Systemix"}</span><button className="pc-button pc-button-primary" onClick={() => { setProblem(""); setConfirmOpen(true); }} disabled={!dirty || saving}><Save size={17} /> مراجعة وحفظ</button></footer>

      {confirmOpen && <div className="pc-modal-backdrop" role="presentation"><section className="pc-modal" role="dialog" aria-modal="true" aria-labelledby="system-settings-confirm-title"><span className="pc-modal-icon"><AlertTriangle size={22} /></span><h2 id="system-settings-confirm-title">تأكيد حفظ إعدادات {guildName}</h2><p>أنت على وشك حفظ إعدادات سجل Discord والمنطقة الزمنية وسياسة Anti-Nuke لهذا السيرفر.</p><p className="pc-modal-audit">يسجل الخادم نية التغيير أولاً. إذا تعذر سجل التدقيق، لا تُحفظ الإعدادات.</p><div className="pc-modal-actions"><button className="pc-button pc-button-secondary" onClick={() => setConfirmOpen(false)} disabled={saving}>إلغاء</button><button className="pc-button pc-button-primary" onClick={() => void save()} disabled={saving}>{saving ? <><LoaderCircle className="pc-spin" size={16} /> جارٍ الحفظ</> : "أؤكد الحفظ"}</button></div></section></div>}
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
