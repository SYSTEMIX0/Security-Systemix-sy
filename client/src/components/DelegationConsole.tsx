import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Fingerprint, LoaderCircle, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { GuildSecurityConfig } from "../../../server/discord/config";
import type { GuildMeta } from "../../../shared/systemix-api";
import { DiscordApiError, discordApi } from "@/lib/discord-api";
import "./ProtectionConsole.css";
import "./CommunityConsole.css";

type Props = { guildId: string; guildName: string };
type Grant = GuildSecurityConfig["delegation"]["grants"][number];
const actions: { value: Grant["action"]; label: string }[] = [
  { value: "add_role", label: "منح رتبة آمنة" },
  { value: "remove_role", label: "إزالة رتبة آمنة" },
  { value: "timeout", label: "Timeout" },
  { value: "untimeout", label: "فك Timeout" },
  { value: "nickname", label: "تعديل اللقب" },
];

function message(error: unknown): string {
  if (error instanceof DiscordApiError) {
    const codes: Record<string, string> = {
      audit_precondition_failed: "تعذّر تسجيل التغيير في سجل التدقيق؛ لم تُحفظ التفويضات.",
      delegation_bot_not_installed: "ثبّت البوت في السيرفر ثم أعد المحاولة.",
      delegation_log_channel_required: "اختر قناة نصية لسجل التفويض قبل تفعيله.",
      delegation_grant_duplicate: "كل تفويض يحتاج معرفاً فريداً.",
      delegation_actor_role_invalid: "إحدى رتب المنفذين لم تعد موجودة أو هي رتبة تطبيق مُدارة.",
      delegation_target_role_required: "تفويض الرتب يحتاج اختيار رتبة واحدة آمنة على الأقل.",
      delegation_target_role_invalid: "لا يمكن تفويض رتبة مرتفعة أو خطرة أو أعلى من رتبة البوت.",
      delegation_grant_invalid: "اختر رتبة منفذ واحدة على الأقل ولا تكرر الاختيارات.",
    };
    if (codes[error.code]) return codes[error.code];
    if (error.status === 403) return "لا تملك صلاحية إدارة هذا السيرفر في Discord.";
  }
  return "تعذّر تحميل التفويضات أو حفظها. أعد المحاولة بعد التحقق من اتصال Discord.";
}

function safeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

