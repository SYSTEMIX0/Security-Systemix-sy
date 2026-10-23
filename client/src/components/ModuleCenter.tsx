import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpLeft,
  BadgeCheck,
  Bell,
  CalendarDays,
  CheckCircle2,
  Command,
  ChevronDown,
  Clock3,
  Fingerprint,
  Gauge,
  LifeBuoy,
  LockKeyhole,
  MessageSquareText,
  Radio,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DiscordBotState } from "../lib/discord-api";
import { getProductModuleReadiness } from "../lib/module-readiness";

type ToastMessage = { title: string; detail?: string; kind?: "info" | "success" | "warning" };

type ModuleCategory = "الكل" | "الحماية" | "المجتمع" | "التشغيل";
type ModuleItem = {
  id: string;
  name: string;
  english: string;
  category: Exclude<ModuleCategory, "الكل">;
  priority: string;
  status: string;
  description: string;
  capabilities: string[];
  systemixEdge: string;
  icon: LucideIcon;
  tone: string;
  featured?: boolean;
};

const modules: ModuleItem[] = [
  {
    id: "defense-core",
    name: "الدفاع ومركز الثقة",
    english: "DEFENSE CORE",
    category: "الحماية",
    priority: "الأولوية الأولى",
    status: "معاينة الواجهة",
    description: "طبقات حماية الخادم في مكان واحد: من إشارات الخطر إلى المراجعة والاحتواء، مع إظهار سبب القرار وحدود صلاحيات البوت.",
    capabilities: ["Anti-Nuke وAnti-Raid بحدود واستثناءات", "AutoMod والتحقق والإشراف", "نبض تهديد يفسر الإشارات ولا يحظر بناءً على إشارة واحدة", "قاطع هجوم متدرج مع مهلة ومراجعة", "رادار انحراف الصلاحيات وفحص جاهزية الأذونات", "جرد بوتات الخادم والويبهوكات والتغييرات عليها", "تمارين محاكاة دفاعية ببيانات اصطناعية من دون تنفيذ هجوم حي"],
    systemixEdge: "وضع مراقبة قبل الإنفاذ، ومعاينة أثر القاعدة، وبيان واضح لما لا تسمح به Discord.",
    icon: ShieldCheck,
    tone: "mint",
    featured: true,
  },
  {
    id: "incident-bridge",
    name: "غرفة العمليات والحوادث",
    english: "INCIDENT OPERATIONS",
    category: "الحماية",
    priority: "أولوية أمنية",
    status: "معاينة الواجهة",
    description: "خط زمني موحد للحوادث يربط التنبيه، والمراجعة البشرية، والإجراء، والأدلة، والموظف المسؤول.",
    capabilities: ["تجميع أحداث مرتبطة في حادث واحد", "موافقة ثانية للإجراءات الحساسة", "حزمة أدلة بأقل بيانات لازمة", "سجل من وافق وماذا نُفذ ومتى", "استئناف يراجعه مشرف غير منفذ الإجراء الأصلي"],
    systemixEdge: "يمكن تحويل بلاغ دعم عن إساءة أو اختراق إلى حادث أمني، مع إبقاء صلاحيات التذكرة منفصلة عن صلاحيات الحماية.",
    icon: Radio,
    tone: "amber",
    featured: true,
  },
  {
    id: "permission-firewall",
    name: "جدار تفويض القدرات",
    english: "CAPABILITY FIREWALL",
    category: "الحماية",
    priority: "أولوية أمنية",
    status: "معاينة الواجهة",
    description: "تفويض إجراءات صغيرة للمشرفين من دون منحهم إدارة الخادم كاملة.",
    capabilities: ["تحديد الإجراء والعضو والرتبة والقناة", "حدود عددية وزمنية للتفويض", "موافقة مزدوجة عند الحاجة", "سجل تدقيق قابل للمراجعة", "إنهاء التفويض أو سحبه"],
    systemixEdge: "مبدأ أقل امتياز يمتد إلى أوامر البوت ووحداته، وليس إلى صفحة الحماية فقط.",
    icon: Fingerprint,
    tone: "blue",
  },
  {
    id: "tickets",
    name: "مركز التذاكر والدعم",
    english: "SUPPORT DESK",
    category: "المجتمع",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "استقبال طلبات الأعضاء عبر لوحات وفئات واضحة، مع فريق مسؤول ومسار متابعة بدلاً من ضياع الطلبات في المحادثة العامة.",
    capabilities: ["لوحات فتح تذكرة حسب الفئة", "أسئلة فرز قبل فتح قناة خاصة", "إسناد الموظف والتصعيد والإغلاق", "قواعد وصول محددة حسب الفريق", "سجل أو نسخة نصية وفق إعداد الاحتفاظ"],
    systemixEdge: "مسار Incident Bridge يحيل البلاغ الأمني لغرفة الحوادث من دون أن يمنح فريق الدعم صلاحيات أمنية تلقائية.",
    icon: LifeBuoy,
    tone: "violet",
  },
  {
    id: "onboarding",
    name: "الترحيب وتهيئة الأعضاء",
    english: "WELCOME & ONBOARDING",
    category: "المجتمع",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "تجربة دخول منظمة ترحب بالعضو وتشرح الخطوة التالية وتساعده في اختيار اهتماماته بأدوار غير حساسة.",
    capabilities: ["رسائل ترحيب وقواعد الخادم", "خطوات تهيئة قابلة للترتيب", "اختيار أدوار اهتمامات ذاتية", "دور أولي محدود الصلاحية", "فحص ترتيب الرتب قبل تفعيل التوزيع"],
    systemixEdge: "إعداد آمن يبدأ بأقل صلاحية، ويفصل اختيار الاهتمام عن أي دور يمنح قدرة إدارية.",
    icon: Users,
    tone: "blue",
  },
  {
    id: "feedback",
    name: "الاقتراحات والاستطلاعات",
    english: "IDEAS & POLLS",
    category: "المجتمع",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "حوّل آراء المجتمع إلى طلبات قابلة للفرز والمتابعة، وصوّت على خيارات أو مواعيد من داخل الخادم.",
    capabilities: ["لوحة استقبال اقتراحات", "تصويت متعدد الخيارات", "حالة متابعة ووسم للمشرف", "تعليقات/نقاش مضبوط", "إعداد إخفاء الهوية وفق سياسة واضحة"],
    systemixEdge: "يمكن تحويل اقتراح يمس إعدادات الحماية إلى طلب مراجعة، لا إلى تغيير تلقائي بلا موافقة.",
    icon: MessageSquareText,
    tone: "violet",
  },
  {
    id: "events",
    name: "الفعاليات والحضور",
    english: "EVENTS & RSVP",
    category: "المجتمع",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "إنشاء فعالية داخل Discord وإدارة التسجيل والتذكيرات مع توضيح وقتها للأعضاء بحسب المنطقة الزمنية.",
    capabilities: ["RSVP بخيارات حضور", "حد سعة وقائمة انتظار", "فعاليات متكررة واستطلاع موعد", "تذكيرات اختيارية في قناة أو سلسلة", "سجل حضور وتحديثات للفعالية"],
    systemixEdge: "فحص تعارض الفعالية مع إعدادات الخادم وقنواته قبل نشرها؛ وأي تقويم خارجي تكامل مستقل لاحق.",
    icon: CalendarDays,
    tone: "amber",
  },
  {
    id: "engagement",
    name: "التفاعل والمكافآت الاجتماعية",
    english: "COMMUNITY ENGAGEMENT",
    category: "المجتمع",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "مشاركة اختيارية للمجتمع عبر نقاط أو شارات وتحديات ولوحة ترتيب، من دون تحويل الشعبية إلى إشارة أمان.",
    capabilities: ["نقاط نشاط قابلة للضبط", "شارات ومكافآت مجتمعية", "لوحة ترتيب للخادم", "استثناء قنوات مثل الدعم", "حدود لمكافحة الاستغلال والرسائل المزعجة"],
    systemixEdge: "فصل صريح بين السمعة المجتمعية ودرجة الثقة الأمنية؛ لا نقاط ولا مستويات تمنح صلاحيات حساسة.",
    icon: Sparkles,
    tone: "violet",
  },
  {
    id: "analytics",
    name: "التحليلات والعدادات",
    english: "COMMUNITY INSIGHTS",
    category: "التشغيل",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "مؤشرات تشغيلية تساعد المالك على فهم نشاط المجتمع وعبء الإشراف من البيانات التي يصرح بجمعها فقط.",
    capabilities: ["اتجاهات الأعضاء والقنوات", "عدد الحوادث والتذاكر وزمن المعالجة", "عدادات تشغيلية ذات وقت تحديث ظاهر", "تصدير محدود بصلاحيات", "فترة احتفاظ وخصوصية معلنتان"],
    systemixEdge: "لا يُعرض العداد على أنه لحظي إذا كان دورياً، ولا تُختلق بيانات تاريخية لم تُجمع.",
    icon: Gauge,
    tone: "mint",
  },
  {
    id: "automation",
    name: "الأتمتة وسير العمل",
    english: "GUARDED WORKFLOWS",
    category: "التشغيل",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "قواعد محدودة تربط محفزاً بشرط وإجراء، وتُدار بصلاحيات وسجل بدلاً من أوامر غامضة لا يعرف المالك أثرها.",
    capabilities: ["قواعد محفز/شرط/إجراء محددة", "وضع مراقبة قبل الإنفاذ", "معاينة القنوات والأعضاء المتأثرين", "حدود تكرار وسجل لكل تشغيل", "تكامل API أو Webhook عند إعداده"],
    systemixEdge: "كاشف تعارض السياسات يوقف النشر إذا خالفت القاعدة استثناءً أو قيد صلاحية، مع إمكان إيقافها سريعاً.",
    icon: Workflow,
    tone: "blue",
  },
  {
    id: "commands",
    name: "الأوامر والردود المخصصة",
    english: "COMMAND CENTER",
    category: "التشغيل",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "أوامر Slash أو ردود مساعدة للحالات المتكررة، بصلاحيات واضحة ونصوص يراجعها مالك الخادم.",
    capabilities: ["أوامر مساعدة مخصصة", "ردود FAQ وروابط موثوقة", "تحديد الرتب والقنوات المسموح بها", "حد معدل واستخدام لكل أمر", "سجل تغيير ونشر قابل للتراجع عند الإمكان"],
    systemixEdge: "لا يستطيع الأمر المخصص أن يتخطى جدار التفويض أو يضيف صلاحية إدارية لم يمنحها Discord.",
    icon: Command,
    tone: "blue",
  },
  {
    id: "announcements",
    name: "الإعلانات والتذكيرات",
    english: "ANNOUNCEMENTS & REMINDERS",
    category: "التشغيل",
    priority: "وحدة اختيارية",
    status: "ضمن مخطط المنتج",
    description: "إدارة رسائل المجتمع ومواعيد النشر والتذكيرات من مكان واضح، مع تحكم بالقناة والجمهور والوقت.",
    capabilities: ["إعلانات في قناة مختارة", "رسائل مجدولة أو متكررة", "تذكيرات اختيارية للأعضاء", "عرض المنطقة الزمنية قبل الإرسال", "معاينة محتوى وتأكيد قبل النشر"],
    systemixEdge: "معاينة جمهور الرسالة والقناة قبل النشر؛ والتذكير ليس مضمون الوصول في الرسائل الخاصة.",
    icon: Bell,
    tone: "amber",
  },
  {
    id: "governance",
    name: "حوكمة الوحدات والبيانات",
    english: "MODULE GOVERNANCE",
    category: "التشغيل",
    priority: "أساس مشترك",
    status: "معاينة الواجهة",
    description: "طبقة تشرح الصلاحيات والبيانات والاعتماديات التي تحتاجها كل وحدة قبل تشغيلها.",
    capabilities: ["قائمة الأذونات وIntents المطلوبة", "مؤشر جاهزية واتصال فعلي", "مالك مسؤول لكل وحدة", "تاريخ تغيير وسياسة احتفاظ", "مراجعة دورية للأدوار عالية الصلاحية", "خريطة نطاق التأثير للأدوار والقنوات", "نوافذ تجميد مؤقتة للتغييرات الحساسة", "جرد البوتات والويبهوكات ومراجعة مالكها"],
    systemixEdge: "مركز التحكم يعرض سبب تعطّل القدرة بدلاً من تمثيلها كأنها تعمل، ولا يطلب إلا أقل الصلاحيات اللازمة.",
    icon: LockKeyhole,
    tone: "violet",
  },
];

