import { AlertTriangle, ArrowLeft, Construction, ShieldCheck } from "lucide-react";
import type { DashboardSection } from "@/lib/systemix-demo";
import "./ProtectionConsole.css";

type Props = {
  title: string;
  description: string;
  reason: string;
  actionLabel?: string;
  onNavigate?: (section: DashboardSection) => void;
  actionSection?: DashboardSection;
};

export default function UnavailableFeaturePanel({ title, description, reason, actionLabel, onNavigate, actionSection }: Props) {
  return (
    <section className="protection-console" dir="rtl">
      <header className="pc-header"><div><div className="pc-eyebrow"><Construction size={15} /> حالة تنفيذ صريحة</div><h1>{title}</h1><p>{description}</p></div></header>
      <div className="pc-message pc-message-warn" role="status"><AlertTriangle size={18} /> {reason}</div>
      <article className="pc-card"><div className="pc-card-title"><div><span className="pc-icon pc-icon-green"><ShieldCheck size={16} /></span><div><h2>لا توجد بيانات للعرض</h2><p>أزلنا العينات التوضيحية من هذا المسار حتى لا تختلط ببيانات أي عميل أو سيرفر.</p></div></div></div><p className="pc-hint">لن ننفّذ أو ندّعي وجود عملية إنشاء أو تعديل أو اشتراك في Discord من هذه الصفحة حتى يكتمل API المناسب وتُختبر الصلاحيات وسجل التدقيق.</p>{actionLabel && onNavigate && actionSection && <button className="pc-button pc-button-secondary" onClick={() => onNavigate(actionSection)}>{actionLabel} <ArrowLeft size={15} /></button>}</article>
    </section>
  );
}
