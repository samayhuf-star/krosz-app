import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, RotateCw, Sparkles } from 'lucide-react';

const statusBadge = (e) => {
  if (!e.success) return <Badge variant="destructive" className="border-rose-200 bg-rose-50 text-rose-700"><XCircle size={11} className="mr-1" /> Failed</Badge>;
  if (e.cache_hit) return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><Sparkles size={11} className="mr-1" /> Cache</Badge>;
  if (e.fallback_used) return <Badge className="border-amber-200 bg-amber-50 text-amber-700"><AlertTriangle size={11} className="mr-1" /> Fallback</Badge>;
  if (e.retry_count > 0) return <Badge className="border-sky-200 bg-sky-50 text-sky-700"><RotateCw size={11} className="mr-1" /> Retry</Badge>;
  return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 size={11} className="mr-1" /> OK</Badge>;
};

export default function ExecutionsTable({ recent }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Recent Executions</div>
      {!recent || !recent.length ? (
        <p className="px-4 py-8 text-center text-xs text-slate-400">No executions yet. Run the pipeline to populate telemetry.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Prompt</th>
                <th className="px-3 py-2 font-medium">KG v</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Valid</th>
                <th className="px-3 py-2 font-medium">Latency</th>
                <th className="px-3 py-2 font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2 font-medium text-slate-800">{e.capability}</td>
                  <td className="px-3 py-2 font-mono text-slate-500">{e.prompt_id}@v{e.prompt_version}</td>
                  <td className="px-3 py-2 text-slate-500">{e.kg_version ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-slate-500">{e.model}</td>
                  <td className="px-3 py-2">{statusBadge(e)}</td>
                  <td className="px-3 py-2">
                    {e.validation_status === 'pass' && <span className="text-emerald-600">pass</span>}
                    {e.validation_status === 'fail' && <span className="text-rose-600">fail</span>}
                    {e.validation_status === 'none' && <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{e.latency_ms ?? '—'}ms</td>
                  <td className="px-3 py-2 text-slate-500">${(e.estimated_cost || 0).toFixed(5)}</td>
                  <td className="px-3 py-2 text-slate-400">{e.created_date ? new Date(e.created_date).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}