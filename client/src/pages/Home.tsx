import { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, Suspense, lazy, useMemo, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  AlertOctagon,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  BadgeCheck,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Command,
  Copy,
  DatabaseBackup,
  Download,
  Eye,
  Fingerprint,
  Gauge,
  Globe2,
  History,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  ListFilter,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  Users,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { discordLoginUrl } from "@/lib/discord-api";
import { useDiscordDashboard } from "@/lib/use-discord-dashboard";
import {
  chartValues,
  demoAuditLogs,
  demoBackups,
  demoDelegations,
  demoEvents,
  demoGuild,
  demoIncidents,
  demoLists,
  demoMetrics,
  type DashboardSection,
} from "@/lib/systemix-demo";

const ModuleCenter = lazy(() => import("@/components/ModuleCenter"));
const DiscordConnection = lazy(() => import("@/components/DiscordConnection"));

type IconType = typeof ShieldCheck;

type ToastMessage = { title: string; detail?: string; kind?: "info" | "success" | "warning" };

const navGroups: { label: string; items: { id: DashboardSection; label: string; icon: IconType; badge?: string }[] }[] = [
  {
    label: "الرئيسية",
    items: [
      { id: "overview", label: "نظرة عامة", icon: LayoutDashboard },
      { id: "incidents", label: "مركز الحوادث", icon: Siren, badge: "2" },
      { id: "modules", label: "مركز الوحدات", icon: Boxes, badge: "13" },
    ],
  },
  {
    label: "الحماية",
    items: [
      { id: "protection", label: "قواعد الحماية", icon: ShieldCheck },
      { id: "delegation", label: "تفويض الصلاحيات", icon: Fingerprint, badge: "3" },
      { id: "logs", label: "سجل التدقيق", icon: History },
      { id: "lists", label: "قوائم السماح والمنع", icon: ListFilter },
      { id: "backups", label: "النسخ والاستعادة", icon: DatabaseBackup },
    ],
  },
  {
    label: "الإدارة",
    items: [
      { id: "connection", label: "ربط Discord", icon: Radio },
      { id: "team", label: "الفريق والصلاحيات", icon: Users },
      { id: "plans", label: "التراخيص والباقات", icon: Sparkles },
      { id: "settings", label: "إعدادات النظام", icon: Settings2 },
    ],
  },
];

const sectionMeta: Record<DashboardSection, { title: string; subtitle: string }> = {
  overview: { title: "نظرة عامة", subtitle: "صورة واضحة عن أمن مجتمعك، بدون ضجيج." },
  connection: { title: "ربط Discord", subtitle: "تحقق من الحساب والخادم وصلاحيات البوت الحقيقية." },
  modules: { title: "مركز الوحدات", subtitle: "وحدات كثيرة لمجتمعك — والحماية أولاً دائماً." },
  protection: { title: "قواعد الحماية", subtitle: "اضبط طبقات الدفاع وحدود الاستجابة لكل نوع تهديد." },
  delegation: { title: "تفويض الصلاحيات", subtitle: "امنح كل عضو القدر الذي يحتاجه فقط — ولا أكثر." },
  incidents: { title: "مركز الحوادث", subtitle: "كل إشارة مهمة، في سياق واحد قابل للمراجعة." },
  logs: { title: "سجل التدقيق", subtitle: "سجل زمني واضح لما حدث ومن نفّذه." },
  lists: { title: "قوائم السماح والمنع", subtitle: "استثناءات معلنة بنطاق واضح وأثر يمكن مراجعته." },
  backups: { title: "النسخ والاستعادة", subtitle: "إعدادات النظام وخط أساس بنية السيرفر." },
  team: { title: "الفريق والصلاحيات", subtitle: "نظرة على وصول فريقك وصلاحياته." },
  plans: { title: "التراخيص والباقات", subtitle: "مساحة جاهزة لإدارة التراخيص على مستوى الخادم." },
  settings: { title: "إعدادات النظام", subtitle: "التنبيهات، اللغة، والسلوك الافتراضي." },
};

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand-mark ${small ? "brand-mark-small" : ""}`} aria-hidden="true">
      <Shield size={small ? 17 : 22} strokeWidth={2.1} />
      <span className="brand-spark">✳</span>
    </div>
  );
}

function IconCircle({ icon: Icon, tone = "mint", size = 19 }: { icon: IconType; tone?: string; size?: number }) {
  return (
    <span className={`icon-circle ${tone}`}>
      <Icon size={size} strokeWidth={1.9} />
    </span>
  );
}

function PreviewBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`preview-banner ${compact ? "preview-banner-compact" : ""}`}>
      <span className="preview-dot" />
      <span><strong>معاينة تجريبية</strong>{compact ? " · هذه الوحدة لا تتصل بـDiscord" : " — بيانات هذه الوحدة وتفاعلاتها للعرض فقط ولا تغيّر Discord. استخدم صفحة ربط Discord للميزات الحية المتاحة."}</span>
      {!compact && <span className="preview-banner-tag"><Cloud size={13} /> وضع العرض</span>}
    </div>
  );
}

function Sidebar({ active, onSelect, mobileOpen, onClose, selectedGuildName, manageableGuildCount, discordUsername }: {
  active: DashboardSection;
  onSelect: (section: DashboardSection) => void;
  mobileOpen: boolean;
  onClose: () => void;
  selectedGuildName: string | null;
  manageableGuildCount: number;
  discordUsername: string | null;
}) {
  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" aria-label="إغلاق القائمة" onClick={onClose} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <BrandMark />
          <div className="brand-type">
            <span className="brand-word">SECURITY</span>
            <span className="brand-name">SYSTEMIX<span className="brand-dot">.</span></span>
          </div>
          <button className="icon-button sidebar-close" aria-label="إغلاق القائمة" onClick={onClose}><X size={18} /></button>
        </div>

        <button className="guild-select" onClick={() => onSelect("connection")} aria-label="اختيار سيرفر Discord">
          <span className="guild-avatar">{selectedGuildName ? selectedGuildName.slice(0, 2).toUpperCase() : "DS"}</span>
          <span className="guild-copy"><strong>{selectedGuildName ?? "اربط سيرفر Discord"}</strong><small>{discordUsername ? `${manageableGuildCount} سيرفر قابل للإدارة` : "اضغط لربط حسابك"}</small></span>
          <ChevronDown size={15} className="guild-chevron" />
        </button>

        <div className="sidebar-scroll">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{group.label}</p>
              {group.items.map(({ id, label, icon: Icon, badge }) => (
                <button
                  key={id}
                  className={`nav-item ${active === id ? "nav-item-active" : ""}`}
                  onClick={() => { onSelect(id); onClose(); }}
                  aria-current={active === id ? "page" : undefined}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                  {badge && <span className={`nav-badge ${id === "incidents" ? "nav-badge-alert" : ""}`}>{badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-support-card">
            <div className="support-icon"><LifeBuoy size={17} /></div>
            <div><strong>مركز المساعدة</strong><span>كل شيء تحت السيطرة؟</span></div>
            <ArrowUpLeft size={14} />
          </div>
          <div className="sidebar-user">
            <div className="user-avatar">{discordUsername ? discordUsername.slice(0, 2).toUpperCase() : "DS"}</div>
            <div className="user-copy"><strong>{discordUsername ?? "Discord غير مربوط"}</strong><span>{discordUsername ? "حساب إدارة Discord" : "الربط مطلوب"}</span></div>
            <button className="icon-button user-more" aria-label="خيارات الحساب"><MoreHorizontal size={18} /></button>
          </div>
          <div className="sidebar-version"><span>SECURITY SYSTEMIX</span><span>v0.1 · PREVIEW</span></div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ active, onMenu, onNotify, connection, onConnect }: {
  active: DashboardSection;
  onMenu: () => void;
  onNotify: () => void;
  connection: ReturnType<typeof useDiscordDashboard>["data"];
  onConnect: () => void;
}) {
  const meta = sectionMeta[active];
  const botReady = connection.bot.status === "ready";
  const connectionLabel = botReady ? "بوت Discord متصل" : connection.user ? "حساب Discord مربوط" : "غير مربوط بـDiscord";
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={20} /></button>
      <div className="topbar-heading">
        <div className="breadcrumb"><span>Systemix</span><ChevronLeft size={13} /><span>{meta.title}</span></div>
        <p>{meta.subtitle}</p>
      </div>
      <div className="topbar-actions">
        <div className={`connection-pill ${botReady ? "connection-pill-live" : connection.user ? "connection-pill-account" : ""}`}><span className="connection-dot" />{connectionLabel}</div>
        <button className="button button-ghost topbar-connect" onClick={onConnect}><Radio size={14} /><span>{connection.user ? "إدارة الربط" : "ربط Discord"}</span></button>
        <button className="icon-button topbar-search" aria-label="بحث" title="البحث غير مفعّل في المعاينة"><Search size={18} /></button>
        <button className="icon-button notification-button" aria-label="التنبيهات" onClick={onNotify}>
          <Bell size={18} /><span className="notification-dot" />
        </button>
        <div className="topbar-avatar">MA</div>
      </div>
    </header>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}

function SectionTitle({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="section-title-row">
      <div><h2>{title}</h2>{detail && <span>{detail}</span>}</div>
      {action}
    </div>
  );
}

function MiniButton({ children, onClick, variant = "secondary", icon: Icon }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: IconType }) {
  return <button className={`button button-${variant}`} onClick={onClick}>{Icon && <Icon size={15} />}{children}</button>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    contained: { label: "تم الاحتواء", tone: "status-green" },
    resolved: { label: "مغلق", tone: "status-muted" },
    review: { label: "تحتاج مراجعة", tone: "status-amber" },
    pending: { label: "بانتظار الموافقة", tone: "status-blue" },
    active: { label: "نشط", tone: "status-green" },
    approval: { label: "موافقة مزدوجة", tone: "status-blue" },
  };
  const value = map[status] ?? { label: status, tone: "status-muted" };
  return <span className={`status-pill ${value.tone}`}><span />{value.label}</span>;
}

function MetricCard({ label, value, change, icon: Icon, tone }: { label: string; value: string; change: string; icon: IconType; tone: string }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><IconCircle icon={Icon} tone={tone} /><span className="metric-change"><ArrowUpLeft size={12} />{change}</span></div>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      <div className={`metric-line ${tone}`}><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
    </article>
  );
}

function ScoreRing() {
  return (
    <div className="score-ring" aria-label="مؤشر أمان تجريبي 92 من 100">
      <div className="score-ring-inner"><span>92</span><small>/ 100</small></div>
    </div>
  );
}

function ThreatPulseCard() {
  return (
    <article className="panel threat-panel">
      <div className="panel-topline"><div><span className="overline">THREAT PULSE <span className="threat-preview-label">PREVIEW</span></span><h2>نبض التهديد</h2></div><button className="icon-button panel-more" aria-label="خيارات"><MoreHorizontal size={19} /></button></div>
      <div className="threat-content">
        <div className="threat-score-copy"><span className="score-status"><i />الوضع مستقر</span><div className="threat-score">منخفض <span>12</span></div><p>إشارات الخطر أقل من حد التدخل.<br />لا يوجد فحص حي — بيانات توضيحية.</p></div>
        <ScoreRing />
      </div>
      <div className="pulse-sources">
        <div><span className="pulse-source-icon mint"><Users size={14} /></span><span>انضمامات جديدة</span><b>طبيعي</b></div>
        <div><span className="pulse-source-icon amber"><KeyRound size={14} /></span><span>صلاحيات إدارية</span><b>مراجعة</b></div>
        <div><span className="pulse-source-icon blue"><Activity size={14} /></span><span>نشاط الرسائل</span><b>مستقر</b></div>
      </div>
    </article>
  );
}

function AttackChart() {
  return (
    <article className="panel chart-panel">
      <div className="panel-heading"><div><h2>موجات التهديد</h2><p>آخر 24 ساعة <span className="chart-demo-dot" /> معاينة بيانات</p></div><button className="period-select">آخر 24 ساعة <ChevronDown size={14} /></button></div>
      <div className="chart-legend"><span><i className="legend-mint" />تم احتواؤها</span><span><i className="legend-gray" />تمت مراجعتها</span></div>
      <div className="chart-area">
        <div className="chart-grid"><span>40</span><span>30</span><span>20</span><span>10</span><span>0</span></div>
        <div className="chart-bars">
          {chartValues.map((bar, index) => <div className="chart-column" key={bar.label}>
            <div className="chart-bar-stack" style={{ height: `${bar.value}%` }}>
              <i className={`chart-bar-main ${index === 8 ? "chart-bar-highlight" : ""}`} style={{ height: `${Math.max(28, 100 - (index * 3))}%` }} />
              <i className="chart-bar-secondary" style={{ height: `${Math.max(10, index * 4 + 12)}%` }} />
            </div>
            <span>{bar.label}</span>
          </div>)}
        </div>
      </div>
    </article>
  );
}

function HealthCard() {
  const checks = [
    { label: "Anti-Nuke", detail: "حدود مفعّلة", icon: ShieldCheck, tone: "mint" },
    { label: "Anti-Raid", detail: "وضع متوازن", icon: Users, tone: "blue" },
    { label: "AutoMod", detail: "4 قواعد نشطة", icon: SlidersHorizontal, tone: "violet" },
    { label: "سجل التدقيق", detail: "القناة محددة", icon: History, tone: "amber" },
  ];
  return <article className="panel health-panel">
    <div className="panel-heading"><div><h2>حالة المنظومة</h2><p>ملخص إعدادات الحماية</p></div><button className="icon-button panel-more" aria-label="المزيد"><MoreHorizontal size={19} /></button></div>
    <div className="health-list">{checks.map(({ label, detail, icon, tone }) => <div className="health-row" key={label}>
      <IconCircle icon={icon} tone={tone} size={16} />
      <div className="health-copy"><strong>{label}</strong><span>{detail}</span></div>
      <span className="health-check"><Check size={14} /></span>
    </div>)}</div>
    <button className="text-link">عرض تقرير الحالة <ArrowLeft size={14} /></button>
  </article>;
}

function EventFeed({ onAll }: { onAll: () => void }) {
  const iconByType: Record<string, IconType> = { raid: Users, permission: KeyRound, spam: Globe2, delegation: Fingerprint };
  const toneByType: Record<string, string> = { raid: "amber", permission: "violet", spam: "blue", delegation: "mint" };
  return <article className="panel event-panel">
    <div className="panel-heading"><div><h2>آخر الأحداث</h2><p>ملخص النشاط الأمني</p></div><button className="text-link" onClick={onAll}>كل الأحداث <ArrowLeft size={14} /></button></div>
    <div className="event-list">{demoEvents.map((event) => {
      const Icon = iconByType[event.type] ?? Activity;
      return <div className="event-row" key={event.id}>
        <IconCircle icon={Icon} tone={toneByType[event.type] ?? "mint"} size={16} />
        <div className="event-copy"><strong>{event.title}</strong><span>{event.detail}</span></div>
        <div className="event-meta"><StatusPill status={event.status} /><time>{event.time}</time></div>
      </div>;
    })}</div>
  </article>;
}

function SystemixInnovations({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const features: { title: string; subtitle: string; icon: IconType; tone: string; state: string }[] = [
    { title: "قاطع الهجوم", subtitle: "تصعيد آمن من التهدئة إلى قفل الطوارئ.", icon: Zap, tone: "amber", state: "Circuit Breaker" },
    { title: "حارس التغييرات", subtitle: "قارن الرتب والقنوات بخط أساس موثوق.", icon: History, tone: "mint", state: "Change Guardian" },
    { title: "مراقبة الطُعم", subtitle: "إشارة تدقيق لا تمنح امتيازاً حقيقياً.", icon: Eye, tone: "violet", state: "Honeypot Watch" },
    { title: "رادار انحراف الصلاحيات", subtitle: "اكشف تمدد الامتيازات قبل أن يصبح ثغرة.", icon: KeyRound, tone: "blue", state: "Permission Drift" },
    { title: "معاينة الأثر", subtitle: "افهم القنوات والأدوار المتأثرة قبل التطبيق.", icon: Search, tone: "mint", state: "Safety Preview" },
    { title: "وضع المرونة", subtitle: "توقف بأمان عند فقد الإذن أو ضغط API.", icon: RefreshCw, tone: "amber", state: "Resilience Mode" },
  ];
  return <section className="innovations-section">
    <div className="section-title-row"><div><h2>أفكار Systemix الأصلية</h2><span>طبقات تفسّر الخطر، وتوقف التصعيد غير الآمن.</span></div><span className="innovation-count"><Sparkles size={13} /> 6 قدرات مميّزة</span></div>
    <div className="innovation-grid">{features.map(({ title, subtitle, icon: Icon, tone, state }) => <button className="innovation-card" key={state} onClick={() => onToast({ title: `${title} · معاينة`, detail: "هذه قدرة مخططة للنسخة الحقيقية؛ لم يُربط البوت بعد." })}>
      <IconCircle icon={Icon} tone={tone} size={16} />
      <span className="innovation-copy"><strong>{title}</strong><span>{subtitle}</span></span>
      <span className="innovation-state">مخططة</span>
    </button>)}</div>
  </section>;
}

function OverviewPage({ onSection, onToast, emergency, onPanic }: {
  onSection: (section: DashboardSection) => void;
  onToast: (toast: ToastMessage) => void;
  emergency: boolean;
  onPanic: () => void;
}) {
  return <>
    <PreviewBanner />
    {emergency && <div className="emergency-preview"><AlertOctagon size={18} /><div><strong>وضع الطوارئ قيد المعاينة</strong><span>لم تُرسل أوامر إلى Discord. أعد تحميل الصفحة لإعادة حالة العرض.</span></div><button className="icon-button" onClick={() => onToast({ title: "وضع العرض فقط", detail: "لا يوجد اتصال بسيرفر Discord.", kind: "warning" })}><X size={16} /></button></div>}
    <PageHeading eyebrow="الثلاثاء، 20 أكتوبر 2026" title="أهلاً بعودتك، مالك السيرفر" description="إليك ملخص الوضع الأمني لمجتمعك اليوم." actions={<><MiniButton variant="secondary" icon={Download} onClick={() => onToast({ title: "التصدير غير متصل", detail: "ستتوفر الملفات عند ربط Discord." })}>تصدير التقرير</MiniButton><MiniButton variant="danger" icon={Siren} onClick={onPanic}>وضع الطوارئ</MiniButton></>} />
    <section className="metrics-grid" aria-label="مؤشرات النظام">{demoMetrics.map((metric, index) => <MetricCard key={metric.label} {...metric} icon={[ShieldAlert, UserCheck, Command][index]} />)}</section>
    <section className="dashboard-grid dashboard-grid-primary"><ThreatPulseCard /><AttackChart /></section>
    <section className="dashboard-grid dashboard-grid-secondary"><HealthCard /><EventFeed onAll={() => onSection("incidents")} /></section>
    <SystemixInnovations onToast={onToast} />
    <div className="bottom-note"><ShieldCheck size={15} /><span>أمان أفضل يبدأ من صلاحيات واضحة وإجراءات يمكن مراجعتها.</span><button onClick={() => onSection("protection")}>راجع إعداداتك <ArrowLeft size={13} /></button></div>
  </>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "toggle-on" : ""}`} onClick={onChange}><span /></button>;
}

