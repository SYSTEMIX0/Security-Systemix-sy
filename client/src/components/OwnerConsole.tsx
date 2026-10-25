import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUpLeft,
  Bot,
  CheckCircle2,
  CircleHelp,
  Copy,
  Database,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import {
  discordApi,
  DiscordApiError,
  type OwnerPanelOverview,
  type OwnerPanelStatus,
  type RuntimeReadiness,
} from "@/lib/discord-api";
import type { DashboardSection } from "@/lib/systemix-demo";
import "./OwnerConsole.css";

type Props = {
  discordUser: { id: string; username: string; avatar: string | null } | null;
  oauthConfigured: boolean;
  onConnect: () => void;
  onNavigate: (section: DashboardSection) => void;
};

function failureText(error: unknown): string {
  if (!(error instanceof DiscordApiError)) return "تعذّر الاتصال بخدمة اللوحة. تحقق من الشبكة ثم أعد المحاولة.";
  if (error.code === "owner_auth_failed") return "تعذر الدخول. تحقق من بيانات المالك، أو انتظر قبل المحاولة التالية.";
  if (error.code === "owner_auth_required") return "انتهت جلسة المالك. سجّل الدخول مرة أخرى.";
  if (error.code === "discord_login_required") return "اربط حساب Discord أولاً.";
  if (error.code === "csrf_validation_failed" || error.code === "origin_not_allowed") return "انتهت جلسة الحماية. حدّث الصفحة ثم أعد المحاولة.";
  if (error.status === 429) return "تجاوزت حد محاولات الدخول. انتظر قليلاً ثم أعد المحاولة.";
  return "تعذر إكمال الطلب. لم تُرسل أي إعدادات أو أسرار إلى المتصفح.";
}

function gatewayLabel(status: OwnerPanelOverview["bot"]["status"]): string {
  switch (status) {
    case "ready": return "متصل بـDiscord";
    case "connecting": return "جارٍ الاتصال";
    case "disabled_by_policy": return "متوقف بسياسة الأمان";
    case "blocked_by_readiness": return "محجوب حتى جاهزية قاعدة البيانات";
    case "not_configured": return "غير مهيأ";
    case "degraded": return "يحتاج مراجعة";
  }
}

function migrationLabel(state: RuntimeReadiness["migration"]["state"]): string {
  switch (state) {
    case "ready": return "الترحيلات مكتملة";
    case "running": return "الترحيل جارٍ";
    case "missing_database": return "رابط قاعدة البيانات غير موجود";
    case "connection_failed": return "تعذر الاتصال بقاعدة البيانات";
    case "failed": return "فشل الترحيل";
    case "not_requested": return "لم يُطلب الترحيل التلقائي";
  }
}

