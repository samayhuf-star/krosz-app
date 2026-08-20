import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Clock, DollarSign, Repeat, ShieldCheck, Sparkles, TrendingUp, Zap } from 'lucide-react';

function Stat({ icon: Icon, label, value, hint, tone = 'slate' }) {
  const tones = { slate: 'text-slate-900', emerald: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700', sky: 'text-sky-700' };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Icon size={14} /> {label}</div>
      <p className={`mt-2 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

export default function TelemetrySummary({ telemetry, isAdmin }) {
  const s = telemetry?.summary || {};
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat icon={Activity} label="Executions" value={s.total ?? '—'} />
        <Stat icon={TrendingUp} label="Success Rate" value={`${s.successRate ?? 0}%`} tone={s.successRate >= 90 ? 'emerald' : s.successRate >= 60 ? 'amber' : 'rose'} hint={`${s.success ?? 0} ok · ${s.failures ?? 0} failed`} />
        <Stat icon={Clock} label="Avg Latency" value={s.avgLatencyMs ? `${s.avgLatencyMs}ms` : '—'} />
        <Stat icon={DollarSign} label="Est. Cost" value={`$${(s.totalEstimatedCost ?? 0).toFixed(4)}`} />
        <Stat icon={Zap} label="Fallbacks" value={s.fallbacks ?? 0} tone={s.fallbacks ? 'amber' : 'slate'} />
        <Stat icon={Repeat} label="Retries" value={s.retries ?? 0} tone={s.retries ? 'amber' : 'slate'} />
        <Stat icon={Sparkles} label="Cache Hits" value={s.cacheHits ?? 0} tone={s.cacheHits ? 'emerald' : 'slate'} />
        <Stat icon={ShieldCheck} label="Admin" value={isAdmin ? 'Yes' : 'No'} tone="sky" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Breakdown title="By Provider" rows={telemetry?.byProvider} />
        <Breakdown title="By Model" rows={telemetry?.byModel} />
        <Breakdown title="By Capability" rows={telemetry?.byCapability} />
      </div>
      <div className="mt-4">
        <Breakdown title="By Prompt (versions)" rows={telemetry?.byPrompt} wide />
      </div>
    </div>
  );
}

function Breakdown({ title, rows, wide }) {
  return (
    <Card className={wide ? 'p-4' : 'p-4'}>
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      {!rows || !rows.length ? <p className="text-xs text-slate-400">No data yet.</p> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between text-xs">
              <span className="font-mono text-slate-700 truncate max-w-[40%]">{r.key}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono">×{r.count}</Badge>
                <span className="text-slate-500">{r.avgLatencyMs}ms</span>
                <span className={r.successRate >= 90 ? 'text-emerald-600' : r.successRate >= 50 ? 'text-amber-600' : 'text-rose-600'}>{r.successRate}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}