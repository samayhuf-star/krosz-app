import { ArrowRight, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

const TONES = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  neutral: 'bg-slate-50 text-slate-600 border-slate-200',
};

export default function PresenceCard({ icon: Icon, title, description, status, statusTone = 'neutral', actionLabel, actionTo, actionHref }) {
  const StatusIcon = statusTone === 'ok' ? CheckCircle2 : statusTone === 'warn' ? AlertCircle : null;
  const renderLink = () => {
    if (!actionLabel) return null;
    if (actionTo)
      return (
        <Button asChild size="sm" variant="ghost" className="gap-1 text-emerald-700 hover:bg-emerald-50">
          <Link to={actionTo}>{actionLabel}<ArrowRight size={14} /></Link>
        </Button>
      );
    if (actionHref)
      return (
        <Button asChild size="sm" variant="ghost" className="gap-1 text-emerald-700 hover:bg-emerald-50">
          <a href={actionHref} target="_blank" rel="noreferrer">{actionLabel}<ExternalLink size={13} /></a>
        </Button>
      );
    return null;
  };
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon size={18} /></span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${TONES[statusTone]}`}>
          {StatusIcon && <StatusIcon size={12} />}{status}
        </span>
        {renderLink()}
      </div>
    </div>
  );
}