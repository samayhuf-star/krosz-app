import { CheckCircle2, Circle, CircleDashed, ArrowRight, Lock } from 'lucide-react';

// Section navigation for the application workspace.
// status: complete (all required done) | partial (some) | pending (none) | review
export default function WorkspaceNav({ sections, active, onSelect, reviewActive, onSelectReview, resumeAt }) {
  const items = sections.map((s) => {
    let status = 'pending';
    if (s.complete) status = 'complete';
    else if (s.done > 0) status = 'partial';
    const isResume = resumeAt === s.key && status !== 'complete';
    return {
      key: s.key, label: s.label, status, done: s.done, total: s.total, isResume,
      active: active === s.key, onClick: () => onSelect(s.key),
    };
  });

  return (
    <nav className="space-y-1">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={it.onClick}
          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
            it.active ? 'bg-orange-50 font-semibold text-orange-900 ring-1 ring-orange-200' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <StatusIcon status={it.status} />
          <span className="flex-1">{it.label}</span>
          {it.total > 0 && <span className="text-[10px] font-medium text-slate-400">{it.done}/{it.total}</span>}
          {it.isResume && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700"><ArrowRight size={9} /> resume</span>}
        </button>
      ))}
      <button
        onClick={onSelectReview}
        className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
          reviewActive ? 'bg-orange-50 font-semibold text-orange-900 ring-1 ring-orange-200' : 'text-slate-600 hover:bg-slate-50'
        }`}
      >
        <Lock size={15} className={reviewActive ? 'text-orange-600' : 'text-slate-400'} />
        <span className="flex-1">Review & readiness</span>
      </button>
    </nav>
  );
}

function StatusIcon({ status }) {
  if (status === 'complete') return <CheckCircle2 size={15} className="text-orange-600" />;
  if (status === 'partial') return <CircleDashed size={15} className="text-amber-500" />;
  return <Circle size={15} className="text-slate-300" />;
}