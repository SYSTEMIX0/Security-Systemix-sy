import { Activity, AlertTriangle, Bot, CheckCircle2, CircleHelp, Clock3, Command, Database, LockKeyhole, Radio, RefreshCw, Server, ShieldAlert, ShieldCheck, Users, Zap, type LucideIcon } from "lucide-react";
import type { DiscordBotState, DiscordDashboardData } from "@/lib/discord-api";
import type { DashboardSection } from "@/lib/systemix-demo";
import "./BotOperationsPage.css";

type Props = {
  data: DiscordDashboardData;
  loading: boolean;
  error: string | null;
  selectedGuildId: string;
  onRefresh: () => Promise<void>;
  onNavigate: (section: DashboardSection) => void;
};

const statusView: Record<DiscordBotState["status"], { label: string; title: string; detail: string; tone: string }> = {
  not_configured: { label: "غير مهيأ", title: "البوت لم يُجهّز بعد", detail: "أضف بيانات Discord الآمنة، ثم راجع متطلبات قاعدة البيانات قبل التشغيل.", tone: "danger" },
  disabled_by_policy: { label: "متوقف بأمان", title: "Gateway متوقف بسياسة الأمان", detail: "الموقع يعمل، لكن اتصال البوت بـDiscord مقفول حتى تجهّز قاعدة البيانات والاستضافة المناسبة.", tone: "warning" },
  connecting: { label: "جارٍ الاتصال", title: "يحاول الاتصال بـDiscord", detail: "لم يُعلن Discord أن Gateway جاهز بعد؛ انتظر التحديث التالي.", tone: "info" },
  ready: { label: "متصل", title: "Gateway متصل بـDiscord", detail: "هذه حالة الاتصال الحالية التي أبلغ عنها Discord.", tone: "success" },
  degraded: { label: "يحتاج مراجعة", title: "الاتصال يحتاج مراجعة", detail: "تعذر إكمال بعض وظائف الاتصال؛ راجع رمز الخطأ والمتطلبات أدناه.", tone: "danger" },
};

const moduleNames: Record<string, string> = {
  antiNuke: "مكافحة التخريب",
  antiRaid: "مكافحة الغارات",
  antiSpam: "مكافحة السبام",
  honeypot: "المصيدة الأمنية",
  lockdown: "الإغلاق الطارئ",
  backups: "نسخ الإعدادات",
  autoMod: "Discord AutoMod",
  systemix: "نظام Systemix",
  moderation: "الإشراف والعقوبات",
  logging: "السجلات",
  verification: "التحقق",
  delegation: "تفويض الصلاحيات",
  welcome: "الترحيب",
  selfRoles: "الأدوار الذاتية",
  tickets: "التذاكر",
  leveling: "المستويات",
  suggestions: "المقترحات",
  giveaways: "السحوبات",
};

function syncLabel(bot: DiscordBotState): string {
  switch (bot.commandSyncStatus) {
    case "synced": return bot.commandCount === null ? "مزامنة مكتملة" : `تمت مزامنة ${bot.commandCount} أمر`;
    case "pending": return "جارٍ مزامنة أوامر Slash";
    case "failed": return `فشلت آخر مزامنة${bot.commandSyncErrorCode ? ` (${bot.commandSyncErrorCode})` : ""}`;
    default: return "لم تبدأ المزامنة في هذه الجلسة";
  }
}

function formatTime(value: string | null): string {
  if (!value) return "غير متاح";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "غير متاح" : date.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
}

function MetricCard({ icon: Icon, label, value, detail, tone = "mint" }: { icon: LucideIcon; label: string; value: string; detail: string; tone?: string }) {
  return <article className={`bot-ops-metric tone-${tone}`}><span className="bot-ops-metric-icon"><Icon size={17} /></span><div className="bot-ops-metric-copy"><small>{label}</small><strong>{value}</strong><span>{detail}</span></div></article>;
}

