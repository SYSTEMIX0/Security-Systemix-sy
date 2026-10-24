export type DashboardSection =
  | "overview"
  | "connection"
  | "modules"
  | "protection"
  | "community"
  | "delegation"
  | "incidents"
  | "logs"
  | "backups"
  | "operations"
  | "team"
  | "plans"
  | "settings"
  | "lists";

export const demoGuild = {
  name: "Systemix Community",
  initials: "SC",
  members: "12,480",
  region: "EU West",
};

export const demoMetrics = [
  { label: "تهديدات تم احتواؤها", value: "248", change: "+18%", tone: "mint" },
  { label: "أعضاء تم التحقق منهم", value: "1,392", change: "+12%", tone: "blue" },
  { label: "إجراءات إدارية", value: "36", change: "هذا الأسبوع", tone: "violet" },
] as const;

export const demoEvents = [
  {
    id: "evt-1",
    type: "raid",
    title: "موجة انضمام غير طبيعية",
    detail: "23 حساباً خلال 18 ثانية · احتواء تلقائي",
    time: "منذ دقيقتين",
    status: "contained",
    initials: "RA",
  },
  {
    id: "evt-2",
    type: "permission",
    title: "تغيير صلاحيات رتبة",
    detail: "تم رصد صلاحية Manage Webhooks",
    time: "منذ 14 دقيقة",
    status: "review",
    initials: "PR",
  },
  {
    id: "evt-3",
    type: "spam",
    title: "روابط متكررة في #general",
    detail: "تم حذف 8 رسائل وإيقاف الإرسال مؤقتاً",
    time: "منذ 31 دقيقة",
    status: "contained",
    initials: "SP",
  },
  {
    id: "evt-4",
    type: "delegation",
    title: "طلب تفويض رتبة",
    detail: "بانتظار موافقة مشرف ثانٍ",
    time: "منذ 52 دقيقة",
    status: "pending",
    initials: "AP",
  },
];

export const demoAuditLogs = [
  { id: "#SY-2048", actor: "Systemix Guardian", action: "احتواء موجة انضمام", target: "23 عضواً جديداً", time: "16:42:18", severity: "high" },
  { id: "#SY-2047", actor: "Lina Moderator", action: "منح رتبة عبر التفويض", target: "@Verified", time: "16:31:04", severity: "normal" },
  { id: "#SY-2046", actor: "Systemix AutoMod", action: "حذف روابط متكررة", target: "#general · 8 رسائل", time: "16:18:55", severity: "medium" },
  { id: "#SY-2045", actor: "Omar Admin", action: "تحديث عتبة Anti-Raid", target: "من 8 إلى 10 / 20ث", time: "15:52:09", severity: "normal" },
  { id: "#SY-2044", actor: "Systemix Guardian", action: "مراجعة صلاحيات رتبة", target: "@Event Manager", time: "15:23:42", severity: "medium" },
  { id: "#SY-2043", actor: "Mazen Moderator", action: "Timeout لمدة 10 دقائق", target: "user_4821", time: "14:57:20", severity: "normal" },
];

export const demoIncidents = [
  { id: "INC-083", title: "موجة انضمام مشبوهة", category: "Anti-Raid", confidence: 94, affected: "23 حساباً", time: "16:42", state: "contained" },
  { id: "INC-082", title: "صلاحية إدارية غير متوقعة", category: "Permission Drift", confidence: 78, affected: "رتبة واحدة", time: "16:28", state: "review" },
  { id: "INC-081", title: "فيض روابط ودعوات", category: "AutoMod", confidence: 91, affected: "8 رسائل", time: "15:57", state: "resolved" },
  { id: "INC-080", title: "إضافة بوت جديد", category: "Change Guardian", confidence: 63, affected: "بوت واحد", time: "14:36", state: "review" },
];

export const demoDelegations = [
  { id: "del-1", member: "Lina Moderator", tag: "@Lina#2048", initials: "LM", capability: "منح الرتب المعتمدة", scope: "@Verified · @Event Guest", limit: "حتى 20 عضواً / ساعة", status: "active" },
  { id: "del-2", member: "Omar Support", tag: "@Omar#7182", initials: "OS", capability: "إصدار تحذير", scope: "جميع الأعضاء عدا الإدارة", limit: "حتى 5 تحذيرات / ساعة", status: "active" },
  { id: "del-3", member: "Hala Helper", tag: "@Hala#0631", initials: "HH", capability: "إدارة التحقق", scope: "الأعضاء الجدد فقط", limit: "موافقة ثانية مطلوبة", status: "approval" },
];

export const demoBackups = [
  { id: "BKP-018", label: "نسخة إعدادات النظام", date: "اليوم · 16:30", size: "إعدادات البوت فقط", kind: "systemix" },
  { id: "BKP-017", label: "خط أساس بنية السيرفر", date: "اليوم · 09:00", size: "قنوات ورتب وأذونات", kind: "guild" },
  { id: "BKP-016", label: "نسخة إعدادات النظام", date: "أمس · 16:30", size: "إعدادات البوت فقط", kind: "systemix" },
];

export const demoLists: { id: string; kind: "allow" | "block"; type: string; value: string; scope: string; note: string; created: string }[] = [
  { id: "lst-1", kind: "allow", type: "member", value: "Lina Moderator", scope: "استثناء Anti-Spam", note: "عضو فريق موثّق", created: "اليوم" },
  { id: "lst-2", kind: "allow", type: "domain", value: "events.example", scope: "الروابط المسموحة", note: "نطاق التذاكر الرسمي", created: "أمس" },
  { id: "lst-3", kind: "block", type: "domain", value: "malicious.example", scope: "حظر الروابط", note: "إشارة تصيّد محاكاة", created: "اليوم" },
  { id: "lst-4", kind: "block", type: "bot", value: "SuspiciousBot#1234", scope: "مراجعة دخول البوتات", note: "يتطلب مراجعة المالك", created: "أمس" },
];

export const chartValues = [
  { label: "00", value: 22 },
  { label: "02", value: 16 },
  { label: "04", value: 31 },
  { label: "06", value: 26 },
  { label: "08", value: 44 },
  { label: "10", value: 38 },
  { label: "12", value: 59 },
  { label: "14", value: 43 },
  { label: "16", value: 88 },
  { label: "18", value: 54 },
  { label: "20", value: 36 },
  { label: "22", value: 28 },
];
