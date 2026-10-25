import { Activity, AlertTriangle, Bot, DatabaseBackup, LockKeyhole, RefreshCw, Server, ShieldCheck } from "lucide-react";
import type { DiscordDashboardData, RuntimeReadiness } from "@/lib/discord-api";
import type { DashboardSection } from "@/lib/systemix-demo";
import "./RuntimeStatus.css";

type RuntimeStatusBannerProps = {
  data: DiscordDashboardData;
  readiness: RuntimeReadiness | null;
  onDetails: () => void;
};

function describeRuntime(data: DiscordDashboardData, readiness: RuntimeReadiness | null): string {
  if (readiness?.code === "database_unavailable" || readiness?.migration.state === "missing_database" || readiness?.migration.state === "connection_failed") {
    return "قاعدة البيانات غير متاحة أو غير مربوطة؛ لذلك تُحجب وظائف الحفظ والتدقيق، ولا يُسمح بتشغيل Gateway الإنتاجي.";
  }
  if (readiness?.code === "migrations_pending" || readiness?.migration.state === "failed" || readiness?.migration.state === "running") {
    return "قاعدة البيانات أو ترحيلاتها لم تصبح جاهزة بعد. انتظر اكتمال الإعداد ثم حدّث الحالة قبل تشغيل البوت.";
  }
  switch (data.bot.status) {
    case "disabled_by_policy":
      return "اتصال Gateway مقفول بسياسة الأمان. لن يعمل البوت حتى تجهز قاعدة البيانات والاستضافة المطلوبة ثم تسمح سياسة النشر بذلك.";
    case "blocked_by_readiness":
      return "منع الخادم اتصال Gateway لأن فحص قاعدة البيانات أو الترحيلات لم ينجح.";
    case "not_configured":
      return "إعدادات Discord المطلوبة غير مكتملة. راجع متطلبات التشغيل من مركز العمليات.";
    case "connecting":
      return "الخادم يحاول الاتصال بـDiscord ولم يستلم تأكيد الجاهزية بعد.";
    case "degraded":
      return `الاتصال يحتاج مراجعة${data.bot.lastErrorCode ? `؛ رمز الحالة: ${data.bot.lastErrorCode}` : ""}.`;
    case "ready":
      return readiness ? "Gateway متصل، لكن فحص الجاهزية لم يؤكد أن قاعدة البيانات جاهزة." : "تعذر قراءة فحص الجاهزية؛ لا نعتبر البوت جاهزاً حتى يصل تأكيد من الخادم.";
  }
}

export function RuntimeStatusBanner({ data, readiness, onDetails }: RuntimeStatusBannerProps) {
  if (data.bot.status === "ready" && readiness?.ready) return null;
  const connected = data.bot.status === "ready";
  return (
    <section className="runtime-status-banner" role="status" aria-live="polite">
      <span className="runtime-status-banner__mark"><AlertTriangle size={18} /></span>
      <div className="runtime-status-banner__copy">
        <small>حالة التشغيل الحقيقية</small>
        <strong>{connected ? "اتصال البوت ظاهر، لكن فحص قاعدة البيانات غير جاهز" : "الموقع يعمل، لكن بوت Discord غير متصل حالياً"}</strong>
        <span>{describeRuntime(data, readiness)}</span>
      </div>
      <button className="button button-secondary runtime-status-banner__action" onClick={onDetails}>تفاصيل الحالة والخطوات</button>
    </section>
  );
}

type LiveOverviewProps = {
  data: DiscordDashboardData;
  readiness: RuntimeReadiness | null;
  selectedGuild: DiscordDashboardData["guilds"][number] | null;
  loading: boolean;
  onConnect: () => void;
  onRefresh: () => Promise<void>;
  onOperations: () => void;
};

function databaseStatus(data: DiscordDashboardData, readiness: RuntimeReadiness | null): string {
  if (readiness?.ready) return "اتصال وترحيلات جاهزة";
  if (!data.databaseConfigured || readiness?.migration.state === "missing_database") return "قاعدة البيانات غير مربوطة";
  if (readiness?.migration.state === "connection_failed") return "فشل الاتصال بقاعدة البيانات";
  if (readiness?.migration.state === "failed") return "فشلت الترحيلات";
  return "لم تجتز فحص الجاهزية";
}

function gatewayStatus(data: DiscordDashboardData): string {
  switch (data.bot.status) {
    case "ready": return "متصل";
    case "disabled_by_policy": return "متوقف بسياسة الأمان";
    case "blocked_by_readiness": return "محجوب لعدم الجاهزية";
    case "connecting": return "جارٍ الاتصال";
    case "degraded": return "يحتاج مراجعة";
    case "not_configured": return "غير مهيأ";
  }
}

