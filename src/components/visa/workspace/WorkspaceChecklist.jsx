import { CheckCircle2, XCircle, Clock, AlertTriangle, FileWarning } from 'lucide-react';

const STATE_META = {
  AVAILABLE: { label: 'Available', tone: 'text-orange-700', icon: CheckCircle2 },
  MISSING: { label: 'Missing', tone: 'text-rose-600', icon: XCircle },
  EXPIRED: { label: 'Expired', tone: 'text-rose-700', icon: AlertTriangle },
  INVALID: { label: 'Invalid', tone: 'text-rose-700', icon: FileWarning },
  NEEDS_REVIEW: { label: 'Needs review', tone: 'text-amber-600', icon: Clock },
};

export default function WorkspaceChecklist({ checklist }) {
  const items = checklist?.items || [];
  if (!items.length) return <p className="text-sm text-slate-400">Checklist will appear once requirements resolve.</p>;
  return (
    <div className="divide-y divide-slate-100">
      {items.map((it) => {
        const meta = STATE_META[it.state] || STATE_META.NEEDS_REVIEW;
        const Icon = meta.icon;
        return (
          <div key={`${it.type}:${it.key}`} className="flex items-center gap-3 py-2.5">
            <Icon size={16} className={meta.tone} />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">{it.label}</p>
              <p className="text-[11px] text-slate-400 capitalize">{it.type} {it.required ? '· required' : ''}</p>
            </div>
            <span className={`text-xs font-semibold ${meta.tone}`}>{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}