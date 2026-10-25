import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUpLeft,
  Bot,
  CalendarClock,
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
  type OwnerBotGuild,
  type OwnerSubscription,
  type DiscordGuildChoice,
  type RuntimeReadiness,
} from "@/lib/discord-api";
import type { DashboardSection } from "@/lib/systemix-demo";
import "./OwnerConsole.css";

type Props = {
  discordUser: { id: string; username: string; avatar: string | null } | null;
  manageableGuilds: DiscordGuildChoice[];
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
  if (error.code === "owner_subscription_invalid") return "تحقق من معرف السيرفر والخطة. لا يمكن حفظ طلب غير صالح.";
  if (error.code === "owner_subscription_not_found") return "لا يوجد اشتراك مسجل لهذا السيرفر لتعليقه.";
  if (error.code === "owner_subscription_guild_unavailable") return "لا يمكن تفعيل هذا Guild ID الآن. تأكد أن البوت مثبت ومتصل بالسيرفر ثم حدّث الصفحة.";
  if (error.code === "owner_subscription_write_blocked") return "تعذر تسجيل تدقيق التجديد، لذلك لم يتغير الاشتراك. أعد المحاولة بعد التحقق من حالة الخدمة.";
  if (error.code === "owner_subscription_unavailable") return "تعذر قراءة الاشتراكات الآن. لم تُعرض أي بيانات بديلة.";
  if (error.code === "owner_guild_provision_invalid") return "اختر سيرفراً مثبتاً فيه البوت قبل إعداد اللوقات أو التذاكر.";
  if (error.code === "owner_guild_provision_unavailable") return "البوت غير متصل بهذا السيرفر الآن. حدّث الصفحة وتأكد أنه مثبت فيه.";
  if (error.code === "owner_guild_provision_bot_permissions") return "يلزم أن يملك البوت View Channel وManage Channels وSend Messages؛ وللتذاكر لأول مرة يلزم أيضاً Manage Roles.";
  if (error.code === "owner_guild_provision_blocked") return "تعذر إكمال الإعداد أو تدقيقه؛ لم يكتمل إنشاء القنوات الجديدة. تحقق من حالة الخدمة ثم أعد المحاولة.";
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

function subscriptionLabel(subscription: OwnerSubscription): string {
  if (subscription.status === "active") return "مفعل";
  if (subscription.status === "suspended") return "معلّق";
  return "منتهي";
}

function formatSubscriptionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-SA", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export default function OwnerConsole({ discordUser, manageableGuilds, oauthConfigured, onConnect, onNavigate }: Props) {
  const [status, setStatus] = useState<OwnerPanelStatus | null>(null);
  const [overview, setOverview] = useState<OwnerPanelOverview | null>(null);
  const [readiness, setReadiness] = useState<RuntimeReadiness | null>(null);
  const [subscriptions, setSubscriptions] = useState<OwnerSubscription[]>([]);
  const [provisionGuilds, setProvisionGuilds] = useState<OwnerBotGuild[]>([]);
  const [password, setPassword] = useState("");
  const [subscriptionGuildId, setSubscriptionGuildId] = useState("");
  const [provisionGuildId, setProvisionGuildId] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState<"monthly" | "annual">("monthly");
  const [subscriptionNote, setSubscriptionNote] = useState("");
  const [pendingProvision, setPendingProvision] = useState<"logs" | "tickets" | null>(null);
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
        const [nextOverview, nextReadiness, nextSubscriptions, nextProvisionGuilds] = await Promise.all([
          discordApi.loadOwnerOverview(),
          discordApi.loadReadiness(),
          discordApi.loadOwnerSubscriptions(),
          discordApi.loadOwnerBotGuilds(),
        ]);
        setOverview(nextOverview);
        setReadiness(nextReadiness);
        setSubscriptions(nextSubscriptions.subscriptions);
        setProvisionGuilds(nextProvisionGuilds.guilds);
        setProvisionGuildId((current) => {
          if (current && nextProvisionGuilds.guilds.some((guild) => guild.id === current)) return current;
          return nextProvisionGuilds.guilds.length === 1 ? nextProvisionGuilds.guilds[0].id : "";
        });
      } else {
        setOverview(null);
        setReadiness(null);
        setSubscriptions([]);
        setProvisionGuilds([]);
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
      setNotice("تم التحقق. يمكنك الآن مراجعة الخدمة وتفعيل أو تجديد اشتراكات السيرفرات بعد التحقق من التحويل خارج النظام.");
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

  const renewSubscription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const guildId = subscriptionGuildId.trim();
    if (!/^\d{17,20}$/.test(guildId) || submitting) {
      setError("أدخل Guild ID صحيحاً من 17 إلى 20 رقماً قبل التفعيل.");
      return;
    }
    const existing = subscriptions.find((subscription) => subscription.guildId === guildId);
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await discordApi.updateOwnerSubscription({ action: existing ? "renew" : "activate", guildId, plan: subscriptionPlan, note: subscriptionNote.trim() || undefined, confirmation: "RENEW_SUBSCRIPTION" });
      setSubscriptionNote("");
      setNotice(existing ? "تم تمديد الاشتراك وتسجيل الإجراء في سجل المالك." : "تم تفعيل الاشتراك وتسجيل الإجراء في سجل المالك.");
      await refresh();
    } catch (requestError) {
      setError(failureText(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const suspendSubscription = async (subscription: OwnerSubscription) => {
    if (submitting || !window.confirm(`تعليق اشتراك السيرفر ${subscription.guildId}؟ لن يُحذف السجل، لكن لن يعود مفعّلاً حتى تجدده.`)) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await discordApi.updateOwnerSubscription({ action: "suspend", guildId: subscription.guildId, confirmation: "SUSPEND_SUBSCRIPTION" });
      setNotice("تم تعليق الاشتراك وتسجيل الإجراء في سجل المالك.");
      await refresh();
    } catch (requestError) {
      setError(failureText(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const requestGuildProvision = (kind: "logs" | "tickets") => {
    const guildId = provisionGuildId.trim();
    if (!/^\d{17,20}$/.test(guildId) || submitting) {
      setError("اختر سيرفراً مثبتاً فيه البوت قبل الإعداد.");
      return;
    }
    setError("");
    setNotice("");
    setPendingProvision(kind);
  };

  const provisionGuild = async () => {
    const kind = pendingProvision;
    const guildId = provisionGuildId.trim();
    if (!kind || !/^\d{17,20}$/.test(guildId) || submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = await discordApi.provisionOwnerGuild({ guildId, kind, confirmation: "PROVISION_GUILD_CHANNELS" });
      if (kind === "logs") setNotice(`تم إعداد اللوقات. أُنشئ ${result.result.createdChannels ?? 0} قناة ناقصة، بينها لوق تذاكر مستقل.`);
      else setNotice(`تم إعداد التذاكر. أُنشئ ${result.result.createdPanels ?? 0} لوحة أو مركز تذاكر ناقص${result.result.createdSupportRole ? " ورتبة Systemix Support بلا صلاحيات" : ""}.`);
      setPendingProvision(null);
      await refresh();
    } catch (requestError) {
      setError(failureText(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="owner-console" dir="rtl">
      <header className="owner-heading">
        <div>
          <span className="owner-eyebrow"><KeyRound size={13} /> OWNER CONTROL · PRIVATE</span>
          <h1>لوحة الملاك</h1>
          <p>وصول محمي لهوية المالك. لا تفعّل هذه اللوحة Gateway ولا تغيّر أسرار Render؛ وتتيح تفعيل وتجديد اشتراك Guild يدوياً بعد تحققك من التحويل خارج النظام.</p>
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
              <p>التحكم محمي بهوية Discord وقائمة سماح وكلمة مرور. لا تدخل بيانات دفع أو IBAN أو إيصالات هنا.</p>
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

          <section className="panel owner-subscriptions-panel">
            <div className="owner-panel-heading"><div><h2>تجديد الاشتراكات اليدوي</h2><p>بعد أن تتحقق بنفسك من التحويل خارج Systemix، فعّل أو جدّد السيرفر. لا توجد بوابة دفع أو تأكيد تحويل آلي هنا.</p></div><CalendarClock size={18} /></div>
            <form className="owner-subscription-form" onSubmit={(event) => void renewSubscription(event)}>
              {manageableGuilds.filter((guild) => guild.botInstalled).length > 0 && <label>سيرفر من حسابك<select value={manageableGuilds.some((guild) => guild.id === subscriptionGuildId) ? subscriptionGuildId : ""} onChange={(event) => setSubscriptionGuildId(event.currentTarget.value)}><option value="">اختر سيرفراً</option>{manageableGuilds.filter((guild) => guild.botInstalled).map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}</select></label>}
              <label>Guild ID<input inputMode="numeric" dir="ltr" value={subscriptionGuildId} onChange={(event) => setSubscriptionGuildId(event.currentTarget.value.replace(/\D/g, ""))} minLength={17} maxLength={20} placeholder="123456789012345678" required /></label>
              <label>الخطة<select value={subscriptionPlan} onChange={(event) => setSubscriptionPlan(event.currentTarget.value as "monthly" | "annual")}><option value="monthly">شهري · 30 يوماً</option><option value="annual">سنوي · 365 يوماً</option></select></label>
              <label className="owner-subscription-note-field">ملاحظة داخلية اختيارية<textarea maxLength={300} value={subscriptionNote} onChange={(event) => setSubscriptionNote(event.currentTarget.value)} placeholder="مثال: تم التحقق خارج النظام — لا تكتب بيانات دفع أو حوالة" /></label>
              <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? <><LoaderCircle size={15} className="owner-spin" /> جارٍ الحفظ</> : <><CalendarClock size={15} /> تفعيل أو تجديد</>}</button>
            </form>
            <div className="owner-subscription-disclaimer"><AlertTriangle size={14} /><span>التجديد يمدّ من تاريخ الانتهاء الحالي إن كان مستقبلياً، وإلا يبدأ من الآن. كل تغيير يكتب تدقيقاً قبل الحفظ؛ إذا فشل التدقيق فلن يتغير الاشتراك.</span></div>
            <div className="owner-subscription-list">
              {subscriptions.length === 0 ? <p className="owner-subscription-empty">لا توجد اشتراكات مسجلة بعد. استخدم Guild ID الصحيح بعد التحقق الخارجي من التحويل.</p> : subscriptions.map((subscription) => <article className="owner-subscription-row" key={subscription.guildId}>
                <div><strong dir="ltr">{subscription.guildId}</strong><small>{subscription.plan === "annual" ? "سنوي" : "شهري"} · ينتهي {formatSubscriptionDate(subscription.endsAt)}</small>{subscription.note && <em>{subscription.note}</em>}</div>
                <span className={`owner-subscription-status owner-subscription-status-${subscription.status}`}>{subscriptionLabel(subscription)}</span>
                {subscription.status === "active" && <button className="button button-danger owner-suspend" type="button" disabled={submitting} onClick={() => void suspendSubscription(subscription)}>تعليق</button>}
              </article>)}
            </div>
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

          <section className="panel owner-provision-panel">
            <div className="owner-panel-heading"><div><h2>إعداد قنوات السيرفر</h2><p>بديل مباشر وآمن عن أوامر Slash: ينشئ القنوات الناقصة فقط في سيرفر مثبت فيه البوت، ويسجل تدقيقاً قبل أي إنشاء.</p></div><Bot size={18} /></div>
            <div className="owner-subscription-form">
              <label>السيرفر<select value={provisionGuildId} onChange={(event) => setProvisionGuildId(event.currentTarget.value)}><option value="">اختر سيرفراً مثبتاً فيه البوت</option>{provisionGuilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}</select></label>
              <div className="owner-provision-actions">
                <button type="button" className="button button-secondary" disabled={submitting || !provisionGuildId} onClick={() => requestGuildProvision("logs")}><Database size={15} /> إعداد اللوقات</button>
                <button type="button" className="button button-primary" disabled={submitting || !provisionGuildId} onClick={() => requestGuildProvision("tickets")}><ShieldCheck size={15} /> إعداد التذاكر</button>
              </div>
            </div>
            {pendingProvision && <div className="owner-provision-confirm" role="alert"><AlertTriangle size={15} /><span>سيُنشئ Systemix {pendingProvision === "logs" ? "خمس قنوات لوق، بينها 🎟️・ticket-logs" : "مركز 🎟️・ticket-center ولوحات الأزرار السريعة ورُتبة دعم خالية من الصلاحيات عند الحاجة"} في السيرفر المختار. القنوات الموجودة لن تتكرر، وستُسجّل العملية أولاً في سجل التدقيق.</span><div><button type="button" className="button button-secondary" onClick={() => setPendingProvision(null)} disabled={submitting}>إلغاء</button><button type="button" className="button button-primary" onClick={() => void provisionGuild()} disabled={submitting}>{submitting ? <><LoaderCircle size={15} className="owner-spin" /> جارٍ الإعداد</> : "تأكيد الإنشاء"}</button></div></div>}
            <div className="owner-subscription-disclaimer"><AlertTriangle size={14} /><span>التذاكر تنشئ مركز <code>🎟️・ticket-center</code> ولوحات الأزرار السريعة، ويمكنك تخصيص الأقسام من «إدارة المجتمع». لا تمنح رتبة الدعم التي قد تُنشأ أي صلاحية بحد ذاتها.</span></div>
          </section>
        </>
      )}
    </main>
  );
}
