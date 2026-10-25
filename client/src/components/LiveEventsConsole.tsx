import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { DiscordApiError, discordApi, type DiscordSecurityEvent } from "@/lib/discord-api";
import "./ProtectionConsole.css";

type Props = { guildId: string; guildName: string; view: "logs" | "incidents" };

function errorMessage(error: unknown): string {
  if (error instanceof DiscordApiError) {
    if (error.status === 403) return "لا تملك صلاحية إدارة هذا السيرفر في Discord.";
    if (error.code === "guild_config_unavailable") return "قاعدة بيانات إعدادات السيرفر غير متاحة حالياً.";
  }
  return "تعذّر تحميل الأحداث الحية. تحقق من الاتصال ثم أعد المحاولة.";
}

function severityLabel(severity: DiscordSecurityEvent["severity"]): string {
  return severity === "high" ? "مرتفع" : severity === "medium" ? "متوسط" : "عادي";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "وقت غير متاح" : date.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
}

function compactDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details).slice(0, 4);
  if (!entries.length) return "لا توجد تفاصيل إضافية.";
  return entries.map(([key, value]) => {
    const normalized = Array.isArray(value) ? value.join(", ") : value === null ? "—" : String(value);
    return `${key}: ${normalized.slice(0, 100)}`;
  }).join(" · ");
}

export default function LiveEventsConsole({ guildId, guildName, view }: Props) {
  const [events, setEvents] = useState<DiscordSecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const isIncidents = view === "incidents";

  useEffect(() => {
    let active = true;
    setLoading(true);
    setProblem("");
    discordApi.loadGuildEvents(guildId)
      .then((result) => { if (active) setEvents(result.events); })
      .catch((error: unknown) => { if (active) setProblem(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [guildId, reloadKey]);

  const visibleEvents = useMemo(() => isIncidents
    ? events.filter((event) => event.severity !== "low" || event.eventType.startsWith("anti_"))
    : events, [events, isIncidents]);

  const title = isIncidents ? "الحوادث الحية" : "سجل التدقيق الحي";
  const subtitle = isIncidents
    ? "إشارات الحماية المسجلة فعلياً لهذا السيرفر فقط. لا نركّب حوادث افتراضية عند غيابها."
    : "أحداث Systemix المحفوظة فعلياً في قاعدة البيانات لهذا السيرفر فقط.";

  return (
    <section className="protection-console" dir="rtl">
      <header className="pc-header">
        <div><div className="pc-eyebrow">{isIncidents ? <ShieldAlert size={15} /> : <Activity size={15} />} بيانات حية فقط</div><h1>{title} · {guildName}</h1><p>{subtitle}</p></div>
        <button className="pc-button pc-button-secondary" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}><RefreshCw size={16} /> تحديث</button>
      </header>
      {problem && <div className="pc-message pc-message-error" role="alert"><AlertTriangle size={18} /> {problem}</div>}
      {loading ? <div className="pc-state"><LoaderCircle className="pc-spin" size={22} /> جارٍ تحميل الأحداث الحية...</div> : !problem && visibleEvents.length === 0 ? <div className="pc-state"><CheckCircle2 size={22} /> لا توجد {isIncidents ? "حوادث" : "أحداث"} مسجلة لهذا السيرفر حتى الآن.</div> : <div className="pc-grid">{visibleEvents.map((event) => <article className="pc-card" key={event.id}><div className="pc-card-title"><div><span className={`pc-icon ${event.severity === "high" ? "pc-icon-red" : event.severity === "medium" ? "pc-icon-orange" : "pc-icon-green"}`}>{String(event.id)}</span><div><h2>{event.eventType}</h2><p>{formatTime(event.createdAt)}</p></div></div><span className={`pc-status ${event.severity === "high" ? "pc-status-warn" : "pc-status-good"}`}><i /> {severityLabel(event.severity)}</span></div><p className="pc-hint">{compactDetails(event.details)}</p><div className="pc-status-row"><span className="pc-status">المنفذ: {event.actorId ?? "غير متاح"}</span><span className="pc-status">المستهدف: {event.targetId ?? "غير متاح"}</span></div></article>)}</div>}
    </section>
  );
}
