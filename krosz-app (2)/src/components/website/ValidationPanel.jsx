import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';

const MAP = {
  error: { icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200' },
  warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  info: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

export default function ValidationPanel({ validation }) {
  if (!validation) return <p className="text-sm text-slate-500">No validation report.</p>;
  const checks = validation.checks || [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center"><p className="text-2xl font-semibold text-rose-700">{validation.summary?.errors || 0}</p><p className="text-xs text-rose-600">Errors</p></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center"><p className="text-2xl font-semibold text-amber-700">{validation.summary?.warnings || 0}</p><p className="text-xs text-amber-600">Warnings</p></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center"><p className="text-2xl font-semibold text-emerald-700">{validation.summary?.passed || 0}</p><p className="text-xs text-emerald-600">Passed</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center"><p className="text-2xl font-semibold text-slate-700">{validation.summary?.component_count || 0}</p><p className="text-xs text-slate-500">Components</p></div>
      </div>
      <div className="space-y-2">
        {checks.map((c, i) => {
          const m = MAP[c.severity] || MAP.info;
          const Icon = m.icon;
          return (
            <div key={i} className={`flex items-start gap-3 rounded-xl border ${m.border} ${m.bg} p-3`}>
              <Icon size={16} className={`mt-0.5 shrink-0 ${m.color}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{c.check}{c.location && <span className="font-mono text-xs text-slate-500"> · {c.location}</span>}</p>
                <p className="text-sm text-slate-600">{c.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}