function ReadinessRow({ label, ready, detail, stateLabel }: { label: string; ready: boolean; detail: string; stateLabel?: string }) {
  return <div className={`bot-ops-readiness-row ${ready ? "is-ready" : "is-missing"}`}><span className="bot-ops-readiness-icon">{ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span><div><strong>{label}</strong><small>{detail}</small></div><span className="bot-ops-readiness-state">{stateLabel ?? (ready ? "جاهز" : "ناقص")}</span></div>;
}

export default function BotOperationsPage({ data, loading, error, selectedGuildId, onRefresh, onNavigate }: Props) {
  const bot = data.bot;
  const state = statusView[bot.status];
  const implemented = bot.implementedModules;
  const outstandingModules = Math.max(0, bot.totalModuleCount - implemented.length);

  return <div className="bot-ops-page">
    <header className="bot-ops-heading">
      <div><span className="bot-ops-eyebrow"><Activity size={13} /> SYSTEMIX OPERATIONS</span><h1>مركز تشغيل البوت</h1><p>حالة مباشرة للاتصال والتهيئة والوحدات؛ لا توجد هنا أرقام تشغيل تجريبية.</p></div>
      <button className="button button-secondary bot-ops-refresh" onClick={() => void onRefresh()} disabled={loading}><RefreshCw size={15} className={loading ? "bot-ops-spinning" : ""} />{loading ? "يتم التحديث..." : "تحديث الحالة"}</button>
    </header>

    {error && <div className="bot-ops-error" role="status"><AlertTriangle size={16} /><span>تعذر تحديث الحالة الآن. قد تكون المعلومات المعروضة من آخر استجابة ناجحة.</span></div>}

    <section className={`bot-ops-hero bot-ops-${state.tone}`} aria-live="polite">
      <div className="bot-ops-hero-orb"><Bot size={31} /></div>
      <div className="bot-ops-hero-copy"><div className="bot-ops-state-pill"><i />{loading ? "جارٍ التحقق" : state.label}</div><h2>{loading && bot.status === "not_configured" ? "جارٍ جلب حالة البوت" : state.title}</h2><p>{state.detail}</p></div>
      <div className="bot-ops-hero-facts"><span><small>السيرفرات المتصلة</small><strong>{bot.guildCount}</strong></span><span><small>وقت الجاهزية</small><strong>{formatTime(bot.readyAt)}</strong></span>{bot.pingMs !== null && <span><small>استجابة Discord</small><strong>{bot.pingMs} ms</strong></span>}</div>
    </section>

    <div className="bot-ops-metrics">
      <MetricCard icon={Radio} label="تسجيل دخول Discord" value={data.oauthConfigured ? "Secret موجود" : "غير موجود"} detail={data.oauthConfigured ? "وجوده لا يثبت نجاح OAuth callback" : "يلزم إعداد Client Secret"} tone={data.oauthConfigured ? "mint" : "amber"} />
      <MetricCard icon={LockKeyhole} label="مفتاح جلسة اللوحة" value={data.sessionKeyConfigured ? "موجود" : "غير موجود"} detail={data.sessionKeyConfigured ? "لم تُقرأ قيمة المفتاح إلى الواجهة" : "يلزم MANUS_JWT_SECRET"} tone={data.sessionKeyConfigured ? "blue" : "amber"} />
      <MetricCard icon={Database} label="قاعدة البيانات" value={data.databaseConfigured ? "الرابط موجود" : "غير مربوطة"} detail={data.databaseConfigured ? "لم تختبر هذه الصفحة نجاح الاتصال أو الترحيل" : "الحفظ وسجل التدقيق غير متاحين"} tone={data.databaseConfigured ? "mint" : "amber"} />
      <MetricCard icon={Command} label="أوامر Slash" value={syncLabel(bot)} detail={bot.commandSyncStatus === "synced" ? "حالة المزامنة المعلنة من Discord" : "تظهر بعد اتصال Gateway"} tone={bot.commandSyncStatus === "synced" ? "blue" : "muted"} />
    </div>

    <div className="bot-ops-columns">
      <section className="panel bot-ops-panel">
        <div className="bot-ops-panel-heading"><div><span className="bot-ops-eyebrow">READINESS</span><h2>متطلبات التشغيل</h2><p>حالات من الخادم، من دون عرض أي أسرار.</p></div><ShieldCheck size={19} /></div>
        <div className="bot-ops-readiness-list">
          <ReadinessRow label="Discord OAuth" ready={data.oauthConfigured} stateLabel={data.oauthConfigured ? "موجود" : "ناقص"} detail={data.oauthConfigured ? "Client Secret موجود؛ يلزم اختبار callback." : "Client Secret غير موجود."} />
          <ReadinessRow label="مفتاح الجلسة" ready={data.sessionKeyConfigured} stateLabel={data.sessionKeyConfigured ? "موجود" : "ناقص"} detail={data.sessionKeyConfigured ? "المتغير موجود؛ لا تُعرض قيمته هنا." : "أنشئ MANUS_JWT_SECRET عشوائياً في Render."} />
          <ReadinessRow label="MySQL" ready={data.databaseConfigured} stateLabel={data.databaseConfigured ? "الرابط موجود" : "غير مربوط"} detail={data.databaseConfigured ? "وجود الرابط لا يثبت نجاح الاتصال أو الترحيل." : "لا يمكن حفظ الإعدادات أو أحداث التدقيق بعد."} />
          <ReadinessRow label="Gateway الإنتاج" ready={bot.status === "ready"} detail={bot.status === "disabled_by_policy" ? "مقفول بسياسة أمان؛ لا نتجاوزها من الواجهة." : bot.status === "ready" ? "اتصال Discord مؤكد." : "لم يؤكد Discord حالة Ready."} />
        </div>
        <div className="bot-ops-safety-note"><LockKeyhole size={16} /><span>لا يوجد زر تشغيل قسري. يُفتح Gateway بعد تجهيز قاعدة البيانات واستضافة مناسبة؛ لا تشغّله قبل ذلك.</span></div>
      </section>

      <section className="panel bot-ops-panel bot-ops-runtime-panel">
        <div className="bot-ops-panel-heading"><div><span className="bot-ops-eyebrow">LIVE TELEMETRY</span><h2>تفاصيل الاتصال</h2><p>قيم معلنة من Discord Gateway الحالي.</p></div><Zap size={18} /></div>
        <div className="bot-ops-runtime-list">
          <div><span><Users size={15} /> السيرفرات</span><strong>{bot.guildCount}</strong></div>
          <div><span><Command size={15} /> أوامر Slash</span><strong>{syncLabel(bot)}</strong></div>
          <div><span><ShieldAlert size={15} /> Guild Members Intent</span><strong className={bot.memberIntentEnabled ? "text-ready" : "text-warn"}>{bot.memberIntentEnabled ? "متاح" : "غير متاح"}</strong></div>
          <div><span><Activity size={15} /> Message Content Intent</span><strong className={bot.messageContentIntentEnabled ? "text-ready" : "text-warn"}>{bot.messageContentIntentEnabled ? "متاح" : "غير متاح"}</strong></div>
          {bot.lastErrorCode && <div><span><CircleHelp size={15} /> آخر رمز خطأ</span><strong className="bot-ops-error-code">{bot.lastErrorCode}</strong></div>}
        </div>
        <p className="bot-ops-intent-note">توافر Intent لا يعني أن كل وظيفة تعمل؛ يعتمد ذلك على إعداد Discord وصلاحيات البوت.</p>
      </section>
    </div>

    <section className="panel bot-ops-modules">
      <div className="bot-ops-panel-heading"><div><span className="bot-ops-eyebrow">MODULE REGISTRY</span><h2>حالة الوحدات</h2><p>«منفذة في المصدر» ليست مرادفاً لـ«مفعّلة أو مختبرة في سيرفرك».</p></div><span className="bot-ops-module-total">{bot.moduleCount} / {bot.totalModuleCount}</span></div>
      <div className="bot-ops-module-grid">{implemented.map((key) => <article className="bot-ops-module" key={key}><span className="bot-ops-module-dot" /><span>{moduleNames[key] ?? key}</span><small>منفذة في المصدر</small></article>)}{outstandingModules > 0 && <article className="bot-ops-module bot-ops-module-pending"><span className="bot-ops-module-dot" /><span>{outstandingModules === 1 ? "وحدة قيد التطوير" : `${outstandingModules} وحدات قيد التطوير`}</span><small>غير معلنة كمنفذة</small></article>}{implemented.length === 0 && <div className="bot-ops-empty">لم تصل بيانات سجل الوحدات بعد.</div>}</div>
    </section>

    <footer className="bot-ops-footer">
      <div><Clock3 size={15} /><span>حدّث الحالة قبل اتخاذ أي قرار. التشغيل الفعلي لا يُستنتج من ظهور الموقع فقط.</span></div>
      <div className="bot-ops-actions"><button className="button button-secondary" onClick={() => onNavigate("connection")}><Server size={14} />ربط Discord</button><button className="button button-secondary" onClick={() => onNavigate("modules")}><Bot size={14} />مركز الوحدات</button><button className="button button-primary" onClick={() => onNavigate(selectedGuildId ? "protection" : "connection")}><ShieldCheck size={14} />{selectedGuildId ? "إعدادات الحماية" : "اختر سيرفراً"}</button></div>
    </footer>
  </div>;
}
