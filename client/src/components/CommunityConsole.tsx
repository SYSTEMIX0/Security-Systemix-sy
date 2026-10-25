import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Save, Users } from "lucide-react";
import type { GuildSecurityConfig, GuildSecurityPatch } from "../../../server/discord/config";
import type { GuildMeta } from "../../../shared/systemix-api";
import { DiscordApiError, discordApi, type DiscordGuildSnapshot } from "@/lib/discord-api";
import "./ProtectionConsole.css";
import "./CommunityConsole.css";

type Props = { guildId: string; guildName: string };
type EditableSection = "tickets" | "giveaways" | "welcome" | "leveling" | "suggestions";

function errorMessage(error: unknown): string {
  if (error instanceof DiscordApiError && error.code === "audit_precondition_failed") return "تعذّر تسجيل التغيير في سجل التدقيق؛ لم تُحفظ الإعدادات.";
  if (error instanceof DiscordApiError && error.code === "ticket_bot_not_installed") return "ثبّت البوت في هذا السيرفر وشغّله قبل تفعيل نظام التذاكر.";
  if (error instanceof DiscordApiError && error.code === "ticket_category_or_panel_required") return "لتفعيل التذاكر اختر فئة التذاكر وقناة اللوحة النصية أولاً.";
  if (error instanceof DiscordApiError && (error.code === "ticket_staff_role_required" || error.code === "ticket_staff_role_invalid")) return "لتفعيل التذاكر اختر رتبة دعم حقيقية وقابلة للاستخدام، ولا تستخدم رتبة @everyone أو رتبة تطبيق مُدارة.";
  if (error instanceof DiscordApiError && error.status === 403) return "لا تملك صلاحية إدارة هذا السيرفر في Discord.";
  return "تعذّر تحميل إعدادات المجتمع أو حفظها. تحقق من الاتصال ثم أعد المحاولة.";
}

