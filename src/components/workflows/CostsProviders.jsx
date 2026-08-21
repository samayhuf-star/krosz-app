import { Cpu, Coins, Boxes } from 'lucide-react';
import { fmtDuration } from './statusMeta';

// Cost + provider summary for a run, computed from its AIExecution rows.
// Costs use estimated_cost (actual_cost is 0 until settlement) and tokens.
export default function CostsProviders({ runId, executions = [] }) {
  const totalCost = executions.reduce((s, e) => s + (Number(e.estimated_cost) || 0), 0);
  const totalTokens = executions.reduce((s, e) => s + (Number(e.tokens) || 0), 0);
  const totalLatency = executions.reduce((s, e) => s + (Number(e.latency_ms) || Number(e.duration_ms) || 0), 0);

  const byProvider = {};
  executions.forEach((e) => {
    const key = e.provider || e.provider_id || '(unknown)';
    if (!byProvider[key]) byProvider[key] = { name: key, calls: 0, tokens: 0, cost: 0, ok: 0, fail: 0 };
    byProvider[key].calls += 1;
    byProvider[key].tokens += Number(e.tokens) || 0;
    byProvider[key].cost += Number(e.estimated_cost) || 0;
    if (e.success) byProvider[key].ok += 1; else byProvider[key].fail += 1;
  });
  const providers = Object.values(byProvider).sort((a, b) => b.calls - a.calls);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 text-slate-400"><Coins size={14} /><span className="text-[11px] font-medium uppercase tracking-wide">Est. cost</span></div>
          <p className="mt-1 text-xl font-semibold text-slate-900">${totalCost.toFixed(4)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 text-slate-400"><Cpu size={14} /><span className="text-[11px] font-medium uppercase tracking-wide">Tokens</span></div>
          <p className="mt-1 text-xl font-semibold text-slate-900">{totalTokens.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 text-slate-400"><Boxes size={14} /><span className="text-[11px] font-medium uppercase tracking-wide">Compute</span></div>
          <p className="mt-1 text-xl font-semibold text-slate-900">{fmtDuration(totalLatency)}</p>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">AI providers used</h4>
        {providers.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <tr><th className="px-3 py-2">Provider</th><th className="px-3 py-2 text-center">Calls</th><th className="px-3 py-2 text-center">Ok</th><th className="px-3 py-2 text-center">Fail</th><th className="px-3 py-2 text-right">Cost</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {providers.map((p) => (
                  <tr key={p.name}>
                    <td className="px-3 py-2 font-medium text-slate-700">{p.name}</td>
                    <td className="px-3 py-2 text-center text-slate-600">{p.calls}</td>
                    <td className="px-3 py-2 text-center text-emerald-600">{p.ok}</td>
                    <td className="px-3 py-2 text-center text-red-600">{p.fail}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">${p.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No provider executions recorded for this run yet.</p>
        )}
      </div>
    </div>
  );
}