export function LiveOverview({ data, readiness, selectedGuild, loading, onConnect, onRefresh, onOperations }: LiveOverviewProps) {
  const guildStatus = !selectedGuild
    ? data.user ? "اختر سيرفراً من ربط Discord" : "لم يتم ربط حساب Discord"
    : selectedGuild.botInstalled ? `البوت مضاف إلى ${selectedGuild.name}` : `البوت غير مضاف إلى ${selectedGuild.name}`;
  const detail = !data.user
    ? "اربط حساب Discord لعرض السيرفرات التي تملك صلاحية إدارتها. لا تظهر هنا إحصاءات أو أحداث نموذجية على أنها بيانات حقيقية."
    : !selectedGuild
      ? "اختر سيرفراً من صفحة ربط Discord. بعدها نتحقق من وجود البوت وحالة Gateway قبل عرض البيانات."
      : !selectedGuild.botInstalled
        ? "أضف البوت إلى السيرفر أولاً، ثم تحقق من صلاحياته وIntents. سيبقى التشغيل محجوباً حتى تجهز قاعدة البيانات أيضاً."
        : "السيرفر محدد، لكن البوت غير جاهز حالياً؛ لا توجد إحصاءات أمنية حية لعرضها بعد.";
  const currentDatabaseStatus = databaseStatus(data, readiness);
  const currentGatewayStatus = gatewayStatus(data);

  return (
    <div className="live-overview-page">
      <header className="live-overview-heading">
        <span className="live-overview-eyebrow"><Activity size={13} /> SYSTEMIX · LIVE STATUS</span>
        <h1>ملخص التشغيل الفعلي</h1>
        <p>نعرض ما أكده الخادم فقط؛ لا نملأ الصفحة بأرقام أو حوادث تجريبية عندما لا يكون البوت متصلاً.</p>
      </header>
      <section className="live-overview-hero">
        <div className="live-overview-copy">
          <span className="live-overview-status"><i />{currentGatewayStatus}</span>
          <h2>{guildStatus}</h2>
          <p>{detail}</p>
        </div>
        <div className="live-overview-facts">
          <div className="live-overview-fact"><span>حساب Discord</span><strong>{data.user?.username ?? "غير مربوط"}</strong></div>
          <div className="live-overview-fact"><span>سيرفرات قابلة للإدارة</span><strong>{data.guilds.length}</strong></div>
          <div className="live-overview-fact"><span>قاعدة البيانات</span><strong>{currentDatabaseStatus}</strong></div>
          <div className="live-overview-fact"><span>Gateway</span><strong>{currentGatewayStatus}</strong></div>
        </div>
      </section>
      <div className="live-overview-grid">
        <article className="live-overview-card"><span className="live-overview-card-icon"><ShieldCheck size={16} /></span><div className="live-overview-card-copy"><small>Discord OAuth</small><strong>{data.oauthConfigured ? "الإعداد موجود" : "غير مهيأ"}</strong><span>{data.oauthConfigured ? "وجود المتغير لا يثبت نجاح تسجيل الدخول؛ اختبر الربط." : "يلزم إعداد بيانات OAuth في Render."}</span></div></article>
        <article className="live-overview-card"><span className="live-overview-card-icon"><DatabaseBackup size={16} /></span><div className="live-overview-card-copy"><small>MySQL وعمليات الحفظ</small><strong>{currentDatabaseStatus}</strong><span>لا نسمح بتشغيل الحماية قبل نجاح فحص القاعدة والترحيلات.</span></div></article>
        <article className="live-overview-card"><span className="live-overview-card-icon"><Bot size={16} /></span><div className="live-overview-card-copy"><small>سجل وحدات البوت</small><strong>{data.bot.moduleCount} / {data.bot.totalModuleCount}</strong><span>عدد الوحدات المنفذة في المصدر، وليس دليلاً على تفعيلها في السيرفر.</span></div></article>
      </div>
      <div className="live-overview-steps" aria-label="خطوات التشغيل">
        <article className="live-overview-step"><b className="live-overview-step-number">1</b><div><strong>اربط حسابك واختر السيرفر</strong><span>لا ترسل أي Token أو سر في المحادثة.</span></div></article>
        <article className="live-overview-step"><b className="live-overview-step-number">2</b><div><strong>أضف البوت بصلاحياته اللازمة</strong><span>تأكد من الرتبة وIntents من Discord Developer Portal.</span></div></article>
        <article className="live-overview-step"><b className="live-overview-step-number">3</b><div><strong>جهّز MySQL ثم أعد الفحص</strong><span>لا يبدأ Gateway في الإنتاج قبل نجاح readiness.</span></div></article>
      </div>
      <div className="live-overview-actions">
        <button className="button button-primary" onClick={onConnect}>ربط Discord / اختيار سيرفر</button>
        <button className="button button-secondary" onClick={onOperations}><Server size={14} />مركز تشغيل البوت</button>
        <button className="button button-secondary" onClick={() => void onRefresh()} disabled={loading}><RefreshCw size={14} />{loading ? "يتم التحديث..." : "تحديث الحالة"}</button>
      </div>
      <div className="live-overview-disclaimer"><LockKeyhole size={14} /><span>حتى يظهر Gateway كـ«متصل» مع readiness «جاهز»، لا تعتمد على هذا البوت لحماية سيرفر إنتاجي ولا تعلن عنه كخدمة حماية مدفوعة.</span></div>
    </div>
  );
}