export default function CommunityConsole({ guildId, guildName }: Props) {
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
    // A previous guild draft must never be editable while this guild is loading.
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
  const textChannels = useMemo(() => (meta?.channels ?? []).filter((channel) => channel.type === "text" || channel.type === "announcement"), [meta]);
  const categories = useMemo(() => (meta?.channels ?? []).filter((channel) => channel.type === "category"), [meta]);
  const roles = useMemo(() => (meta?.roles ?? []).filter((role) => !role.managed), [meta]);

  const updateSection = <K extends EditableSection>(key: K, changes: Partial<GuildSecurityConfig[K]>) => {
    setDraft((current) => current ? { ...current, [key]: { ...current[key], ...changes } } as GuildSecurityConfig : current);
  };

  const save = async () => {
    if (!draft || !snapshot) return;
    const saveGuildId = guildId;
    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const patch: GuildSecurityPatch = {
        tickets: draft.tickets,
        giveaways: draft.giveaways,
        welcome: draft.welcome,
        leveling: draft.leveling,
        suggestions: draft.suggestions,
      };
      const result = await discordApi.saveGuildSettings(guildId, patch, draft.mode === "protect" ? "ENABLE_PROTECTION" : "CONFIRM_SETTINGS");
      if (activeGuildId.current !== saveGuildId) return;
      setSnapshot((current) => current ? { ...current, settings: result.settings } : current);
      setDraft(result.settings);
      setNotice("حُفظت إعدادات المجتمع بعد تسجيل طلب التغيير في سجل التدقيق.");
      setConfirmOpen(false);
    } catch (error) {
      setProblem(errorMessage(error));
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !draft) return <section className="protection-console community-console"><div className="pc-state"><LoaderCircle className="pc-spin" size={22} /> جارٍ تحميل إعدادات المجتمع...</div></section>;
  if (!draft || !snapshot) return <section className="protection-console community-console"><div className="pc-state pc-error"><AlertTriangle size={22} /><span>{problem || "تعذّر تحميل إعدادات السيرفر."}</span><button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={16} /> إعادة المحاولة</button></div></section>;

  return (
    <section className="protection-console community-console" dir="rtl">
      <header className="pc-header">
        <div><div className="pc-eyebrow"><Users size={15} /> إدارة المجتمع · إعدادات حية</div><h1>مجتمع {guildName}</h1><p>اضبط إعدادات الوحدات لهذا السيرفر. تُحفظ في قاعدة Systemix ويُسجل طلب التغيير قبل الكتابة.</p></div>
        <button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)} disabled={loading || saving}><RefreshCw size={16} /> تحديث</button>
      </header>

      {problem && <div className="pc-message pc-message-error" role="alert"><AlertTriangle size={18} /> {problem}</div>}
      {notice && <div className="pc-message pc-message-success" role="status"><CheckCircle2 size={18} /> {notice}</div>}
      <div className="pc-message pc-message-warn"><AlertTriangle size={18} /> هذه الصفحة تحفظ إعدادات الوحدات. إرسال لوحات التذاكر وتشغيل المسابقات/الفعاليات من Discord ما يزال يحتاج استكمال واجهات الإجراء؛ لا تُعرض هذه الإجراءات هنا كأنها نُفّذت.</div>

      <div className="pc-grid">
        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-blue">01</span><div><h2>التذاكر والدعم</h2><p>قنوات وفريق ورسائل مركز الدعم</p></div></div><SwitchRow label="تفعيل الوحدة" checked={draft.tickets.enabled} onChange={(checked) => updateSection("tickets", { enabled: checked })} /></div>
          <ChannelSelect label="فئة التذاكر" value={draft.tickets.categoryId} channels={categories} onChange={(value) => updateSection("tickets", { categoryId: value })} />
          <ChannelSelect label="قناة لوحة التذاكر" value={draft.tickets.panelChannelId} channels={textChannels} onChange={(value) => updateSection("tickets", { panelChannelId: value })} />
          <RolePicker label="رتب فريق الدعم" roles={roles} selected={draft.tickets.staffRoleIds} onChange={(value) => updateSection("tickets", { staffRoleIds: value })} />
          <NumberField label="أقصى تذاكر مفتوحة لكل عضو" value={draft.tickets.maxOpenPerUser} min={1} max={5} onChange={(value) => updateSection("tickets", { maxOpenPerUser: value })} />
          <TextField label="عنوان اللوحة" value={draft.tickets.panelTitle} maxLength={100} onChange={(value) => updateSection("tickets", { panelTitle: value })} />
          <TextField label="وصف اللوحة" value={draft.tickets.panelDescription} maxLength={1_000} multiline onChange={(value) => updateSection("tickets", { panelDescription: value })} />
          <TextField label="رسالة فتح التذكرة — يدعم {user}" value={draft.tickets.openMessage} maxLength={1_000} multiline onChange={(value) => updateSection("tickets", { openMessage: value })} />
          <p className="pc-hint">أنواع الطلب الحالية: {draft.tickets.topics.map((topic) => topic.label).join(" · ") || "لا توجد أنواع بعد"}. بعد الحفظ استخدم <bdi dir="ltr">/ticket panel</bdi> في Discord لنشر أو تحديث اللوحة. لا يتم حفظ نصوص المحادثات في هذه النسخة، لذلك لا توجد «قناة نصوص محفوظة» شكلية.</p>
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-violet">02</span><div><h2>الهدايا والسحوبات</h2><p>تفعيل الوحدة وتحديد المدراء الافتراضيين</p></div></div><SwitchRow label="تفعيل الوحدة" checked={draft.giveaways.enabled} onChange={(checked) => updateSection("giveaways", { enabled: checked })} /></div>
          <ChannelSelect label="القناة الافتراضية" value={draft.giveaways.defaultChannelId} channels={textChannels} onChange={(value) => updateSection("giveaways", { defaultChannelId: value })} />
          <RolePicker label="رتب إدارة السحوبات" roles={roles} selected={draft.giveaways.managerRoleIds} onChange={(value) => updateSection("giveaways", { managerRoleIds: value })} />
          <p className="pc-hint">تغيير الإعداد لا ينشئ سحباً ولا يعلن عنه. إنشاء السحب واختيار الفائز يحتاجان استكمال واجهة الإجراء ومراجعة صلاحيات Discord.</p>
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-green">03</span><div><h2>الترحيب والتهيئة</h2><p>رسالة دخول وإعداد أولي للعضو</p></div></div><SwitchRow label="تفعيل الترحيب" checked={draft.welcome.enabled} onChange={(checked) => updateSection("welcome", { enabled: checked })} /></div>
          <ChannelSelect label="قناة الترحيب" value={draft.welcome.channelId} channels={textChannels} onChange={(value) => updateSection("welcome", { channelId: value })} />
          <TextField label="رسالة الترحيب — {user} و{server} و{count}" value={draft.welcome.message} maxLength={1_500} multiline onChange={(value) => updateSection("welcome", { message: value })} />
          <SwitchRow label="استخدام Embed" checked={draft.welcome.useEmbed} onChange={(checked) => updateSection("welcome", { useEmbed: checked })} />
          <SwitchRow label="رسالة خاصة للعضو" checked={draft.welcome.dmEnabled} onChange={(checked) => updateSection("welcome", { dmEnabled: checked })} />
          {draft.welcome.dmEnabled && <TextField label="نص الرسالة الخاصة" value={draft.welcome.dmMessage} maxLength={1_500} multiline onChange={(value) => updateSection("welcome", { dmMessage: value })} />}
          <SwitchRow label="رسالة مغادرة" checked={draft.welcome.goodbyeEnabled} onChange={(checked) => updateSection("welcome", { goodbyeEnabled: checked })} />
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-cyan">04</span><div><h2>المستويات والتفاعل</h2><p>إعداد XP ومكافآت المجتمع الاجتماعية</p></div></div><SwitchRow label="تفعيل XP" checked={draft.leveling.enabled} onChange={(checked) => updateSection("leveling", { enabled: checked })} /></div>
          <div className="pc-fields"><NumberField label="أقل XP للرسالة" value={draft.leveling.xpMin} min={1} max={100} onChange={(value) => updateSection("leveling", { xpMin: Math.min(value, draft.leveling.xpMax) })} /><NumberField label="أعلى XP للرسالة" value={draft.leveling.xpMax} min={1} max={200} onChange={(value) => updateSection("leveling", { xpMax: Math.max(value, draft.leveling.xpMin) })} /></div>
          <NumberField label="فترة التهدئة (ثوانٍ)" value={draft.leveling.cooldownSeconds} min={10} max={600} onChange={(value) => updateSection("leveling", { cooldownSeconds: value })} />
          <SelectField label="مكان إعلان المستوى" value={draft.leveling.announce} options={[{ value: "off", label: "بدون إعلان" }, { value: "current", label: "القناة الحالية" }, { value: "channel", label: "قناة محددة" }]} onChange={(value) => updateSection("leveling", { announce: value as GuildSecurityConfig["leveling"]["announce"] })} />
          {draft.leveling.announce === "channel" && <ChannelSelect label="قناة إعلان المستوى" value={draft.leveling.announceChannelId} channels={textChannels} onChange={(value) => updateSection("leveling", { announceChannelId: value })} />}
          <p className="pc-hint">XP اجتماعي فقط، ولا يمنح صلاحيات أمنية أو إدارية تلقائياً. لا تعدّل هذه الصفحة مكافآت الرتب حالياً.</p>
        </article>

        <article className="pc-card">
          <div className="pc-card-title"><div><span className="pc-icon pc-icon-orange">05</span><div><h2>المقترحات</h2><p>قناة استقبال ومراجعة اقتراحات المجتمع</p></div></div><SwitchRow label="تفعيل الوحدة" checked={draft.suggestions.enabled} onChange={(checked) => updateSection("suggestions", { enabled: checked })} /></div>
          <ChannelSelect label="قناة المقترحات" value={draft.suggestions.channelId} channels={textChannels} onChange={(value) => updateSection("suggestions", { channelId: value })} />
          <RolePicker label="رتب المراجعين" roles={roles} selected={draft.suggestions.reviewerRoleIds} onChange={(value) => updateSection("suggestions", { reviewerRoleIds: value })} />
          <SwitchRow label="السماح بالمقترحات المجهولة" checked={draft.suggestions.allowAnonymous} onChange={(checked) => updateSection("suggestions", { allowAnonymous: checked })} />
          <SwitchRow label="إنشاء نقاش مرتبط" checked={draft.suggestions.createThreads} onChange={(checked) => updateSection("suggestions", { createThreads: checked })} />
        </article>
      </div>

      <footer className="pc-savebar"><span>{dirty ? "لديك تغييرات غير محفوظة" : "الإعدادات متزامنة مع قاعدة Systemix"}</span><button className="pc-button pc-button-primary" onClick={() => { setProblem(""); setConfirmOpen(true); }} disabled={!dirty || saving}><Save size={17} /> مراجعة وحفظ</button></footer>

      {confirmOpen && <div className="pc-modal-backdrop" role="presentation"><section className="pc-modal" role="dialog" aria-modal="true" aria-labelledby="community-confirm-title"><span className="pc-modal-icon"><AlertTriangle size={22} /></span><h2 id="community-confirm-title">تأكيد حفظ إعدادات المجتمع</h2><p>سيحفظ Systemix إعدادات الوحدات المحددة لهذا السيرفر. لا تعني هذه العملية إرسال لوحة أو إنشاء سحب.</p><p className="pc-modal-audit">سيُسجل طلب التغيير أولاً. إذا فشل سجل التدقيق، سيرفض الخادم الكتابة.</p><div className="pc-modal-actions"><button className="pc-button pc-button-secondary" onClick={() => setConfirmOpen(false)} disabled={saving}>إلغاء</button><button className="pc-button pc-button-primary" onClick={() => void save()} disabled={saving}>{saving ? <><LoaderCircle className="pc-spin" size={16} /> جارٍ الحفظ</> : "أؤكد الحفظ"}</button></div></section></div>}
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