function ReadinessRow({ label, detail, ready }: { label: string; detail: string; ready: boolean }) {
  return (
    <div className={`owner-readiness-row ${ready ? "is-ready" : "is-missing"}`}>
      <span className="owner-readiness-icon">{ready ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span>
      <span className="owner-readiness-copy"><strong>{label}</strong><small>{detail}</small></span>
      <span className="owner-readiness-state">{ready ? "مهيأ" : "يحتاج إعداد"}</span>
    </div>
  );
}

export default function OwnerConsole({ discordUser, oauthConfigured, onConnect, onNavigate }: Props) {
  const [status, setStatus] = useState<OwnerPanelStatus | null>(null);
  const [overview, setOverview] = useState<OwnerPanelOverview | null>(null);
  const [readiness, setReadiness] = useState<RuntimeReadiness | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextStatus = await discordApi.loadOwnerStatus();
      setStatus(nextStatus);
      if (nextStatus.authenticated) {
        const [nextOverview, nextReadiness] = await Promise.all([
          discordApi.loadOwnerOverview(),
          discordApi.loadReadiness(),
        ]);
        setOverview(nextOverview);
        setReadiness(nextReadiness);
      } else {
        setOverview(null);
        setReadiness(null);
      }
    } catch (requestError) {
      setError(failureText(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    const suppliedPassword = password;
    setPassword("");
    try {
      await discordApi.loginOwner(suppliedPassword);
      setNotice("تم التحقق. لوحة المالك تعرض مؤشرات تشغيل فقط ولا تغيّر أسرار Render.");
      await refresh();
    } catch (requestError) {
      setError(failureText(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    setSubmitting(true);
    setError("");
    try {
      await discordApi.logoutOwner();
      setNotice("تم إنهاء جلسة المالك.");
      await refresh();
    } catch (requestError) {
      setError(failureText(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const copyUserId = async () => {
    const id = status?.userId ?? discordUser?.id;
    if (!id || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("تعذر نسخ المعرف. يمكنك تحديده ونسخه يدوياً.");
    }
  };

  return (
    <main className="owner-console" dir="rtl">
      <header className="owner-heading">
        <div>
          <span className="owner-eyebrow"><KeyRound size={13} /> OWNER CONTROL · PRIVATE</span>
          <h1>لوحة الملاك</h1>
          <p>وصول محمي لهوية المالك. هذه النسخة للقراءة التشغيلية فقط؛ لا تفعّل Gateway ولا تغيّر إعدادات Discord أو أسرار Render.</p>
        </div>
        <button className="button button-secondary owner-refresh" type="button" onClick={() => void refresh()} disabled={loading || submitting}>
          <RefreshCw size={15} className={loading ? "owner-spin" : ""} /> تحديث الحالة
        </button>
      </header>

      {error && <div className="owner-alert owner-alert-error" role="alert"><ShieldX size={17} /><span>{error}</span></div>}
      {notice && <div className="owner-alert owner-alert-success" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div>}

      {loading && !status ? (
        <section className="panel owner-state"><LoaderCircle className="owner-spin" size={20} /> جارٍ التحقق من بوابة المالك...</section>
      ) : !oauthConfigured || !status?.configured ? (
        <section className="panel owner-setup-card">
          <div className="owner-setup-mark"><LockKeyhole size={21} /></div>
          <div className="owner-setup-copy">
            <span className="owner-status-pill owner-pill-warn">بوابة المالك غير مهيأة</span>
            <h2>أكمل الإعداد من Render، وليس من هذه الصفحة.</h2>
            <p>لا تدخل كلمة المرور هنا قبل ضبط المتغيرات الخادمية. أضف قائمة Discord المسموح لها ومفتاح كلمة مرور مجزأ، وتأكد من وجود مفتاح جلسة عشوائي.</p>
            <div className="owner-env-list"><code>SYSTEMIX_OWNER_DISCORD_IDS</code><code>SYSTEMIX_OWNER_PASSWORD_HASH</code><code>MANUS_JWT_SECRET</code></div>
            <ol>
              <li>اربط حساب Discord المالك، ثم انسخ معرف حسابك فقط.</li>
              <li>أضف معرفك إلى <code>SYSTEMIX_OWNER_DISCORD_IDS</code> في Environment على Render.</li>
              <li>أنشئ hash محلياً عبر <code>pnpm owner:hash-password</code> بكلمة مرور طويلة (20 حرفاً أو أكثر)، ثم ضع ناتج hash فقط في <code>SYSTEMIX_OWNER_PASSWORD_HASH</code>.</li>
              <li>احفظ المتغيرات وانتظر اكتمال إعادة النشر. لا ترسل كلمة المرور أو hash في الشات أو GitHub.</li>
            </ol>
            {!discordUser && <button className="button button-primary" type="button" onClick={onConnect}><LogIn size={15} /> ربط حساب Discord</button>}
          </div>
        </section>
      ) : !discordUser ? (
        <section className="panel owner-gate-card">
          <div className="owner-gate-icon"><Bot size={22} /></div>
          <span className="owner-status-pill owner-pill-warn">يلزم تسجيل Discord أولاً</span>
          <h2>هوية المالك تسبق كلمة المرور.</h2>
          <p>سجّل بحساب Discord المضاف إلى قائمة الملاك. لن تمنح كلمة المرور وحدها أي شخص صلاحية الدخول.</p>
          <button className="button button-primary" type="button" onClick={onConnect}><LogIn size={15} /> ربط Discord</button>
        </section>
      ) : !status.eligible ? (
        <section className="panel owner-gate-card">
          <div className="owner-gate-icon"><ShieldX size={22} /></div>
          <span className="owner-status-pill owner-pill-warn">هذا الحساب غير مدرج كمالك</span>
          <h2>لا يمكن منح الصلاحية من داخل المتصفح.</h2>
          <p>أضف معرف حساب Discord التالي بنفسك في متغير Render <code>SYSTEMIX_OWNER_DISCORD_IDS</code> ثم أعد النشر. مشاركة المعرف مقبولة؛ لا تشارك كلمة المرور أو أسرار الخادم.</p>
          <div className="owner-id-copy"><code dir="ltr">{status.userId ?? discordUser.id}</code><button type="button" className="button button-secondary" onClick={() => void copyUserId()}><Copy size={14} /> {copied ? "نُسخ" : "نسخ المعرف"}</button></div>
        </section>
      ) : !status.authenticated ? (
        <section className="panel owner-login-card">
          <div className="owner-login-symbol"><LockKeyhole size={20} /></div>
          <span className="owner-status-pill owner-pill-ready">Discord: {discordUser.username}</span>
          <h2>أثبت هوية المالك</h2>
          <p>يلزم حساب Discord ضمن قائمة السماح وكلمة المرور الخاصة معاً. الجلسة تنتهي تلقائياً بعد 15 دقيقة.</p>
          <form onSubmit={(event) => void login(event)} className="owner-password-form">
            <label htmlFor="owner-password">كلمة مرور المالك</label>
            <input id="owner-password" type="password" name="owner-password" autoComplete="current-password" minLength={20} maxLength={128} value={password} onChange={(event) => setPassword(event.currentTarget.value)} placeholder="أدخل كلمة المرور التي خزّنت hash لها في Render" required />
            <button className="button button-primary" type="submit" disabled={submitting || password.length < 20}>{submitting ? <><LoaderCircle size={15} className="owner-spin" /> جارٍ التحقق</> : <><LockKeyhole size={15} /> فتح لوحة الملاك</>}</button>
          </form>
        </section>
      ) : (
        <>
          <section className={`owner-hero ${overview?.bot.status === "ready" ? "owner-hero-good" : ""}`}>
            <div className="owner-hero-mark"><ShieldCheck size={24} /></div>
            <div className="owner-hero-copy">
              <span className="owner-status-pill owner-pill-ready">جلسة مالك موثّقة</span>
              <h2>مرحباً، {discordUser.username}</h2>
              <p>التحكم هنا محمي بهوية Discord وقائمة سماح وكلمة مرور. المؤشرات للقراءة فقط.</p>
            </div>
            <button className="button button-secondary owner-logout" type="button" onClick={() => void logout()} disabled={submitting}><LogOut size={14} /> إنهاء الجلسة</button>
          </section>

          <section className="owner-readiness-panel panel">
            <div className="owner-panel-heading"><div><h2>جاهزية الخدمة</h2><p>هذه المؤشرات لا تكشف قيم الأسرار ولا تعني اختباراً على Guild حي.</p></div><Database size={18} /></div>
            <div className="owner-readiness-list">
              <ReadinessRow label="Discord OAuth" detail={overview?.readiness.oauthConfigured ? "مهيأ لتسجيل الدخول" : "راجع إعداد OAuth في الخدمة"} ready={Boolean(overview?.readiness.oauthConfigured)} />
              <ReadinessRow label="مفتاح جلسة اللوحة" detail={overview?.readiness.sessionKeyConfigured ? "موجود في الخادم" : "يلزم MANUS_JWT_SECRET"} ready={Boolean(overview?.readiness.sessionKeyConfigured)} />
              <ReadinessRow label="كلمة مرور المالك والقائمة" detail={overview?.readiness.ownerPasswordConfigured && overview.readiness.ownerAllowlistConfigured ? "مهيأتان خادمياً" : "الإعداد ناقص أو غير صالح"} ready={Boolean(overview?.readiness.ownerPasswordConfigured && overview?.readiness.ownerAllowlistConfigured)} />
              <ReadinessRow label="قاعدة البيانات والترحيلات" detail={readiness ? migrationLabel(readiness.migration.state) : "تعذر قراءة readiness"} ready={Boolean(readiness?.ready)} />
              <ReadinessRow label="Discord Gateway" detail={overview ? gatewayLabel(overview.bot.status) : "تعذر قراءة الحالة"} ready={overview?.bot.status === "ready"} />
            </div>
            <div className="owner-safety-note"><AlertTriangle size={15} /><span>لن يظهر زر تشغيل هنا. لا تشغّل Gateway قبل قاعدة بيانات جاهزة، ترحيلات ناجحة، واستضافة دائمة واختبار سيرفر تجريبي.</span></div>
          </section>

          <section className="panel owner-tools-panel">
            <div className="owner-panel-heading"><div><h2>اختصارات آمنة</h2><p>تنقلك إلى أدوات اللوحة القائمة؛ إعدادات Guild تخضع لصلاحيات Discord وتأكيدات الحفظ.</p></div><CircleHelp size={18} /></div>
            <div className="owner-tool-actions">
              <button type="button" className="button button-secondary" onClick={() => onNavigate("operations")}><Bot size={15} /> مركز تشغيل البوت <ArrowUpLeft size={13} /></button>
              <button type="button" className="button button-secondary" onClick={() => onNavigate("modules")}><ShieldCheck size={15} /> مركز الوحدات <ArrowUpLeft size={13} /></button>
              <button type="button" className="button button-secondary" onClick={() => onNavigate("connection")}><LogIn size={15} /> ربط Discord <ArrowUpLeft size={13} /></button>
              <button type="button" className="button button-secondary" onClick={() => onNavigate("protection")}><Database size={15} /> إعدادات الحماية <ArrowUpLeft size={13} /></button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