function SettingRow({ icon: Icon, title, detail, checked, onChange, badge }: { icon: IconType; title: string; detail: string; checked: boolean; onChange: () => void; badge?: string }) {
  return <div className="setting-row">
    <IconCircle icon={Icon} tone="muted" size={17} />
    <div className="setting-copy"><strong>{title}{badge && <span className="setting-badge">{badge}</span>}</strong><span>{detail}</span></div>
    <Toggle checked={checked} onChange={onChange} label={`تبديل ${title}`} />
  </div>;
}

function ProtectionPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [tab, setTab] = useState("nuke");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ nuke: true, joins: true, spam: true, links: true, mentions: true, bots: true, panic: false, captcha: false });
  const switchItem = (key: string, label: string) => {
    setEnabled((previous) => ({ ...previous, [key]: !previous[key] }));
    onToast({ title: "تغيّرت حالة المعاينة", detail: `إعداد ${label} تغيّر محلياً فقط ولم يُحفظ في Discord.` });
  };
  const tabs = [{ id: "nuke", label: "Anti-Nuke", icon: ShieldAlert }, { id: "raid", label: "Anti-Raid", icon: Users }, { id: "automod", label: "AutoMod", icon: SlidersHorizontal }, { id: "verify", label: "التحقق", icon: BadgeCheck }];
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="طبقات الدفاع" title="قواعد الحماية" description="كوّن دفاعات متعددة الطبقات حسب طبيعة مجتمعك." actions={<MiniButton variant="primary" icon={Eye} onClick={() => onToast({ title: "معاينة فقط", detail: "لا يمكن فحص إعدادات خادم Discord قبل الاتصال." })}>معاينة الأثر</MiniButton>} />
    <div className="safety-callout"><ShieldCheck size={18} /><div><strong>مبدأ أقل صلاحية</strong><span>Systemix لن يطلب صلاحيات أكثر من الحاجة. الأفعال الفعلية تتطلب إذناً وترتيب رتبة مناسباً من Discord.</span></div><CircleHelp size={16} /></div>
    <div className="protection-layout">
      <nav className="protection-tabs" aria-label="وحدات الحماية">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "protection-tab-active" : ""} onClick={() => setTab(id)}><Icon size={17} /><span>{label}</span><ChevronLeft size={15} /></button>)}</nav>
      <section className="panel protection-config">
        {tab === "nuke" && <>
          <div className="config-head"><div className="config-icon red"><ShieldAlert size={20} /></div><div><h2>Anti-Nuke</h2><p>اكتشف التغييرات الإدارية المتسارعة قبل أن تتوسع.</p></div><Toggle checked={enabled.nuke} onChange={() => switchItem("nuke", "Anti-Nuke")} label="تبديل Anti-Nuke" /></div>
          <div className="config-divider" />
          <div className="config-section-label"><strong>مراقبة الأحداث</strong><span>اختر التغييرات التي تريد مراقبتها.</span></div>
          <SettingRow icon={Server} title="حذف أو إنشاء القنوات" detail="رصد عمليات متكررة في نافذة زمنية قصيرة" checked={enabled.nuke} onChange={() => switchItem("nuke", "مراقبة القنوات")} />
          <SettingRow icon={KeyRound} title="تغيير الرتب والصلاحيات" detail="يشمل الصلاحيات الحساسة و@everyone" checked={enabled.bots} onChange={() => switchItem("bots", "مراقبة الصلاحيات")} />
          <SettingRow icon={Webhook} title="إنشاء أو حذف Webhooks" detail="تنبيه عند التغييرات غير المتوقعة" checked={enabled.links} onChange={() => switchItem("links", "مراقبة Webhooks")} />
          <SettingRow icon={Bot} title="إضافة بوت جديد" detail="مراجعة الأذونات المطلوبة قبل السماح" checked={enabled.mentions} onChange={() => switchItem("mentions", "مراجعة البوتات")} />
          <div className="config-divider" />
          <div className="threshold-row"><div><strong>حدّ الإنذار</strong><span>عدد التغييرات قبل إرسال تنبيه</span></div><div className="stepper"><button onClick={() => onToast({ title: "تغيير تجريبي", detail: "القيم لا تُحفظ قبل ربط Discord." })}>−</button><b>3</b><button onClick={() => onToast({ title: "تغيير تجريبي", detail: "القيم لا تُحفظ قبل ربط Discord." })}>+</button><small>خلال 10 دقائق</small></div></div>
          <div className="config-footer"><span><LockKeyhole size={14} /> وضع مراقبة آمن</span><button className="text-link" onClick={() => onToast({ title: "حفظ غير متاح", detail: "اربط البوت أولاً لحفظ القواعد في خادمك." })}>حفظ الإعدادات <ArrowLeft size={14} /></button></div>
        </>}
        {tab === "raid" && <>
          <div className="config-head"><div className="config-icon amber"><Users size={20} /></div><div><h2>Anti-Raid</h2><p>تعرّف على موجات الدخول المتسارعة واحتوها تدريجياً.</p></div><Toggle checked={enabled.joins} onChange={() => switchItem("joins", "Anti-Raid")} label="تبديل Anti-Raid" /></div>
          <div className="config-divider" />
          <div className="config-section-label"><strong>إشارات الانضمام</strong><span>قيّم عدّة إشارات معاً؛ لا تجعل إشارة واحدة سبباً لحظر تلقائي.</span></div>
          <SettingRow icon={Activity} title="سرعة دخول الأعضاء" detail="عدد الأعضاء خلال نافذة زمنية متحركة" checked={enabled.joins} onChange={() => switchItem("joins", "سرعة الدخول")} />
          <SettingRow icon={Clock3} title="عمر الحساب" detail="إشارة مساعدة فقط — ليست دليلاً منفرداً" checked={enabled.bots} onChange={() => switchItem("bots", "عمر الحساب")} />
          <SettingRow icon={Fingerprint} title="تحقق إضافي عند ارتفاع الخطر" detail="يحوّل العضو إلى بوابة تحقق تجريبية" checked={enabled.captcha} onChange={() => switchItem("captcha", "التحقق الإضافي")} />
          <div className="action-choice-row"><div><strong>الاستجابة الأولى</strong><span>يتم تطبيقها فقط على أحداث المعاينة.</span></div><select defaultValue="verify"><option value="verify">طلب التحقق</option><option value="slow">تهدئة مؤقتة</option><option value="alert">تنبيه المالك</option></select></div>
          <div className="config-footer"><span><ShieldCheck size={14} /> الاستجابة المتدرجة مفعّلة</span><button className="text-link" onClick={() => onToast({ title: "حفظ غير متاح", detail: "اربط البوت أولاً لحفظ القواعد في خادمك." })}>حفظ الإعدادات <ArrowLeft size={14} /></button></div>
        </>}
        {tab === "automod" && <>
          <div className="config-head"><div className="config-icon blue"><SlidersHorizontal size={20} /></div><div><h2>AutoMod</h2><p>قواعد مرنة للرسائل مع استثناءات واضحة.</p></div><Toggle checked={enabled.spam} onChange={() => switchItem("spam", "AutoMod")} label="تبديل AutoMod" /></div>
          <div className="config-divider" />
          <SettingRow icon={RefreshCw} title="تكرار الرسائل والفيض" detail="حذف الرسالة وتنبيه العضو بعد تجاوز الحد" checked={enabled.spam} onChange={() => switchItem("spam", "تكرار الرسائل")} />
          <SettingRow icon={Globe2} title="الروابط والدعوات" detail="قائمة دومينات مسموحة مع استثناءات" checked={enabled.links} onChange={() => switchItem("links", "فلتر الروابط")} />
          <SettingRow icon={Users} title="المنشن الجماعي" detail="رصد المنشنات المتكررة والمنشنات العامة" checked={enabled.mentions} onChange={() => switchItem("mentions", "فلتر المنشن")} />
          <SettingRow icon={AlertTriangle} title="كلمات مخصصة" detail="إدارة قائمة كلمات من لوحة التحكم" checked={enabled.bots} onChange={() => switchItem("bots", "الكلمات المخصصة")} />
          <div className="config-footer"><span><ListFilter size={14} /> 4 قواعد تجريبية</span><button className="text-link" onClick={() => onToast({ title: "حفظ غير متاح", detail: "اربط البوت أولاً لحفظ القواعد في خادمك." })}>إدارة القواعد <ArrowLeft size={14} /></button></div>
        </>}
        {tab === "verify" && <>
          <div className="config-head"><div className="config-icon violet"><BadgeCheck size={20} /></div><div><h2>بوابة التحقق</h2><p>أعطِ العضو الجديد طريقاً واضحاً للوصول.</p></div><Toggle checked={enabled.captcha} onChange={() => switchItem("captcha", "بوابة التحقق")} label="تبديل بوابة التحقق" /></div>
          <div className="config-divider" />
          <SettingRow icon={UserCheck} title="دور غير متحقق" detail="حجب الوصول حتى إكمال خطوة التحقق" checked={enabled.captcha} onChange={() => switchItem("captcha", "دور غير متحقق")} />
          <div className="verification-preview"><div className="verification-badge"><ShieldCheck size={22} /></div><strong>أهلاً بك في مجتمعنا</strong><span>أكمل التحقق للانضمام إلى بقية القنوات.</span><button onClick={() => onToast({ title: "معاينة رسالة التحقق", detail: "هذا الزر للعرض فقط ولا ينفّذ إجراءً في Discord." })}>تحقّق من حسابك <ArrowLeft size={14} /></button></div>
          <div className="inline-warning"><CircleHelp size={15} /><span>CAPTCHA والتحقق الخارجي غير مفعّلين حتى إعداد تكامل آمن ومراجعة سياسة البيانات.</span></div>
        </>}
      </section>
      <aside className="protection-side">
        <article className="panel side-tip"><div className="tip-icon"><Sparkles size={17} /></div><span className="overline">SYSTEMIX INSIGHT</span><h3>الحماية المتوازنة أقوى</h3><p>اجمع أكثر من إشارة قبل اتخاذ عقوبة. الإفراط في الحظر قد يعطل تجربة الأعضاء الحقيقيين.</p><button className="text-link" onClick={() => onToast({ title: "توصية معاينة", detail: "راجع سجل الحوادث قبل اعتماد أي تغيير." })}>اعرض التوصية <ArrowLeft size={14} /></button></article>
        <article className="panel permissions-card"><div className="permissions-icon"><KeyRound size={17} /></div><h3>صلاحيات البوت المطلوبة</h3><p>تُطلب عند الربط فقط، وبالحد الأدنى اللازم.</p><div className="permission-list"><span><Check size={13} /> إدارة الرسائل</span><span><Check size={13} /> Timeout للأعضاء</span><span><AlertTriangle size={13} /> إدارة القنوات والرتب</span></div><small>الرتبة الأعلى للبوت تحدد ما يستطيع إدارته.</small></article>
      </aside>
    </div>
  </>;
}

function DelegationPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [items, setItems] = useState(demoDelegations);
  const [member, setMember] = useState("");
  const [capability, setCapability] = useState("منح الرتب المعتمدة");
  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!member.trim()) return;
    setItems((current) => [...current, { id: `del-${Date.now()}`, member: member.trim(), tag: "@عضو جديد", initials: member.trim().slice(0, 2).toUpperCase(), capability, scope: "نطاق محدود · قيد التحديد", limit: "موافقة ثانية مطلوبة", status: "approval" }]);
    setModalOpen(false);
    setMember("");
    onToast({ title: "أُضيف التفويض للمعاينة", detail: "لم يُمنح العضو صلاحية فعلية في Discord." });
  };
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="CAPABILITY FIREWALL" title="تفويض الصلاحيات" description="صلاحيات دقيقة عبر البوت، من دون فتح إدارة كاملة للسيرفر." actions={<MiniButton variant="primary" icon={Plus} onClick={() => setModalOpen(true)}>تفويض جديد</MiniButton>} />
    <div className="delegation-hero"><div className="delegation-hero-icon"><Fingerprint size={22} /></div><div><span className="overline">جدار تفويض القدرات</span><h2>لا تمنح صلاحية كاملة إذا كانت المهمة محدودة.</h2><p>حدد الإجراء، من ينفذه، وعلى من. كل تغيير مسجل ويمكن مراجعته.</p></div><div className="delegation-stat"><b>{items.length.toString().padStart(2, "0")}</b><span>تفويضات نشطة</span></div></div>
    <div className="delegation-rules-grid">
      <article className="panel rule-card"><div className="rule-card-top"><IconCircle icon={KeyRound} tone="mint" /><span className="rule-active"><i />سياسة مفعّلة</span></div><h3>الرتب المسموح بها</h3><p>الموظف يمنح الرتب المعتمدة فقط. لا يمكنه إنشاء رتبة أو تعديل صلاحياتها.</p><div className="role-chips"><span>@Verified</span><span>@Event Guest</span><button onClick={() => onToast({ title: "قائمة معاينة", detail: "اختيار الرتب سيُحفظ بعد ربط Discord." })}><Plus size={12} /></button></div></article>
      <article className="panel rule-card"><div className="rule-card-top"><IconCircle icon={Users} tone="blue" /><span className="rule-active"><i />نطاق محدد</span></div><h3>المستهدفون</h3><p>استبعد الرتب الإدارية والمالك. يمكن قصر التفويض على الأعضاء الجدد.</p><div className="scope-preview"><span className="scope-dot" />أعضاء جدد فقط <ChevronDown size={14} /></div></article>
      <article className="panel rule-card"><div className="rule-card-top"><IconCircle icon={BadgeCheck} tone="violet" /><span className="rule-active approval-required"><i />موافقة مزدوجة</span></div><h3>العمليات الحساسة</h3><p>أي إجراء مؤثر يحتاج موافقة ثانية قبل أن ينفّذه البوت.</p><div className="approval-chain"><span>LM</span><span>OS</span><small>2 موافقين</small></div></article>
    </div>
    <article className="panel table-panel">
      <div className="panel-heading"><div><h2>التفويضات الحالية</h2><p>إجراءات محددة لكل عضو</p></div><button className="filter-button" onClick={() => onToast({ title: "الفلاتر قيد المعاينة", detail: "ستعمل مع بيانات التفويض بعد الربط." })}><ListFilter size={15} /> تصفية</button></div>
      <div className="delegation-table-wrap"><table className="systemix-table"><thead><tr><th>العضو</th><th>القدرة</th><th>النطاق المسموح</th><th>الحد اليومي</th><th>الحالة</th><th><span className="sr-only">إجراءات</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><div className="member-cell"><span className="member-avatar">{item.initials}</span><span><strong>{item.member}</strong><small>{item.tag}</small></span></div></td><td>{item.capability}</td><td>{item.scope}</td><td>{item.limit}</td><td><StatusPill status={item.status} /></td><td><button className="icon-button row-more" aria-label={`خيارات ${item.member}`} onClick={() => { setItems((current) => current.filter((x) => x.id !== item.id)); onToast({ title: "أُزيل من المعاينة", detail: "لم يتغير شيء في خادم Discord." }); }}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>
      <div className="table-foot"><span>عرض {items.length} تفويضات · بيانات عرض تجريبية</span><button className="text-link" onClick={() => onToast({ title: "السجل غير متصل", detail: "سيظهر سجل التدقيق الحقيقي بعد الربط." })}>سجل التفويضات <ArrowLeft size={13} /></button></div>
    </article>
    <div className="inline-warning delegation-warning"><LockKeyhole size={15} /><span>البوت لا يتجاوز تسلسل الرتب أو أذونات Discord. لا يمكنه إدارة مالك الخادم أو دور أعلى من رتبته.</span></div>
    {modalOpen && <Dialog title="إنشاء تفويض جديد" onClose={() => setModalOpen(false)}>
      <p className="dialog-description">أنشئ قاعدة محدودة لموظف. ستُحفظ كمعاينة محلية فقط.</p>
      <form onSubmit={handleAdd} className="dialog-form"><label>اسم العضو التجريبي<input value={member} onChange={(event) => setMember(event.target.value)} placeholder="مثال: Sara Moderator" autoFocus /></label><label>الإجراء المسموح<select value={capability} onChange={(event) => setCapability(event.target.value)}><option>منح الرتب المعتمدة</option><option>إصدار تحذير</option><option>إدارة التحقق</option><option>قفل قناة مؤقتاً</option></select></label><div className="dialog-actions"><button type="button" className="button button-ghost" onClick={() => setModalOpen(false)}>إلغاء</button><button type="submit" className="button button-primary"><Plus size={15} />إضافة للمعاينة</button></div></form>
    </Dialog>}
  </>;
}

function IncidentPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [filter, setFilter] = useState("all");
  const [resolved, setResolved] = useState<string[]>([]);
  const filtered = demoIncidents.filter((item) => filter === "all" || (filter === "open" ? item.state === "review" && !resolved.includes(item.id) : item.state !== "review" || resolved.includes(item.id)));
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="INCIDENT ROOM" title="مركز الحوادث" description="شوف الإشارات ضمن سياقها، وراجع الإجراء قبل اعتماده." actions={<MiniButton variant="secondary" icon={RefreshCw} onClick={() => onToast({ title: "تحديث تجريبي", detail: "البيانات المعروضة عيّنة ولا يوجد اتصال مباشر." })}>تحديث</MiniButton>} />
    <section className="incident-summary-grid"><div className="incident-summary-card"><IconCircle icon={AlertTriangle} tone="amber" /><div><b>02</b><span>تحتاج مراجعتك</span></div><span className="summary-trend">أولوية اليوم</span></div><div className="incident-summary-card"><IconCircle icon={ShieldCheck} tone="mint" /><div><b>18</b><span>تم احتواؤها</span></div><span className="summary-trend">آخر 24 ساعة</span></div><div className="incident-summary-card"><IconCircle icon={Clock3} tone="blue" /><div><b>03:18</b><span>متوسط الاستجابة</span></div><span className="summary-trend">بيانات تجريبية</span></div></section>
    <article className="panel table-panel incident-table-panel"><div className="panel-heading"><div><h2>سجل الحوادث</h2><p>إشارات مرتبة بحسب الأحدث</p></div><div className="segmented-control"><button className={filter === "all" ? "segmented-active" : ""} onClick={() => setFilter("all")}>الكل <span>4</span></button><button className={filter === "open" ? "segmented-active" : ""} onClick={() => setFilter("open")}>تحتاج مراجعة <span>2</span></button></div></div>
      <div className="incident-list">{filtered.map((incident) => { const done = resolved.includes(incident.id) || incident.state !== "review"; return <div className="incident-row" key={incident.id}><div className={`incident-symbol ${done ? "incident-symbol-green" : "incident-symbol-amber"}`}>{done ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}</div><div className="incident-info"><div className="incident-title-line"><strong>{incident.title}</strong><span className="incident-id">{incident.id}</span></div><div className="incident-detail-line"><span>{incident.category}</span><i />{incident.affected}<i />{incident.time}</div></div><div className="confidence"><span>ثقة الإشارة</span><b>{incident.confidence}%</b></div><StatusPill status={done ? "contained" : "review"} /><button className="button button-secondary incident-action" onClick={() => { setResolved((current) => current.includes(incident.id) ? current : [...current, incident.id]); onToast({ title: "تم تحديث حالة المعاينة", detail: `${incident.id} — لم يرسل أي إجراء إلى Discord.` }); }}>{done ? "التفاصيل" : "مراجعة"}</button></div>; })}</div>
    </article>
    <article className="incident-room-callout"><div className="incident-room-icon"><Siren size={19} /></div><div><span className="overline">INCIDENT ROOM</span><strong>الحادث الكبير يحتاج الصورة كاملة.</strong><span>اربط الأحداث المرتبطة في خط زمني واحد، وشاهد من وافق على كل خطوة.</span></div><button onClick={() => onToast({ title: "غرفة الحادث", detail: "ستُفعّل الأحداث الحقيقية بعد ربط البوت." })}>استكشف غرفة الحادث <ArrowLeft size={14} /></button></article>
  </>;
}

function LogsPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => demoAuditLogs.filter((log) => `${log.actor} ${log.action} ${log.target} ${log.id}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="AUDIT TRAIL" title="سجل التدقيق" description="كل إجراء آلي أو يدوي في سطر زمني واضح." actions={<MiniButton variant="secondary" icon={Download} onClick={() => onToast({ title: "تصدير تجريبي", detail: "سيتوفر تنزيل السجل عند الاتصال بمصدر البيانات." })}>تصدير السجل</MiniButton>} />
    <div className="log-toolbar"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالعضو أو الإجراء أو رقم الحدث..." /><kbd>/</kbd></div><button className="filter-button" onClick={() => onToast({ title: "اختر نوع الحدث", detail: "مرشحات السجل هنا تجريبية." })}><ListFilter size={15} /> نوع الحدث <ChevronDown size={14} /></button><button className="filter-button" onClick={() => onToast({ title: "الفترة الزمنية", detail: "ستعمل الفترة عند ربط قاعدة البيانات." })}><Clock3 size={15} /> آخر 24 ساعة <ChevronDown size={14} /></button></div>
    <article className="panel table-panel"><div className="panel-heading"><div><h2>الأحداث الأخيرة</h2><p>{rows.length} نتائج في المعاينة</p></div><span className="log-retention"><LockKeyhole size={13} /> سجل آمن · معاينة</span></div><div className="log-table-wrap"><table className="systemix-table"><thead><tr><th>معرّف</th><th>المنفّذ</th><th>الإجراء</th><th>المستهدف</th><th>الوقت</th><th>الخطورة</th><th></th></tr></thead><tbody>{rows.map((log) => <tr key={log.id}><td><span className="log-id">{log.id}</span></td><td><div className="actor-cell"><span className={`actor-dot ${log.actor.includes("Systemix") ? "actor-bot" : ""}`}>{log.actor.includes("Systemix") ? <Bot size={13} /> : log.actor.slice(0, 1)}</span>{log.actor}</div></td><td>{log.action}</td><td className="log-target">{log.target}</td><td className="mono-time">{log.time}</td><td><span className={`severity severity-${log.severity}`}>{log.severity === "high" ? "مرتفع" : log.severity === "medium" ? "متوسط" : "عادي"}</span></td><td><button className="icon-button row-more" onClick={() => onToast({ title: log.id, detail: "تفاصيل السجل المعروض تجريبية." })} aria-label={`تفاصيل ${log.id}`}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table>{rows.length === 0 && <div className="empty-state"><Search size={22} /><strong>ما لقينا نتيجة</strong><span>جرب كلمة بحث ثانية.</span></div>}</div><div className="table-foot"><span>عرض {rows.length} من 248 حدثاً تجريبياً</span><div className="pagination"><button disabled aria-label="الصفحة السابقة"><ChevronRight size={15} /></button><span>1 <i>/</i> 12</span><button onClick={() => onToast({ title: "سجل معاينة", detail: "لا توجد صفحات إضافية محمّلة." })} aria-label="الصفحة التالية"><ChevronLeft size={15} /></button></div></div></article>
    <div className="privacy-note"><LockKeyhole size={15} /><span>سياسة الاحتفاظ بسجلات العملاء ستُحدد مع إعداد المنتج الفعلي. هذه الأمثلة لا تحتوي بيانات حقيقية.</span></div>
  </>;
}

function BackupsPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [localCopies, setLocalCopies] = useState<string[]>([]);
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="RECOVERY POINTS" title="النسخ والاستعادة" description="احفظ إعدادات النظام، وخذ لقطة واضحة لبنية السيرفر قبل التغييرات." actions={<MiniButton variant="primary" icon={Plus} onClick={() => { setLocalCopies((current) => [`BKP-PREVIEW-${current.length + 1}`, ...current]); onToast({ title: "أضيفت نقطة معاينة", detail: "هذه ليست نسخة فعلية ولا يمكن استعادتها." }); }}>نسخة تجريبية</MiniButton>} />
    <div className="backup-warning"><div className="backup-warning-icon"><DatabaseBackup size={19} /></div><div><strong>الاستعادة المقصودة، لا استعادة وهمية.</strong><span>سنحفظ إعدادات Systemix أولاً. استعادة بنية Discord تعرض خطة تغييرات قبل التنفيذ؛ الرسائل المحذوفة لا يمكن استعادتها.</span></div><button className="text-link" onClick={() => onToast({ title: "سياسة الاستعادة", detail: "لا يدّعي Systemix استعادة ما لا توفره واجهة Discord." })}>التفاصيل <ArrowLeft size={13} /></button></div>
    <section className="backup-status-grid"><article className="panel backup-status-card"><span className="backup-status-icon mint"><Settings2 size={18} /></span><div><span>إعدادات Systemix</span><strong>جاهز للنسخ</strong><small>قواعد الحماية والتفويض والقوائم</small></div><CheckCircle2 size={17} className="backup-ready" /></article><article className="panel backup-status-card"><span className="backup-status-icon amber"><Server size={18} /></span><div><span>بنية خادم Discord</span><strong>بانتظار الربط</strong><small>قنوات · رتب · أذونات</small></div><span className="pending-indicator">غير متصل</span></article></section>
    <article className="panel table-panel backup-list-panel"><div className="panel-heading"><div><h2>نقاط الاستعادة</h2><p>إعدادات ونقاط خط أساس</p></div><button className="filter-button" onClick={() => onToast({ title: "ترتيب النسخ", detail: "الفرز هنا للمعاينة." })}><Clock3 size={15} /> الأحدث أولاً <ChevronDown size={14} /></button></div><div className="backup-list">{[...localCopies.map((id) => ({ id, label: "نقطة معاينة محلية", date: "الآن · تجريبية", size: "غير محفوظة", kind: "preview" })), ...demoBackups].map((backup) => <div className="backup-row" key={backup.id}><div className={`backup-file-icon ${backup.kind === "guild" ? "file-icon-amber" : ""}`}><DatabaseBackup size={18} /></div><div className="backup-info"><strong>{backup.label}</strong><span>{backup.id} · {backup.date}</span></div><span className="backup-scope">{backup.size}</span><span className="backup-size-tag">{backup.kind === "guild" ? "بنية السيرفر" : backup.kind === "preview" ? "معاينة فقط" : "إعدادات البوت"}</span><button className="button button-secondary" onClick={() => onToast({ title: "استعادة آمنة", detail: "المعاينة لا تحتوي نسخة حقيقية؛ لن يتم تغيير أي شيء." })}><Eye size={14} /> معاينة الاستعادة</button><button className="icon-button row-more" aria-label="خيارات النسخة" onClick={() => onToast({ title: backup.id, detail: "النسخة غير متصلة بالتخزين بعد." })}><MoreHorizontal size={17} /></button></div>)}</div></article>
    <article className="retention-card"><div className="retention-icon"><LockKeyhole size={16} /></div><div><strong>لا تحفظ بيانات أكثر من اللازم</strong><span>نحتفظ بما تحتاجه لاستعادة الإعدادات وتفسير الحوادث فقط. المدد الفعلية قابلة للتحديد من إعدادات حسابك.</span></div><button onClick={() => onToast({ title: "إعدادات التخزين", detail: "ستُتاح بعد توصيل قاعدة بيانات المنتج الحية." })}>سياسة البيانات <ArrowLeft size={13} /></button></article>
  </>;
}

function ListsPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [items, setItems] = useState(demoLists);
  const [filter, setFilter] = useState<"all" | "allow" | "block">("all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"allow" | "block">("allow");
  const [type, setType] = useState("domain");
  const filtered = items.filter((item) => (filter === "all" || item.kind === filter) && `${item.value} ${item.scope} ${item.note}`.toLowerCase().includes(query.toLowerCase()));
  const addItem = (event: FormEvent) => {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized) return;
    setItems((current) => [{ id: `lst-${Date.now()}`, kind, type, value: normalized, scope: kind === "allow" ? "استثناء محدود" : "حظر ضمن النطاق المحدد", note: "أضيفت للمعاينة فقط", created: "الآن" }, ...current]);
    setModalOpen(false);
    setValue("");
    onToast({ title: "أُضيفت القائمة للمعاينة", detail: "لا يتغير أي إعداد في Discord قبل الربط." });
  };
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="TRUST BOUNDARIES" title="قوائم السماح والمنع" description="استثناء واضح عند الحاجة — دون باب خلفي يتجاوز قواعد الحماية." actions={<MiniButton variant="primary" icon={Plus} onClick={() => setModalOpen(true)}>إضافة قاعدة</MiniButton>} />
    <div className="safety-callout"><ShieldCheck size={18} /><div><strong>كل استثناء له نطاق وسبب</strong><span>الاستثناءات لا توقف الحماية خارج القاعدة المحددة، وتظل ظاهرة في سجل التدقيق.</span></div><CircleHelp size={16} /></div>
    <div className="lists-summary"><article className="panel list-summary-card"><IconCircle icon={CheckCircle2} tone="mint" size={17} /><div><strong>{items.filter((item) => item.kind === "allow").length.toString().padStart(2, "0")}</strong><span>قواعد سماح تجريبية</span></div></article><article className="panel list-summary-card"><IconCircle icon={ShieldAlert} tone="amber" size={17} /><div><strong>{items.filter((item) => item.kind === "block").length.toString().padStart(2, "0")}</strong><span>قواعد منع تجريبية</span></div></article><article className="panel list-summary-card"><IconCircle icon={Eye} tone="blue" size={17} /><div><strong>محدود</strong><span>نطاق كل استثناء ظاهر</span></div></article></div>
    <article className="panel table-panel lists-panel"><div className="panel-heading"><div><h2>قواعد الثقة والاستثناء</h2><p>الأعضاء · الرتب · القنوات · الدومينات · البوتات</p></div><div className="list-actions"><div className="search-field"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في القوائم..." /></div><div className="segmented-control"><button className={filter === "all" ? "segmented-active" : ""} onClick={() => setFilter("all")}>الكل</button><button className={filter === "allow" ? "segmented-active" : ""} onClick={() => setFilter("allow")}>سماح</button><button className={filter === "block" ? "segmented-active" : ""} onClick={() => setFilter("block")}>منع</button></div></div></div>
      <div className="trust-list">{filtered.map((item) => <div className="trust-row" key={item.id}><span className={`trust-kind trust-${item.kind}`}>{item.kind === "allow" ? <Check size={13} /> : <X size={13} />}{item.kind === "allow" ? "سماح" : "منع"}</span><span className="trust-target"><strong>{item.value}</strong><small>{item.type === "member" ? "عضو" : item.type === "role" ? "رتبة" : item.type === "channel" ? "قناة" : item.type === "bot" ? "بوت" : "دومين"}</small></span><span className="trust-scope"><strong>{item.scope}</strong><small>{item.note}</small></span><span className="trust-date">{item.created}</span><button className="icon-button row-more" aria-label={`إزالة ${item.value}`} onClick={() => { setItems((current) => current.filter((entry) => entry.id !== item.id)); onToast({ title: "أُزيلت من المعاينة", detail: "لم يتغير شيء في Discord." }); }}><X size={15} /></button></div>)}{filtered.length === 0 && <div className="empty-state"><Search size={20} /><strong>لا توجد قاعدة مطابقة</strong><span>عدّل البحث أو أضف قاعدة جديدة.</span></div>}</div>
      <div className="table-foot"><span>{filtered.length} قواعد في المعاينة فقط</span><button className="text-link" onClick={() => onToast({ title: "سجل تغييرات القوائم", detail: "يظهر بعد اتصال النظام الحقيقي." })}>سجل تغييرات القوائم <ArrowLeft size={13} /></button></div>
    </article>
    <div className="inline-warning delegation-warning"><AlertTriangle size={15} /><span>قائمة السماح ليست إعفاءً شاملاً: اعرض القاعدة المطابقة وحدّث نطاقها، ولا تتجاوز صلاحيات Discord.</span></div>
    {modalOpen && <Dialog title="إضافة قاعدة إلى قائمة" onClose={() => setModalOpen(false)}><p className="dialog-description">اختر نوع القاعدة وحدد قيمة واحدة. الإضافة محلية للمعاينة فقط.</p><form className="dialog-form" onSubmit={addItem}><label>نوع القاعدة<select value={kind} onChange={(event) => setKind(event.target.value as "allow" | "block")}><option value="allow">سماح ضمن نطاق محدد</option><option value="block">منع ضمن نطاق محدد</option></select></label><label>نوع الهدف<select value={type} onChange={(event) => setType(event.target.value)}><option value="member">عضو</option><option value="role">رتبة</option><option value="channel">قناة</option><option value="domain">دومين</option><option value="bot">بوت</option></select></label><label>القيمة<input value={value} onChange={(event) => setValue(event.target.value)} placeholder={type === "domain" ? "trusted.example" : "اسم أو معرّف تجريبي"} autoFocus /></label><div className="dialog-actions"><button type="button" className="button button-ghost" onClick={() => setModalOpen(false)}>إلغاء</button><button type="submit" className="button button-primary"><Plus size={15} />إضافة للمعاينة</button></div></form></Dialog>}
  </>;
}

function TeamPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const people = [{ name: "مالك السيرفر", tag: "Owner · أعلى صلاحية", initials: "MA", grants: "إدارة كاملة", state: "active" }, { name: "Lina Moderator", tag: "Moderator", initials: "LM", grants: "3 قدرات محددة", state: "active" }, { name: "Omar Support", tag: "Support", initials: "OS", grants: "تحذيرات فقط", state: "active" }, { name: "Hala Helper", tag: "Helper", initials: "HH", grants: "قيد المراجعة", state: "approval" }];
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="ACCESS CONTROL" title="الفريق والصلاحيات" description="وصول أقل يعني سطح هجوم أقل. راجع الصلاحيات دورياً." actions={<MiniButton variant="primary" icon={Plus} onClick={() => onToast({ title: "إضافة عضو", detail: "اختر الأعضاء بعد ربط خادم Discord." })}>إضافة عضو</MiniButton>} />
    <div className="access-summary"><div className="access-summary-icon"><Users size={19} /></div><div><strong>الصلاحية الواسعة استثناء، لا قاعدة.</strong><span>التفويضات الدقيقة أقل خطراً من منح Manage Server لكل موظف.</span></div><button className="text-link" onClick={() => onToast({ title: "مراجعة صلاحيات", detail: "بيانات الأعضاء تجريبية." })}>مراجعة الصلاحيات <ArrowLeft size={14} /></button></div>
    <article className="panel team-list-panel"><div className="panel-heading"><div><h2>أعضاء الفريق</h2><p>4 مستخدمين في المعاينة</p></div><button className="filter-button" onClick={() => onToast({ title: "تصفية الفريق", detail: "ستتوفر التصفية بعد الاتصال بـDiscord." })}><ListFilter size={15} /> تصفية</button></div><div className="team-list">{people.map((person, index) => <div className="team-row" key={person.name}><span className={`team-avatar team-avatar-${index}`}>{person.initials}</span><div className="team-person"><strong>{person.name}</strong><span>{person.tag}</span></div><div className="team-access"><small>صلاحيات Systemix</small><strong>{person.grants}</strong></div><StatusPill status={person.state} /><button className="icon-button row-more" aria-label={`خيارات ${person.name}`} onClick={() => onToast({ title: "إدارة الصلاحيات", detail: "تُحدّث الصلاحيات الحقيقية بعد الربط فقط." })}><MoreHorizontal size={18} /></button></div>)}</div></article>
    <div className="permission-callouts"><article><KeyRound size={16} /><div><strong>كل صلاحية لها سبب</strong><span>سجل موحد لمن منح الصلاحية ومتى.</span></div></article><article><ShieldCheck size={16} /><div><strong>راجع الرتب الأعلى</strong><span>قد يتجاوز دور Discord صلاحيات البوت.</span></div></article></div>
  </>;
}

function PlansPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [selected, setSelected] = useState("guardian");
  const tiers = [
    { id: "sentinel", name: "Sentinel", subtitle: "للمجتمعات الناشئة", price: "0", period: "تجريبي", icon: Shield, features: ["سيرفر واحد", "قواعد حماية أساسية", "سجل حوادث محدود", "قوالب أمان جاهزة"] },
    { id: "guardian", name: "Guardian", subtitle: "الحماية المتقدمة", price: "—", period: "التسعير لاحقاً", icon: ShieldCheck, features: ["كل خصائص Sentinel", "تفويض قدرات متقدم", "Threat Pulse وIncident Room", "نسخ إعدادات ومراجعة"] },
    { id: "fortress", name: "Fortress", subtitle: "لشبكات ومجتمعات كبيرة", price: "—", period: "تسعير مخصص", icon: LockKeyhole, features: ["كل خصائص Guardian", "تعدد الخوادم", "سجل موسع وSLA", "أدوات إدارة الفرق"] },
  ];
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="SYSTEMIX PLANS" title="التراخيص والباقات" description="تجربة أولية لتصميم التراخيص — لا توجد مدفوعات أو اشتراكات حقيقية حالياً." />
    <div className="billing-note"><Sparkles size={17} /><span>نموذج البيع غير محسوم. جهّزنا هيكل مرن يمكن تسعيره لاحقاً حسب عدد الخوادم والميزات.</span></div>
    <div className="plan-grid">{tiers.map(({ id, name, subtitle, price, period, icon: Icon, features }) => <article className={`panel plan-card ${id === "guardian" ? "plan-card-featured" : ""} ${selected === id ? "plan-card-selected" : ""}`} key={id}><div className="plan-card-head"><span className="plan-icon"><Icon size={18} /></span>{id === "guardian" && <span className="plan-recommended">الأكثر توازناً</span>}</div><span className="plan-subtitle">{subtitle}</span><h2>{name}</h2><div className="plan-price">{price === "0" ? <><b>مجاني</b><span>للبداية</span></> : <><b>{price}</b><span>{period}</span></>}</div><div className="plan-divider" />{features.map((feature) => <div className="plan-feature" key={feature}><CheckCircle2 size={15} />{feature}</div>)}<button className={`button ${selected === id ? "button-primary" : "button-secondary"}`} onClick={() => { setSelected(id); onToast({ title: "اختيار معاينة", detail: `${name} ليس اشتراكاً فعلياً ولا يوجد دفع.` }); }}>{selected === id ? "الباقة المحددة للمعاينة" : "اختيار الباقة"}</button></article>)}</div>
    <article className="panel license-preview"><div className="license-symbol"><KeyRound size={20} /></div><div><span className="overline">LICENSE DESIGN</span><h3>ترخيص لكل خادم. وضوح لكل عميل.</h3><p>مساحة إدارية جاهزة لحالة الاشتراك وحدود الباقة وتجديد الترخيص، مع سجل تغييرات — دون تحصيل أموال قبل إعداد موفر الدفع.</p></div><div className="license-status"><span className="connection-dot" />تصميم تجريبي</div></article>
  </>;
}

function SettingsPage({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const [toggles, setToggles] = useState({ alerts: true, dm: false, daily: true, english: false, privateLogs: true });
  const toggle = (key: keyof typeof toggles, label: string) => { setToggles((current) => ({ ...current, [key]: !current[key] })); onToast({ title: "إعداد معاينة", detail: `${label} يتغير محلياً فقط.` }); };
  return <>
    <PreviewBanner />
    <PageHeading eyebrow="PREFERENCES" title="إعدادات النظام" description="ضبط تنبيهات المنتج وتفضيلات كل خادم." actions={<MiniButton variant="secondary" icon={RefreshCw} onClick={() => onToast({ title: "إعدادات المعاينة", detail: "لا توجد تغييرات محفوظة إلى Discord." })}>إعادة ضبط العرض</MiniButton>} />
    <div className="settings-layout"><div className="settings-main">
      <article className="panel settings-panel"><div className="settings-panel-heading"><div className="config-icon mint"><Bell size={18} /></div><div><h2>التنبيهات</h2><p>حدد كيف تريد رؤية الأحداث ذات الأولوية.</p></div></div><SettingRow icon={Siren} title="تنبيهات الحوادث" detail="أظهر تنبيهاً عند ارتفاع مستوى الخطر" checked={toggles.alerts} onChange={() => toggle("alerts", "تنبيهات الحوادث")} /><SettingRow icon={Fingerprint} title="إشعار الإجراء المفوّض" detail="نبّه المالك عند استخدام تفويض حساس" checked={toggles.dm} onChange={() => toggle("dm", "إشعارات التفويض")} /><SettingRow icon={Activity} title="ملخص أسبوعي" detail="ملخص تغييرات الحماية والحوادث" checked={toggles.daily} onChange={() => toggle("daily", "الملخص الأسبوعي")} /></article>
      <article className="panel settings-panel"><div className="settings-panel-heading"><div className="config-icon blue"><Globe2 size={18} /></div><div><h2>اللغة والمنطقة</h2><p>إعدادات عرض لوحة التحكم.</p></div></div><div className="action-choice-row"><div><strong>لغة الواجهة</strong><span>تغيير اللغة لا يغير لغة الخادم.</span></div><select value={toggles.english ? "en" : "ar"} onChange={() => toggle("english", "لغة الواجهة")}><option value="ar">العربية</option><option value="en">English (preview)</option></select></div><div className="action-choice-row"><div><strong>المنطقة الزمنية</strong><span>مستخدمة لعرض أوقات الأحداث.</span></div><select defaultValue="riyadh"><option value="riyadh">الرياض (UTC+3)</option><option value="utc">UTC</option><option value="london">لندن</option></select></div></article>
      <article className="panel settings-panel"><div className="settings-panel-heading"><div className="config-icon violet"><LockKeyhole size={18} /></div><div><h2>الخصوصية وسجل التدقيق</h2><p>تحكم فيما يُجمع وكيف يظهر داخل اللوحة.</p></div></div><SettingRow icon={Eye} title="إخفاء التفاصيل الحساسة" detail="إخفاء محتوى الرسائل من المعاينة والسجلات" checked={toggles.privateLogs} onChange={() => toggle("privateLogs", "إخفاء التفاصيل الحساسة")} /><div className="inline-warning"><LockKeyhole size={15} /><span>قبل الإطلاق، سنحدد مدة الاحتفاظ بالبيانات وما يلزم فقط لتقديم الحماية.</span></div></article>
    </div><aside className="panel settings-aside"><div className="settings-aside-icon"><ShieldCheck size={20} /></div><span className="overline">SECURITY BY DEFAULT</span><h3>إعدادات آمنة من البداية.</h3><p>كل تكامل فعلي يتطلب إذناً واضحاً. لا نعرض بيانات خاصة في اللوحة دون حاجة.</p><div className="settings-aside-row"><CheckCircle2 size={15} /> لا توجد أسرار داخل الكود</div><div className="settings-aside-row"><CheckCircle2 size={15} /> أقل صلاحية ممكنة</div><div className="settings-aside-row"><CheckCircle2 size={15} /> سجل تغييرات واضح</div></aside></div>
  </>;
}

function Dialog({ title, onClose, children, danger = false }: { title: string; onClose: () => void; children: ReactNode; danger?: boolean }) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!dialog || !focusable?.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return <div className="modal-backdrop" role="presentation" onKeyDown={handleKeyDown} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-heading"><div className={`dialog-mark ${danger ? "dialog-mark-danger" : ""}`}>{danger ? <AlertOctagon size={20} /> : <ShieldCheck size={20} />}</div><button className="icon-button" aria-label="إغلاق" onClick={onClose} autoFocus><X size={18} /></button></div><h2 id="dialog-title">{title}</h2>{children}</section></div>;
}

function Toast({ message, onClose }: { message: ToastMessage; onClose: () => void }) {
  return <div className={`toast-card toast-${message.kind ?? "info"}`} role="status"><span className="toast-symbol">{message.kind === "success" ? <CheckCircle2 size={17} /> : message.kind === "warning" ? <AlertTriangle size={17} /> : <CircleHelp size={17} />}</span><div><strong>{message.title}</strong>{message.detail && <span>{message.detail}</span>}</div><button className="icon-button" onClick={onClose} aria-label="إغلاق الإشعار"><X size={15} /></button></div>;
}

function SystemixDashboard() {
  const discordConnection = useDiscordDashboard();
  const [active, setActive] = useState<DashboardSection>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [panicOpen, setPanicOpen] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = (message: ToastMessage) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4400);
  };
  const connectDiscord = () => {
    if (discordConnection.data.user) {
      setActive("connection");
      return;
    }
    if (!discordConnection.data.oauthConfigured) {
      setActive("connection");
      notify({ title: "إعداد OAuth غير مكتمل", detail: "أضف DISCORD_CLIENT_SECRET في مخزن الأسرار الآمن أولاً.", kind: "warning" });
      return;
    }
    window.open(discordLoginUrl(), "_blank", "noopener,noreferrer");
  };
  const renderSection = () => {
    switch (active) {
      case "connection": return <Suspense fallback={<div className="panel discord-loading">جار تحميل ربط Discord...</div>}><DiscordConnection connection={discordConnection.data} loading={discordConnection.loading} dashboardError={discordConnection.error} selectedGuildId={discordConnection.selectedGuildId} onSelectGuild={discordConnection.selectGuild} onConnect={connectDiscord} onRefresh={discordConnection.refresh} onNotice={notify} /></Suspense>;
      case "modules": return <Suspense fallback={<div className="panel discord-loading">جار تحميل مركز الوحدات...</div>}><ModuleCenter onToast={notify} /></Suspense>;
      case "protection": return <ProtectionPage onToast={notify} />;
      case "delegation": return <DelegationPage onToast={notify} />;
      case "incidents": return <IncidentPage onToast={notify} />;
      case "logs": return <LogsPage onToast={notify} />;
      case "lists": return <ListsPage onToast={notify} />;
      case "backups": return <BackupsPage onToast={notify} />;
      case "team": return <TeamPage onToast={notify} />;
      case "plans": return <PlansPage onToast={notify} />;
      case "settings": return <SettingsPage onToast={notify} />;
      default: return <OverviewPage onSection={setActive} onToast={notify} emergency={emergency} onPanic={() => setPanicOpen(true)} />;
    }
  };
  return <div className="systemix-app" dir="rtl">
    <Sidebar active={active} onSelect={setActive} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} selectedGuildName={discordConnection.data.guilds.find((guild) => guild.id === discordConnection.selectedGuildId)?.name ?? null} manageableGuildCount={discordConnection.data.guilds.length} discordUsername={discordConnection.data.user?.username ?? null} />
    <main className="main-shell">
      <Topbar active={active} connection={discordConnection.data} onConnect={connectDiscord} onMenu={() => setMobileOpen(true)} onNotify={() => notify({ title: "لا توجد تنبيهات حية", detail: "بيانات التنبيهات الحالية تجريبية." })} />
      <div className="main-content">{renderSection()}<footer className="page-footer"><span>© 2026 Security Systemix</span><span><i /> طبقة الحماية لديسكورد فقط</span><button onClick={() => setActive("settings")}>الخصوصية والأمان <ArrowUpLeft size={12} /></button></footer></div>
    </main>
    {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    {panicOpen && <Dialog title="تشغيل وضع الطوارئ؟" danger onClose={() => setPanicOpen(false)}>
      <p className="dialog-description">سيوقف Circuit Breaker النشاط تدريجياً ويقفل القنوات الحساسة حسب سياستك. قد يؤثر ذلك على الأعضاء.</p>
      <div className="panic-preview-list"><div><CheckCircle2 size={15} /> معاينة الخطوات قبل التنفيذ</div><div><CheckCircle2 size={15} /> تسجيل المبرر والموافق</div><div><AlertTriangle size={15} /> يحتاج اتصالاً فعلياً وصلاحيات مناسبة</div></div>
      <div className="dialog-caveat"><AlertTriangle size={15} /><span>المعاينة لا تغيّر إعدادات Discord ولا تقفل أي قناة.</span></div>
      <div className="dialog-actions"><button className="button button-ghost" onClick={() => setPanicOpen(false)}>إلغاء</button><button className="button button-danger" onClick={() => { setEmergency(true); setPanicOpen(false); setActive("overview"); notify({ title: "وضع الطوارئ للمعاينة فقط", detail: "لم يُرسل أي طلب إلى Discord.", kind: "warning" }); }}>محاكاة في لوحة العرض</button></div>
    </Dialog>}
  </div>;
}

export default function Home() {
  return <SystemixDashboard />;
}
