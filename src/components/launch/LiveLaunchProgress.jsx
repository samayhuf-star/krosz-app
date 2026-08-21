import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { systemOf } from './systemMap';

// Friendly live progress for a REAL engine run. Each business system renders as
// a single line: a short, human label, a short subtitle, and a progress bar that
// reflects the task's true state. No DAG, nodes, stages, providers or retries —
// those live in Advanced Mode (/workflows). The customer simply watches each
// system come online.
function fillFor(status) {
  switch (status) {
    case 'completed':
    case 'approved':
      return { pct: 100, bar: 'bg-emerald-500', done: true, tone: 'text-emerald-700' };
    case 'running':
    case 'retrying':
      return { pct: 62, bar: 'bg-emerald-500', animate: true, tone: 'text-slate-900' };
    case 'ready':
      return { pct: 22, bar: 'bg-sky-400', tone: 'text-slate-700' };
    case 'pending':
      return { pct: 0, bar: 'bg-slate-200', tone: 'text-slate-400' };
    case 'failed':
      return { pct: 100, bar: 'bg-rose-400', warn: true, tone: 'text-rose-700' };
    case 'blocked':
      return { pct: 100, bar: 'bg-rose-300', warn: true, tone: 'text-rose-700' };
    case 'skipped':
    case 'cancelled':
    case 'rejected':
      return { pct: 100, bar: 'bg-slate-300', muted: true, tone: 'text-slate-400' };
    default:
      return { pct: 0, bar: 'bg-slate-200', tone: 'text-slate-400' };
  }
}

export default function LiveLaunchProgress({ tasks = [], compact = false }) {
  const lines = tasks.filter((t) => t.type !== 'approval_gate');
  if (!lines.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={15} className="animate-spin" /> Preparing…
      </div>
    );
  }
  return (
    <div className={`space-y-${compact ? 3 : 4}`}>
      {lines.map((t) => {
        const sys = systemOf(t.task_key);
        const Icon = sys.icon;
        const f = fillFor(t.status);
        const running = t.status === 'running' || t.status === 'retrying';
        return (
          <div key={t.id} className="flex items-center gap-3">
            <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${f.warn ? 'bg-rose-50 text-rose-600' : f.done ? 'bg-emerald-50 text-emerald-600' : running ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
              {f.done && !f.warn ? <CheckCircle2 size={18} /> : f.warn ? <AlertTriangle size={18} /> : running ? <Loader2 size={16} className="animate-spin" /> : <Icon size={17} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className={`text-sm font-medium ${f.tone} ${t.task_key === 'domain' || t.task_key === 'seo' ? '' : ''}`}>{sys.label}</p>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {f.done && !f.warn ? 'done' : f.warn ? 'needs a quick setup' : running ? 'working…' : 'waiting'}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${f.bar} ${f.animate ? 'animate-pulse' : ''} transition-all duration-700 ease-out`}
                  style={{ width: `${f.pct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{running ? sys.blurb : ''}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}