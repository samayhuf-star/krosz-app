import { Gauge, TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function LeadScoringPanel({ scoreRules, thresholds }) {
  const rules = scoreRules || [];
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2"><Gauge size={16} className="text-emerald-700" /><h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Score Thresholds</h3></div>
        {thresholds ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Object.entries(thresholds).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center"><p className="text-xs capitalize text-slate-500">{k.replace('_', ' ')}</p><p className="text-lg font-bold text-slate-900">{v}</p></div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">—</p>}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Scoring Rules · {rules.length}</h3>
        {!rules.length ? <p className="text-sm text-slate-500">No scoring rules.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2">Field</th><th className="pb-2">Operator</th><th className="pb-2">Value</th><th className="pb-2 text-right">Points</th><th className="pb-2">Reason</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((r) => (
                  <tr key={r.id || r.rule_key}>
                    <td className="py-2 font-medium text-slate-800">{r.field}</td>
                    <td className="py-2"><Badge variant="outline" className="border-slate-300 font-mono text-slate-600">{r.operator}</Badge></td>
                    <td className="py-2 text-slate-600">{r.value}</td>
                    <td className="py-2 text-right"><span className={`inline-flex items-center gap-1 font-semibold ${r.points >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{r.points >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{r.points}</span></td>
                    <td className="py-2 text-slate-500">{r.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}