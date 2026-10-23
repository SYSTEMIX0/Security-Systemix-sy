export type ProductModuleReadiness = {
  tone: "implemented" | "partial" | "planned";
  label: string;
  detail: string;
};

type ModuleCoverage = {
  requires: string[];
  mode: "implemented" | "partial";
  label: string;
  detail: string;
};

const coverage: Record<string, ModuleCoverage> = {
  "defense-core": {
    requires: ["antiNuke", "antiRaid", "antiSpam", "autoMod", "honeypot", "lockdown", "moderation", "logging", "verification"],
    mode: "implemented",
    label: "محركات أمنية في المصدر",
    detail: "توجد وحدات الحماية الأساسية واختباراتها. هذا لا يعني تفعيلها على Guild أو اختبارها حياً، كما أن غرفة الحوادث ورادار الانحراف والتمارين الآمنة ما زالت غير مكتملة.",
  },
  "permission-firewall": {
    requires: ["delegation"], mode: "partial", label: "نواة التفويض موجودة",
    detail: "تتحقق وحدة التفويض من الدور والإجراء والمستهدف والحدود وتسجل الحالة؛ الموافقة المزدوجة والاستئناف المستقل لم يُنفذا.",
  },
  tickets: {
    requires: ["tickets"], mode: "partial", label: "نواة التذاكر موجودة",
    detail: "الفتح والقنوات الخاصة والإسناد والإغلاق موجودة في كود البوت. ربط لوحة الإدارة ونسخ المحادثة والاستعادة التشغيلية ما زالت محدودة؛ يلزم اختبار Guild.",
  },
  onboarding: {
    requires: ["welcome", "selfRoles", "verification"], mode: "partial", label: "نواة التهيئة موجودة",
    detail: "الترحيب والأدوار الذاتية وبوابة الزر موجودة في المصدر. تدفق قبول القواعد وCAPTCHA الخارجية غير موجود، والأدوار تتطلب فحصاً حياً لترتيب Discord.",
  },
  feedback: {
    requires: ["suggestions"], mode: "partial", label: "الاقتراحات موجودة",
    detail: "التقديم والمراجعة موجودان؛ التصويت متعدد الخيارات والاستطلاعات غير منفذين.",
  },
  engagement: {
    requires: ["leveling"], mode: "partial", label: "XP أساسي موجود",
    detail: "يوجد XP بمخزن اجتماعي منفصل؛ الشارات والتحديات ليست مكتملة، ولا تمنح النقاط صلاحيات أمنية.",
  },
  commands: {
    requires: ["systemix"], mode: "partial", label: "أوامر النظام الأساسية",
    detail: "أوامر الحالة والتشخيص متاحة في المصدر؛ أوامر FAQ المخصصة غير منفذة.",
  },
  governance: {
    requires: ["systemix", "logging", "backups"], mode: "partial", label: "أساس الحوكمة موجود",
    detail: "توجد حالة وحدات وسجلات ولقطات بنيوية. خريطة التأثير ومراجعة الامتيازات وإدارة السياسات من لوحة التحكم غير مكتملة.",
  },
  "incident-bridge": {
    requires: [], mode: "partial", label: "مخطط",
    detail: "لم تُبنَ بعد آلية تجمع التذكرة الأمنية والحادث والموافقات في خط زمني واحد.",
  },
  events: {
    requires: [], mode: "partial", label: "مخطط",
    detail: "السحوبات ليست وحدة فعاليات RSVP؛ إنشاء فعاليات Discord، السعة وقائمة الانتظار والتذكيرات لم تُنفذ.",
  },
  analytics: {
    requires: [], mode: "partial", label: "مخطط",
    detail: "توجد عدادات تشغيلية داخلية محدودة، لكن صفحة تحليلات مجتمع وبياناتها التاريخية غير متصلة.",
  },
  automation: {
    requires: [], mode: "partial", label: "مخطط",
    detail: "لا توجد حالياً واجهة سير عمل عامة للمحفزات والشروط والإجراءات.",
  },
  announcements: {
    requires: [], mode: "partial", label: "مخطط",
    detail: "جدولة الإعلانات والتذكيرات وإدارة المناطق الزمنية غير منفذة.",
  },
};

export function getProductModuleReadiness(moduleId: string, implementedModules: readonly string[]): ProductModuleReadiness {
  const spec = coverage[moduleId];
  if (!spec || spec.requires.length === 0) {
    return {
      tone: "planned",
      label: "مخطط فقط",
      detail: spec?.detail ?? "لا يوجد معالج بوت محدد لهذه الوحدة في المصدر حالياً.",
    };
  }

  const implemented = spec.requires.filter((name) => implementedModules.includes(name));
  if (implemented.length === 0) {
    return { tone: "planned", label: "غير منفذ", detail: spec.detail };
  }
  if (implemented.length < spec.requires.length || spec.mode === "partial") {
    return { tone: "partial", label: spec.label, detail: spec.detail };
  }
  return { tone: "implemented", label: spec.label, detail: spec.detail };
}