function TextField({ label, value, maxLength, multiline = false, onChange }: { label: string; value: string; maxLength: number; multiline?: boolean; onChange: (value: string) => void }) {
  return <label className="pc-field"><span>{label}</span>{multiline ? <textarea maxLength={maxLength} rows={3} value={value} onChange={(event) => onChange(event.currentTarget.value)} /> : <input maxLength={maxLength} value={value} onChange={(event) => onChange(event.currentTarget.value)} />}</label>;
}

function ChannelSelect({ label, value, channels, onChange }: { label: string; value: string | null; channels: GuildMeta["channels"]; onChange: (value: string | null) => void }) {
  return <label className="pc-field"><span>{label}</span><select value={value ?? ""} onChange={(event) => onChange(event.currentTarget.value || null)}><option value="">غير محددة</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.type === "category" ? "▰" : "#"}{channel.name}</option>)}</select></label>;
}

function RolePicker({ label, roles, selected, onChange }: { label: string; roles: GuildMeta["roles"]; selected: string[]; onChange: (value: string[]) => void }) {
  return <fieldset className="pc-role-field"><legend>{label}</legend><small>حد أقصى 10 رتب؛ اختر الأدوار الموثوقة فقط.</small>{roles.length ? <div className="pc-role-options">{roles.map((role) => <label key={role.id}><input type="checkbox" checked={selected.includes(role.id)} onChange={(event) => onChange(event.currentTarget.checked ? selected.length < 10 ? [...selected, role.id] : selected : selected.filter((id) => id !== role.id))} /><span>{role.name}{role.dangerous ? " · صلاحية مرتفعة" : ""}</span></label>)}</div> : <small>تظهر الرتب بعد تثبيت البوت في السيرفر.</small>}</fieldset>;
}