export default function DelegationConsole({ guildId, guildName }: Props) {
  const [config, setConfig] = useState<GuildSecurityConfig | null>(null);
  const [meta, setMeta] = useState<GuildMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [label, setLabel] = useState("");
  const [action, setAction] = useState<Grant["action"]>("add_role");
  const [actorRoleIds, setActorRoleIds] = useState<string[]>([]);
  const [targetRoleIds, setTargetRoleIds] = useState<string[]>([]);
  const [limit, setLimit] = useState(10);
  const [requireReason, setRequireReason] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setProblem(""); setNotice(""); setConfig(null); setMeta(null);
    Promise.all([discordApi.loadGuildSettings(guildId), discordApi.loadGuildMeta(guildId)])
      .then(([snapshot, nextMeta]) => { if (active) { setConfig(snapshot.settings); setMeta(nextMeta); } })
      .catch((error: unknown) => { if (active) setProblem(message(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [guildId, reloadKey]);

  const validRoles = useMemo(() => (meta?.roles ?? []).filter((role) => !role.managed), [meta]);
  const targetRoles = useMemo(() => validRoles.filter((role) => role.assignable && !role.dangerous), [validRoles]);
  const channels = useMemo(() => (meta?.channels ?? []).filter((channel) => channel.type === "text" || channel.type === "announcement"), [meta]);
  const delegation = config?.delegation;

  const persist = async (next: GuildSecurityConfig["delegation"], summary: string) => {
    if (!config) return;
    if (!window.confirm(`${summary}\nسيُسجّل Systemix طلب التغيير قبل الحفظ. هل تؤكد؟`)) return;
    setSaving(true); setProblem(""); setNotice("");
    try {
      const result = await discordApi.saveGuildSettings(guildId, { delegation: next }, config.mode === "protect" ? "ENABLE_PROTECTION" : "CONFIRM_SETTINGS");
      setConfig(result.settings);
      setNotice("حُفظت سياسة التفويض بعد تسجيل طلب الحفظ في سجل التدقيق.");
    } catch (error) {
      setProblem(message(error));
    } finally { setSaving(false); }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!delegation) return;
    const name = label.trim();
    const id = safeId(name);
    if (!name || !id) { setProblem("اكتب اسم تفويض صالحاً بالأحرف أو الأرقام."); return; }
    if (delegation.grants.some((grant) => grant.id === id)) { setProblem("يوجد تفويض بهذا المعرف بالفعل. غيّر الاسم."); return; }
    if (!actorRoleIds.length) { setProblem("اختر رتبة واحدة على الأقل لمنفذي التفويض."); return; }
    if ((action === "add_role" || action === "remove_role") && !targetRoleIds.length) { setProblem("اختر رتبة آمنة واحدة على الأقل يمكن إدارتها."); return; }
    const grant: Grant = { id, label: name, action, actorRoleIds, targetRoleIds: action === "add_role" || action === "remove_role" ? targetRoleIds : [], maxUsesPerHour: Math.max(1, Math.min(100, limit)), maxTimeoutMinutes: 60, requireReason, protectedRoleIds: validRoles.filter((role) => role.dangerous || !role.assignable).map((role) => role.id) };
    void persist({ ...delegation, grants: [...delegation.grants, grant] }, `إضافة تفويض «${name}»`);
    setLabel(""); setActorRoleIds([]); setTargetRoleIds([]); setLimit(10); setRequireReason(true);
  };

  if (loading && !config) return <section className="protection-console community-console"><div className="pc-state"><LoaderCircle className="pc-spin" size={22} /> جارٍ تحميل التفويضات الحية...</div></section>;
  if (!config || !delegation) return <section className="protection-console community-console"><div className="pc-state pc-error"><AlertTriangle size={22} /> {problem || "تعذّر تحميل إعدادات التفويض."}<button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={16} /> إعادة المحاولة</button></div></section>;

  return <section className="protection-console community-console" dir="rtl">
    <header className="pc-header"><div><div className="pc-eyebrow"><Fingerprint size={15} /> تفويضات حية ومحدودة</div><h1>تفويض الصلاحيات · {guildName}</h1><p>هذه التفويضات لا تمنح إدارة كاملة. البوت يعيد التحقق من ترتيب الرتب والصلاحيات وحد الاستخدام عند كل تنفيذ.</p></div><button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)} disabled={loading || saving}><RefreshCw size={16} /> تحديث</button></header>
    {problem && <div className="pc-message pc-message-error" role="alert"><AlertTriangle size={18} /> {problem}</div>}
    {notice && <div className="pc-message pc-message-success" role="status"><CheckCircle2 size={18} /> {notice}</div>}
    <article className="pc-card"><div className="pc-card-title"><div><span className="pc-icon pc-icon-violet"><Fingerprint size={16} /></span><div><h2>سياسة التفويض</h2><p>تحتاج كل عملية حفظ إلى سجل تدقيق ومراجعة صريحة.</p></div></div><label className="pc-switch-row"><span>تفعيل محرك التفويض</span><input type="checkbox" checked={delegation.enabled} disabled={saving} onChange={(event) => void persist({ ...delegation, enabled: event.currentTarget.checked }, event.currentTarget.checked ? "تفعيل محرك التفويض" : "إيقاف محرك التفويض")} /></label></div><label className="pc-field"><span>قناة سجل التفويض</span><select value={delegation.logChannelId ?? ""} disabled={saving} onChange={(event) => void persist({ ...delegation, logChannelId: event.currentTarget.value || null }, "تغيير قناة سجل التفويض")}><option value="">اختر قناة السجل</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label></article>
    <article className="pc-card" style={{ marginTop: 15 }}><div className="pc-card-title"><div><span className="pc-icon pc-icon-green"><ShieldCheck size={16} /></span><div><h2>التفويضات الموجودة</h2><p>{delegation.grants.length ? `${delegation.grants.length} تفويضاً مفعلاً في السياسة` : "لا توجد تفويضات بعد"}</p></div></div></div>{delegation.grants.length ? <div className="pc-role-options">{delegation.grants.map((grant) => <div className="pc-switch-row" key={grant.id}><span><strong>{grant.label}</strong><small style={{ display: "block", marginTop: 4, color: "var(--pc-muted)" }}><bdi>{grant.id}</bdi> · {actions.find((item) => item.value === grant.action)?.label} · {grant.maxUsesPerHour} استخدام/ساعة · {grant.requireReason ? "سبب إلزامي" : "السبب اختياري"}</small></span><button className="pc-button pc-button-secondary" disabled={saving} onClick={() => void persist({ ...delegation, grants: delegation.grants.filter((item) => item.id !== grant.id) }, `حذف تفويض «${grant.label}»`)} aria-label={`حذف ${grant.label}`}><Trash2 size={15} /> حذف</button></div>)}</div> : <p className="pc-hint">أضف أول تفويض من النموذج التالي. لن يظهر أي موظف أو تفويض تجريبي.</p>}</article>
    <article className="pc-card" style={{ marginTop: 15 }}><div className="pc-card-title"><div><span className="pc-icon pc-icon-cyan"><Plus size={16} /></span><div><h2>تفويض محدود جديد</h2><p>لا تظهر هنا إلا الرتب الموجودة. رتب الهدف تُفلتر تلقائياً إلى الرتب الآمنة وتحت رتبة البوت.</p></div></div></div><form onSubmit={add} className="pc-grid"><label className="pc-field"><span>اسم التفويض</span><input maxLength={80} value={label} onChange={(event) => setLabel(event.currentTarget.value)} placeholder="مثال: منح رتبة Verified" required /></label><label className="pc-field"><span>الإجراء المسموح</span><select value={action} onChange={(event) => setAction(event.currentTarget.value as Grant["action"])}>{actions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><fieldset className="pc-role-field"><legend>من ينفّذ التفويض؟</legend><small>اختر رتبة أو أكثر. يظل تحقق ترتيب الرتب مفروضاً وقت التنفيذ.</small><div className="pc-role-options">{validRoles.map((role) => <label key={role.id}><input type="checkbox" checked={actorRoleIds.includes(role.id)} onChange={(event) => setActorRoleIds((current) => event.currentTarget.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} /><span>{role.name}{role.dangerous ? " · مرتفعة" : ""}</span></label>)}</div></fieldset>{(action === "add_role" || action === "remove_role") && <fieldset className="pc-role-field"><legend>الرتب التي يجوز التعامل معها</legend><small>لا تظهر الرتب الإدارية أو الخطرة أو غير القابلة لإدارة البوت.</small><div className="pc-role-options">{targetRoles.map((role) => <label key={role.id}><input type="checkbox" checked={targetRoleIds.includes(role.id)} onChange={(event) => setTargetRoleIds((current) => event.currentTarget.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} /><span>{role.name}</span></label>)}</div></fieldset>}<label className="pc-field"><span>الحد الأقصى للاستخدامات في الساعة</span><input type="number" min={1} max={100} value={limit} onChange={(event) => setLimit(Number(event.currentTarget.value) || 1)} /></label><label className="pc-switch-row"><span>إلزام سبب عند التنفيذ</span><input type="checkbox" checked={requireReason} onChange={(event) => setRequireReason(event.currentTarget.checked)} /></label><button className="pc-button pc-button-primary" type="submit" disabled={saving}><Plus size={16} /> إضافة وحفظ التفويض</button></form></article>
  </section>;
}
