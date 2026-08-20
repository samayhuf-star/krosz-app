import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function CrmValidationPanel({ version }) {
  const checks = version?.summary?.validation_checks || [];
  const sum = version?.summary?.validation_summary || {};
  const status = version?.validation_status;
  const Tone = status === 'pass' ? 'emerald' : status === 'warning' ? 'amber' : 'rose';
  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-3 rounded-2xl border p-4 ${status === 'pass' ? 'border-emerald-200 bg-emerald-50/50' : status === 'warning' ? 'border-amber-200 bg-amber-50/50' : 'border-rose-200 bg-rose-50/50'}`}>
        <ShieldCheck size={22} className={status === 'pass' ? 'text-emerald-700' : status === 'warning' ? 'text-amber-700' : 'text-rose-700'} />
        <div><p className="font-semibold text-slate-900 capitalize">{status || '—'} validation</p><p className="text-sm text-slate-600">{sum.errors || 0} errors · {sum.warnings || 0} warnings · {sum.passed || 0} passed · health {version?.health_score}/100</p></div>
      </div>
      {!checks.length ? <p className="text-sm text-slate-500">No checks available.</p> : (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {checks.map((c) => {
            const Icon = c.status === 'pass' ? CheckCircle2 : c.severity === 'error' ? XCircle : AlertTriangle;
            const tone = c.status === 'pass' ? 'text-emerald-600' : c.severity === 'error' ? 'text-rose-600' : 'text-amber-600';
            return (
              <div key={c.id || c.check} className="flex items-start gap-3 p-3">
                <Icon size={18} className={`mt-0.5 ${tone}`} />
                <div className="flex-1"><div className="flex items-center gap-2"><p className="font-medium text-slate-800">{c.check}</p><Badge variant="outline" className={tone + ' border-current/20 capitalize'}>{c.severity}</Badge></div><p className="text-sm text-slate-600">{c.message}</p></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}