import { Loader2, Clock, ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';

// Background-queue counts across ALL runs for this tenant. Counts are computed
// from run status (not single-run task counts): finished runs that executed to
// completion surface here only as "Completed".
export default function QueueSummary({ runs = [] }) {
  const running = runs.filter((r) => r.status === 'running').length;
  const queued = runs.filter((r) => r.status === 'pending' || r.status === 'ready').length;
  const waiting = runs.filter((r) => r.status === 'awaiting_approval' || r.status === 'paused_approval').length;
  const completed = runs.filter((r) => r.status === 'completed').length;
  const failed = runs.filter((r) => r.status === 'failed').length;

  const items = [
    { label: 'Running', value: running, icon: Loader2, tone: 'text-sky-600', spin: running > 0 },
    { label: 'Queued', value: queued, icon: Clock, tone: 'text-slate-600' },
    { label: 'Waiting', value: waiting, icon: ShieldCheck, tone: 'text-amber-600' },
    { label: 'Completed', value: completed, icon: CheckCircle2, tone: 'text-emerald-600' },
    { label: 'Failed', value: failed, icon: AlertTriangle, tone: 'text-red-600' },
  ];

  return (
    <div className="grid grid-cols-5 gap-2">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-slate-200 bg-white px-2 py-3 text-center">
          <it.icon size={16} className={`mx-auto ${it.tone} ${it.spin ? 'animate-spin' : ''}`} />
          <div className="mt-1 text-lg font-semibold text-slate-900">{it.value}</div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{it.label}</div>
        </div>
      ))}
    </div>
  );
}