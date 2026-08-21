import { FileBarChart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const TYPE_TONE = { lead_source: 'border-emerald-200 bg-emerald-50/50 text-emerald-700', conversion: 'border-sky-200 bg-sky-50/50 text-sky-700', sales_funnel: 'border-violet-200 bg-violet-50/50 text-violet-700', pipeline_health: 'border-amber-200 bg-amber-50/50 text-amber-700', task_completion: 'border-cyan-200 bg-cyan-50/50 text-cyan-700', service_performance: 'border-rose-200 bg-rose-50/50 text-rose-700' };

export default function ReportsPanel({ reports }) {
  const list = reports || [];
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {!list.length && <p className="text-sm text-slate-500">No reports configured.</p>}
      {list.map((r) => (
        <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-2 flex items-start justify-between gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><FileBarChart size={18} /></span><Badge variant="outline" className={(TYPE_TONE[r.type] || '') + ' capitalize'}>{r.type.replace(/_/g, ' ')}</Badge></div>
          <h4 className="font-semibold text-slate-900">{r.title}</h4>
          <p className="mt-1 text-sm text-slate-600">{r.description}</p>
          <div className="mt-3 flex items-center justify-between text-xs"><span className="font-mono text-slate-400">{r.data_source}</span><Badge variant="outline" className="border-slate-300 capitalize text-slate-500">{r.schedule}</Badge></div>
        </div>
      ))}
    </div>
  );
}