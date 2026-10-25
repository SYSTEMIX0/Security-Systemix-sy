import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ListFilter, LoaderCircle, RefreshCw, Save, ShieldCheck } from "lucide-react";
import type { GuildSecurityConfig } from "../../../server/discord/config";
import type { GuildMeta } from "../../../shared/systemix-api";
import { DiscordApiError, discordApi } from "@/lib/discord-api";
import "./ProtectionConsole.css";
import "./CommunityConsole.css";

type Props = { guildId: string; guildName: string };

function errorMessage(error: unknown): string {
  if (error instanceof DiscordApiError) {
    if (error.code === "audit_precondition_failed") return "تعذّر تسجيل التغيير في سجل التدقيق؛ لم تُحفظ الاستثناءات.";
    if (error.code === "invalid_settings") return "إحدى القيم غير صالحة. أدخل معرّفات Discord صحيحة أو نطاقات بدون رابط كامل.";
    if (error.status === 403) return "لا تملك صلاحية إدارة هذا السيرفر في Discord.";
  }
  return "تعذّر تحميل الاستثناءات أو حفظها. أعد المحاولة بعد التحقق من الاتصال.";
}

function textList(value: string[]): string { return value.join(", "); }
function splitList(value: string): string[] { return [...new Set(value.split(/[\s,\n]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))]; }
function validSnowflakes(value: string[]): boolean { return value.every((item) => /^\d{17,20}$/.test(item)); }
function validDomains(value: string[]): boolean { return value.every((item) => /^[a-z0-9.-]{3,80}$/.test(item) && !item.startsWith(".") && !item.endsWith(".")); }

function CheckedRoles({ roles, selected, onChange, label, hint }: { roles: GuildMeta["roles"]; selected: string[]; onChange: (value: string[]) => void; label: string; hint: string }) {
  return <fieldset className="pc-role-field"><legend>{label}</legend><small>{hint}</small><div className="pc-role-options">{roles.length ? roles.map((role) => <label key={role.id}><input type="checkbox" checked={selected.includes(role.id)} onChange={(event) => onChange(event.currentTarget.checked ? [...selected, role.id] : selected.filter((id) => id !== role.id))} /><span>{role.name}{role.dangerous ? " · صلاحية مرتفعة" : ""}</span></label>) : <small>تظهر الرتب بعد تثبيت البوت في هذا السيرفر.</small>}</div></fieldset>;
}