const filters: ModuleCategory[] = ["الكل", "الحماية", "المجتمع", "التشغيل"];

const systemixInnovations = [
  { name: "نبض التهديد المفسّر", label: "THREAT PULSE", detail: "يجمع إشارات متعددة ويشرح لماذا ارتفع الخطر وما الذي خفّضه؛ لا يحظر استناداً إلى إشارة واحدة." },
  { name: "قاطع الهجوم المتدرج", label: "CIRCUIT BREAKER", detail: "تصعيد من التنبيه إلى التهدئة ثم القفل المؤقت، مع مهلة انتهاء ومراجعة للمالك." },
  { name: "جدار تفويض القدرات", label: "CAPABILITY FIREWALL", detail: "يفوض أفعالاً محددة وفق مستهدف وحدود زمنية وعددية، مع موافقة مزدوجة للأفعال الحساسة." },
  { name: "حارس التغييرات", label: "CHANGE GUARDIAN", detail: "يقارن تغييرات القنوات والرتب بخط أساس، ويقترح خطة تصحيح قبل تطبيقها حيث تسمح Discord." },
  { name: "مراقبة الطُعم الآمنة", label: "HONEYPOT WATCH", detail: "إشارات تنبيه اختيارية لا تمنح امتيازاً حقيقياً ولا تُستخدم لجمع بيانات شخصية." },
  { name: "غرفة الحادث العابرة للوحدات", label: "INCIDENT ROOM", detail: "تربط بلاغ التذكرة بإشارة الحماية والموظف والإجراءات في خط زمني واحد، مع فصل صلاحيات كل فريق." },
  { name: "رادار انحراف الصلاحيات", label: "PERMISSION DRIFT RADAR", detail: "يراجع تغييرات الأذونات الخطرة مقارنة بخط أساس، ويعرض الفرق ومقترح الإصلاح." },
  { name: "محاكاة الظل ومعاينة الأثر", label: "SHADOW POLICY PREVIEW", detail: "تشغّل القاعدة في وضع مراقبة على أحداث متاحة، وتعرض الأثر المتوقع قبل الإنفاذ." },
  { name: "قرارات قابلة للتفسير", label: "EXPLAINABLE DECISIONS", detail: "كل استجابة تشرح القاعدة والإشارات والسبب وطريقة المراجعة أو الاعتراض." },
  { name: "وضع المرونة الآمن", label: "RESILIENCE MODE", detail: "عند فقد الصلاحية أو تجاوز معدل API يوقف الإجراءات غير المؤكدة ويبلغ المسؤول بدلاً من التصعيد الأعمى." },
  { name: "فاصل الثقة عن الشعبية", label: "TRUST / ENGAGEMENT SEPARATION", detail: "يفصل درجة الأمان عن XP والتفاعل؛ لا يتحول النشاط الاجتماعي إلى صلاحية أو حكم أمني." },
  { name: "ماسح تعارض السياسات", label: "POLICY COLLISION SCANNER", detail: "يكشف تناقض قواعد الوحدات أو تعارضها مع الاستثناءات والتفويض قبل نشرها." },
  { name: "مختبر تمارين الدفاع الآمن", label: "SAFE DRILL LAB", detail: "يشغّل سيناريوهات اصطناعية للـraid وعبث الصلاحيات كي يتدرّب الطاقم ويرى الاستجابة؛ بلا تنفيذ هجوم حي أو تغيير بيانات Discord." },
  { name: "خريطة نطاق الضرر", label: "BLAST-RADIUS MAP", detail: "تصوّر العلاقات بين الأدوار والقنوات والأذونات والتكاملات لتوضيح ما قد يتأثر إذا أسيء استخدام صلاحية مرتفعة." },
  { name: "مراجعة امتيازات الطاقم", label: "ACCESS RECERTIFICATION", detail: "تذكير دوري للمالك لمراجعة الأدوار الحساسة والاحتفاظ بمن يحتاجها فقط؛ لا يسحب دوراً تلقائياً من دون قرار مخول." },
  { name: "تجميد التغييرات الحساسة", label: "CHANGE FREEZE WINDOW", detail: "نافذة مؤقتة تمنع تغييرات إدارية محددة وقت الحوادث أو الصيانة، مع استثناء موثق للمالك وانتهاء تلقائي." },
  { name: "استئناف بمراجعة مستقلة", label: "INDEPENDENT APPEAL", detail: "يراجع مشرف مختلف الإنذار أو الإجراء، يرى الحد الأدنى من الأدلة، ويسجل سبب الإبقاء أو التعديل حيث تسمح Discord." },
  { name: "جرد تكاملات موثوق", label: "INTEGRATION INVENTORY", detail: "قائمة للبوتات والويبهوكات المعروفة ومالكها وآخر تغيير ظاهر؛ تنبّه عند إضافة عنصر غير معتمد من دون ادعاء كشف كل تهديد." },
];

