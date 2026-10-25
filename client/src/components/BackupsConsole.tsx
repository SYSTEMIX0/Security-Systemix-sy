import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseBackup, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { DiscordApiError, discordApi, type GuildBackupSummary } from "@/lib/discord-api";
import "./ProtectionConsole.css";
import "./CommunityConsole.css";

type Props = { guildId: string; guildName: string };

function errorMessage(error: unknown): string {
  if (error instanceof DiscordApiError) {
    if (error.code === "audit_precondition_failed") return "تعذّر إنشاء سجل التدقيق قبل النسخ؛ لم تُنشأ أي نسخة.";
    if (error.code === "bot_not_ready") return "البوت غير متصل حالياً؛ انتظر اتصاله ثم أعد المحاولة.";
    if (error.code === "bot_not_installed") return "البوت غير مثبت في هذا السيرفر.";
    if (error.code === "backup_creation_failed") return "تعذّر حفظ النسخة البنيوية. لم تُجرَ أي عملية استعادة أو تعديل على السيرفر.";
    if (error.status === 403) return "لا تملك صلاحية إدارة هذا السيرفر في Discord.";
  }
  return "تعذّر تحميل النسخ أو إنشاؤها. أعد المحاولة، وإن استمر الخطأ راجع اتصال قاعدة البيانات.";
}

function kindLabel(kind: GuildBackupSummary["kind"]): string {
  return kind === "pre_incident" ? "قبل حادث" : kind === "auto" ? "تلقائية" : "يدوية";
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "وقت غير معروف" : new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function BackupsConsole({ guildId, guildName }: Props) {
  const [backups, setBackups] = useState<GuildBackupSummary[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setProblem("");
    setNotice("");
    void discordApi.loadGuildBackups(guildId)
      .then((result) => { if (active) setBackups(result.backups); })
      .catch((error: unknown) => { if (active) setProblem(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [guildId, reloadKey]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setProblem("");
    setNotice("");
    try {
      const result = await discordApi.createGuildBackup(guildId, label);
      setBackups((current) => [result.backup, ...current.filter((item) => item.id !== result.backup.id)]);
      setLabel("");
      setNotice(`تم حفظ نسخة بنيوية #${result.backup.id} بعد تسجيل الإجراء في سجل التدقيق.`);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  return <section className="protection-console community-console" dir="rtl">
    <header className="pc-header"><div><div className="pc-eyebrow"><DatabaseBackup size={15} /> نسخ بنيوية حية</div><h1>النسخ والاستعادة · {guildName}</h1><p>احفظ الأدوار والقنوات وأذوناتها فقط. لا تحفظ النسخ الرسائل أو الأعضاء أو كلمات المرور.</p></div><button className="pc-button pc-button-secondary" onClick={() => setReloadKey((key) => key + 1)} disabled={loading || creating}><RefreshCw size={16} /> تحديث</button></header>
    {problem && <div className="pc-message pc-message-error" role="alert"><AlertTriangle size={18} /> {problem}</div>}
    {notice && <div className="pc-message pc-message-success" role="status"><CheckCircle2 size={18} /> {notice}</div>}
    <div className="pc-message pc-message-warn"><AlertTriangle size={18} /> الاستعادة ليست زرّاً سريعاً: تبقى محجوبة حتى يكتمل فحص الفرق وخطة الأثر والتأكيد المزدوج. لن ننشئ استعادة شكلية قد تغيّر سيرفرك بلا مراجعة.</div>
    <article className="pc-card"><div className="pc-card-title"><div><span className="pc-icon pc-icon-green"><DatabaseBackup size={16} /></span><div><h2>إنشاء نسخة جديدة</h2><p>عملية قراءة من Discord وحفظ نسخة بنيوية محدودة في قاعدة Systemix.</p></div></div></div><form className="pc-fields" onSubmit={create}><label className="pc-field"><span>اسم اختياري للنسخة</span><input maxLength={100} value={label} onChange={(event) => setLabel(event.currentTarget.value)} placeholder="مثال: قبل تعديل الرتب" /></label><div className="pc-field"><span>الإجراء</span><button className="pc-button pc-button-primary" type="submit" disabled={creating || loading}>{creating ? <><LoaderCircle className="pc-spin" size={16} /> جارٍ إنشاء النسخة</> : <><DatabaseBackup size={16} /> إنشاء نسخة بنيوية</>}</button></div></form></article>
    <article className="pc-card" style={{ marginTop: 15 }}><div className="pc-card-title"><div><span className="pc-icon pc-icon-cyan"><ShieldCheck size={16} /></span><div><h2>النسخ المتاحة</h2><p>{backups.length ? `${backups.length} نسخة من هذا السيرفر فقط` : "لا توجد نسخ حتى الآن"}</p></div></div></div>{loading ? <div className="pc-state"><LoaderCircle className="pc-spin" size={20} /> جارٍ تحميل النسخ...</div> : backups.length ? <div className="pc-role-options">{backups.map((backup) => <div className="pc-switch-row" key={backup.id}><span><bdi>#{backup.id}</bdi> · {backup.label}<small style={{ display: "block", marginTop: 4, color: "var(--pc-muted)" }}>{kindLabel(backup.kind)} · {backup.roleCount} رتبة · {backup.channelCount} قناة · {dateLabel(backup.createdAt)}</small></span><span className="pc-status pc-status-good"><i /> محفوظة</span></div>)}</div> : <div className="pc-state">لا توجد بيانات نموذجية هنا. أنشئ أول نسخة عندما يكون السيرفر في الحالة التي تريد الاحتفاظ بها.</div>}</article>
  </section>;
}