function CheckedChannels({ channels, selected, onChange, label }: { channels: GuildMeta["channels"]; selected: string[]; onChange: (value: string[]) => void; label: string }) {
  return <fieldset className="pc-role-field"><legend>{label}</legend><small>لا يعني الاستثناء سماحاً عاماً؛ يقتصر على الوحدة المكتوبة فوقه.</small><div className="pc-role-options">{channels.map((channel) => <label key={channel.id}><input type="checkbox" checked={selected.includes(channel.id)} onChange={(event) => onChange(event.currentTarget.checked ? [...selected, channel.id] : selected.filter((id) => id !== channel.id))} /><span>#{channel.name}</span></label>)}</div></fieldset>;
}

export default function PolicyListsConsole({ guildId, guildName }: Props) {
  const [config, setConfig] = useState<GuildSecurityConfig | null>(null);
  const [meta, setMeta] = useState<GuildMeta | null>(null);
  const [actorIds, setActorIds] = useState("");
  const [autoDomains, setAutoDomains] = useState("");
  const [spamDomains, setSpamDomains] = useState("");
  const [keywords, setKeywords] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setProblem(""); setNotice(""); setConfig(null); setMeta(null);
    Promise.all([discordApi.loadGuildSettings(guildId), discordApi.loadGuildMeta(guildId)])
      .then(([snapshot, nextMeta]) => {
        if (!active) return;
        setConfig(snapshot.settings); setMeta(nextMeta);
        setActorIds(textList(snapshot.settings.antiNuke.allowlistedActorIds));
        setAutoDomains(textList(snapshot.settings.autoMod.allowedLinkDomains));
        setSpamDomains(textList(snapshot.settings.antiSpam.allowedDomains));
        setKeywords(textList(snapshot.settings.autoMod.blockedKeywords));
      })
      .catch((error: unknown) => { if (active) setProblem(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [guildId, reloadKey]);

  const roles = useMemo(() => (meta?.roles ?? []).filter((role) => !role.managed), [meta]);
  const channels = useMemo(() => (meta?.channels ?? []).filter((channel) => channel.type === "text" || channel.type === "announcement"), [meta]);

  const persist = async () => {
    if (!config) return;
    const parsedActorIds = splitList(actorIds);
    const parsedAutoDomains = splitList(autoDomains);
    const parsedSpamDomains = splitList(spamDomains);
    const parsedKeywords = splitList(keywords);
    if (!validSnowflakes(parsedActorIds)) { setProblem("معرفات أعضاء Anti-Nuke يجب أن تكون أرقام Discord صحيحة فقط."); return; }
    if (!validDomains(parsedAutoDomains) || !validDomains(parsedSpamDomains)) { setProblem("اكتب النطاق فقط مثل example.com، بدون https:// أو مسار."); return; }
    if (parsedActorIds.length > 100 || parsedAutoDomains.length > 50 || parsedSpamDomains.length > 50 || parsedKeywords.length > 100) { setProblem("تجاوزت الحد الأقصى لإحدى القوائم."); return; }
    if (!window.confirm("سيُسجّل Systemix طلب تعديل الاستثناءات قبل الحفظ. هل تؤكد؟")) return;
    setSaving(true); setProblem(""); setNotice("");
    try {
      const result = await discordApi.saveGuildSettings(guildId, {
        antiNuke: { ...config.antiNuke, allowlistedActorIds: parsedActorIds },
        autoMod: { ...config.autoMod, allowedLinkDomains: parsedAutoDomains, blockedKeywords: parsedKeywords },
        antiSpam: { ...config.antiSpam, allowedDomains: parsedSpamDomains },
      }, config.mode === "protect" ? "ENABLE_PROTECTION" : "CONFIRM_SETTINGS");
      setConfig(result.settings);
      setActorIds(textList(result.settings.antiNuke.allowlistedActorIds));
      setAutoDomains(textList(result.settings.autoMod.allowedLinkDomains));
      setSpamDomains(textList(result.settings.antiSpam.allowedDomains));
      setKeywords(textList(result.settings.autoMod.blockedKeywords));
      setNotice("حُفظت الاستثناءات والسماحات المقيّدة بعد تسجيل طلب الحفظ في سجل التدقيق.");
    } catch (error) { setProblem(errorMessage(error)); } finally { setSaving(false); }
  };

  const updateConfig = <K extends "antiNuke" | "autoMod" | "antiSpam">(key: K, update: Partial<GuildSecurityConfig[K]>) => setConfig((current) => current ? { ...current, [key]: { ...current[key], ...update } } as GuildSecurityConfig : current);

  if (loading && !config) return <section className="protection-console community-console"><div className="pc-state"><LoaderCircle className="pc-spin" size={22} /> جارٍ تحميل استثناءات الحماية...</div></section>;
  if (!config) return <section className="protection-console community-console"><div className="pc-state pc-error"><AlertTriangle size={22} /> {problem || "تعذّر تحميل إعدادات الاستثناءات."}<button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={16} /> إعادة المحاولة</button></div></section>;

  return <section className="protection-console community-console" dir="rtl">
    <header className="pc-header"><div><div className="pc-eyebrow"><ListFilter size={15} /> استثناءات حية بحسب السياسة</div><h1>قوائم السماح والمنع · {guildName}</h1><p>هذه ليست قائمة عامة. كل قسم يطبق فقط على وحدة الحماية المحددة، وكل تغيير يُدقق قبل الحفظ.</p></div><button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)} disabled={loading || saving}><RefreshCw size={16} /> تحديث</button></header>
    {problem && <div className="pc-message pc-message-error" role="alert"><AlertTriangle size={18} /> {problem}</div>}
    {notice && <div className="pc-message pc-message-success" role="status"><CheckCircle2 size={18} /> {notice}</div>}
    <article className="pc-card"><div className="pc-card-title"><div><span className="pc-icon pc-icon-red"><ShieldCheck size={16} /></span><div><h2>استثناءات Anti-Nuke</h2><p>لا يتعرض أعضاء أو رتب موثوقة لهذه الوحدة فقط، ولا يصبحون معفيين من بقية الحماية.</p></div></div></div><label className="pc-field"><span>معرّفات أعضاء موثوقين (افصل بفاصلة)</span><input value={actorIds} onChange={(event) => setActorIds(event.currentTarget.value)} placeholder="123456789012345678, ..." /></label><CheckedRoles roles={roles} selected={config.antiNuke.allowlistedRoleIds} onChange={(value) => updateConfig("antiNuke", { allowlistedRoleIds: value })} label="رتب موثوقة" hint="تستخدم لعمليات Anti-Nuke فقط. لا تضف رتبة عامة بلا سبب." /></article>
    <div className="pc-grid" style={{ marginTop: 15 }}><article className="pc-card"><div className="pc-card-title"><div><span className="pc-icon pc-icon-blue">AM</span><div><h2>AutoMod</h2><p>سماح نطاقات واستثناءات مخصصة لقواعد AutoMod.</p></div></div></div><label className="pc-field"><span>النطاقات المسموحة</span><input value={autoDomains} onChange={(event) => setAutoDomains(event.currentTarget.value)} placeholder="example.com, discord.com" /></label><label className="pc-field"><span>كلمات محظورة</span><textarea rows={3} maxLength={6100} value={keywords} onChange={(event) => setKeywords(event.currentTarget.value)} placeholder="كلمة1, كلمة2" /></label><CheckedRoles roles={roles} selected={config.autoMod.exemptRoleIds} onChange={(value) => updateConfig("autoMod", { exemptRoleIds: value })} label="رتب مستثناة من AutoMod" hint="هذه الرتب فقط مستثناة من AutoMod." /><CheckedChannels channels={channels} selected={config.autoMod.exemptChannelIds} onChange={(value) => updateConfig("autoMod", { exemptChannelIds: value })} label="قنوات مستثناة من AutoMod" /></article><article className="pc-card"><div className="pc-card-title"><div><span className="pc-icon pc-icon-orange">AS</span><div><h2>Anti-Spam</h2><p>إعداد مستقل ولا يرث سماحات AutoMod تلقائياً.</p></div></div></div><label className="pc-field"><span>النطاقات المسموحة</span><input value={spamDomains} onChange={(event) => setSpamDomains(event.currentTarget.value)} placeholder="example.com, discord.com" /></label><CheckedRoles roles={roles} selected={config.antiSpam.exemptRoleIds} onChange={(value) => updateConfig("antiSpam", { exemptRoleIds: value })} label="رتب مستثناة من Anti-Spam" hint="تظل قواعد AutoMod الأخرى مستقلة." /><CheckedChannels channels={channels} selected={config.antiSpam.exemptChannelIds} onChange={(value) => updateConfig("antiSpam", { exemptChannelIds: value })} label="قنوات مستثناة من Anti-Spam" /></article></div>
    <footer className="pc-savebar"><span>لا يتم دمج قوائم الوحدات أو مزامنتها خفية.</span><button className="pc-button pc-button-primary" onClick={() => void persist()} disabled={saving || loading}>{saving ? <><LoaderCircle className="pc-spin" size={16} /> جارٍ الحفظ</> : <><Save size={16} /> مراجعة وحفظ الاستثناءات</>}</button></footer>
  </section>;
}