export default function ModuleCenter({ bot, selectedGuildName, botInstalled, onToast }: { bot: DiscordBotState; selectedGuildName: string | null; botInstalled: boolean; onToast: (message: ToastMessage) => void }) {
  const [filter, setFilter] = useState<ModuleCategory>("الكل");
  const [query, setQuery] = useState("");
  const selectedGuildStatus = !selectedGuildName
    ? bot.status === "ready" ? "Gateway متصل، لكن لم يُحدّد Guild في هذه الجلسة." : "لا يوجد Guild محدد؛ حالة البوت لا تعني أن أي خادم اختُبر."
    : !botInstalled
      ? `البوت غير مدعو إلى ${selectedGuildName}؛ لن تعمل وحداته فيه بعد.`
      : bot.status === "ready"
        ? `البوت مدعو إلى ${selectedGuildName} وGateway Ready؛ تفعيل كل وحدة وأذوناتها واختبارها يظل خاصاً بهذا Guild.`
        : `البوت مدعو إلى ${selectedGuildName} لكن Gateway ليس Ready حالياً (${bot.status}).`;
  const visibleModules = useMemo(() => modules.filter((item) => {
    const matchesCategory = filter === "الكل" || item.category === filter;
    const searchable = `${item.name} ${item.english} ${item.description} ${item.capabilities.join(" ")}`.toLowerCase();
    return matchesCategory && searchable.includes(query.trim().toLowerCase());
  }), [filter, query]);

  return <>
    <div className="module-preview-notice"><span className="module-preview-mark"><AlertTriangle size={17} /></span><div><strong>حالة المصدر والتشغيل</strong><span>{bot.moduleCount}/{bot.totalModuleCount} وحدة لها تنفيذ مصدري. {selectedGuildStatus} هذه الشارة تصف وجود الكود فقط، ولا تثبت إعداداً مفعلاً أو اختباراً ناجحاً في Discord.</span></div><span className="module-preview-chip">SOURCE STATUS</span></div>
    <div className="module-heading"><div><span className="eyebrow">SYSTEMIX MODULE CENTER</span><h1>كل مجتمع يحتاج منظومة.<br /><em>والحماية تأتي أولاً.</em></h1><p>وحدات متعددة تحت لوحة واحدة، مع صلاحيات واضحة وفصل بين الأمان والتفاعل.</p></div><div className="module-heading-mark"><ShieldAlert size={28} /><span>SECURITY<br />FIRST</span></div></div>

    <section className="module-priority-band" aria-label="أولوية المنتج"><div className="module-priority-icon"><ShieldCheck size={20} /></div><div><span>نواة المنتج · أولوية 01</span><strong>الدفاع والثقة يظلان مستقلين عن بقية الوحدات.</strong><small>لا تمنح نقاط النشاط أو أدوار الفعاليات أي امتياز أمني.</small></div><div className="module-priority-count"><b>03</b><small>خطوط دفاع مقترحة</small></div></section>

    <div className="module-toolbar"><div className="module-filter-list" role="group" aria-label="تصنيف الوحدات">{filters.map((item) => <button type="button" key={item} aria-pressed={filter === item} className={filter === item ? "module-filter-active" : ""} onClick={() => setFilter(item)}>{item}{item === "الكل" && <span>{modules.length}</span>}</button>)}</div><label className="module-search"><Activity size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن وحدة أو ميزة" aria-label="ابحث عن وحدة أو ميزة" /></label></div>

    <div className="module-results-line"><span>مكتبة وحدات Systemix</span><small>{visibleModules.length} وحدة · الجاهزية محسوبة من كود البوت، لا من تفعيل Guild</small></div>
    <section className="module-grid" aria-label="وحدات Security Systemix">{visibleModules.map((item) => {
      const Icon = item.icon;
      const readiness = getProductModuleReadiness(item.id, bot.implementedModules);
      return <article className={`module-card ${item.featured ? "module-card-featured" : ""}`} key={item.id}>
        <div className="module-card-top"><span className={`module-icon module-icon-${item.tone}`}><Icon size={18} /></span><span className={`module-status module-status-${readiness.tone}`} title={readiness.detail}><i />{readiness.label}</span></div>
        <div className="module-card-meta"><span>{item.category}</span><span>{item.priority}</span></div>
        <h2>{item.name}</h2><span className="module-english">{item.english}</span><p className="module-description">{item.description}</p>
        <details className="module-details"><summary>قدرات الوحدة <span>{item.capabilities.length} عناصر</span><ChevronDown size={14} /></summary><ul>{item.capabilities.map((capability) => <li key={capability}><CheckCircle2 size={13} />{capability}</li>)}</ul></details>
        <div className="module-edge"><span className="module-edge-icon"><Sparkles size={14} /></span><div><small>لمسة Systemix</small><p>{item.systemixEdge}</p></div></div>
        <button type="button" className="module-plan-button" onClick={() => onToast({ title: `${item.name} — الجاهزية`, detail: readiness.detail, kind: readiness.tone === "implemented" ? "info" : "warning" })}>تفاصيل الجاهزية <ArrowUpLeft size={14} /></button>
      </article>;
    })}</section>
    {visibleModules.length === 0 && <div className="module-empty"><MessageSquareText size={23} /><strong>ما لقينا وحدة بهذا الاسم</strong><span>غيّر كلمة البحث أو اختر تصنيفاً آخر.</span></div>}

    <section className="innovation-catalog"><div className="innovation-catalog-heading"><div><span className="overline">SYSTEMIX SIGNATURE CONCEPTS</span><h2>ابتكارات صُممت لتعمل كمنظومة واحدة</h2><p>أفكار مميزة للمنتج — تحتاج بناءً واختباراً؛ وليست مزايا متصلة حالياً أو ادعاءً بتفرّد عالمي.</p></div><span className="innovation-catalog-count">{systemixInnovations.length} فكرة</span></div><div className="innovation-catalog-grid">{systemixInnovations.map((item, index) => <article className="innovation-concept" key={item.label}><div className="innovation-concept-top"><span>{String(index + 1).padStart(2, "0")}</span><Sparkles size={14} /></div><small>{item.label}</small><h3>{item.name}</h3><p>{item.detail}</p></article>)}</div></section>

    <section className="module-roadmap panel"><div className="module-roadmap-heading"><span className="module-roadmap-icon"><Clock3 size={17} /></span><div><span className="overline">BUILD ORDER</span><h2>ترتيب البناء المقترح</h2></div></div><div className="module-roadmap-steps"><div><b>01</b><strong>ربط Discord وفحص الصلاحيات</strong><span>OAuth2، سيرفر الاختبار، رتبة البوت وIntents اللازمة.</span></div><div><b>02</b><strong>تفعيل الحماية واختبارها</strong><span>Gateway، قواعد آمنة، سجل حوادث، واختبار احتواء.</span></div><div><b>03</b><strong>إطلاق وحدات المجتمع</strong><span>الدعم والتهيئة والاقتراحات والفعاليات والتفاعل، كل واحدة بصلاحياتها.</span></div><div><b>04</b><strong>التحليلات والأتمتة</strong><span>بعد تحديد البيانات والاحتفاظ وحدود التشغيل.</span></div></div><div className="module-roadmap-foot"><Settings2 size={14} /><span>الموقع المنشور يعرض لوحة المنتج؛ لا يعني أن البوت أو هذه الوحدات متصلة فعلياً.</span></div></section>
  </>;
}
