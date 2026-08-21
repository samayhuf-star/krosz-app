import { Loader2, CheckCircle2, AlertTriangle, Lock, Sparkles, ArrowRight, RotateCw } from 'lucide-react';

const TONE = {
  preparing: 'bg-slate-100 text-slate-600', queued: 'bg-slate-100 text-slate-600',
  running: 'bg-sky-100 text-sky-700', waiting_for_approval: 'bg-amber-100 text-amber-700',
  awaiting_clarification: 'bg-amber-100 text-amber-700', completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700', blocked: 'bg-amber-100 text-amber-700',
  capability_not_available: 'bg-slate-100 text-slate-500', understanding: 'bg-slate-100 text-slate-500',
};

// Renders one customer action: honest status, live progress, real approve/retry
// buttons wired to the action engine (which proxies the real approval engine).
export default function AssistantActionCard({ action, progress, onApprove, onRetry, busy }) {
  if (!action) return null;
  const status = action.status;
  const chip = TONE[status] || TONE.preparing;
  const p = progress;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip}`}>
          {humanStatus(status)}
        </span>
        <span className="ml-auto text-[11px] text-slate-400">{action.capability?.replace(/_/g, ' ')}</span>
      </div>

      <p className="mt-2.5 text-sm leading-6 text-slate-700">{action.reply}</p>

      {p && status === 'running' && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${p.percent || 0}%` }} />
          </div>
          <ul className="mt-2 space-y-0.5">
            {(p.completed || []).map((c) => <li key={c} className="flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 size={12} /> {c}</li>)}
            {p.running_label && <li className="flex items-center gap-1.5 text-xs text-sky-600"><Loader2 size={12} className="animate-spin" /> {p.running_label}…</li>}
          </ul>
        </div>
      )}
      {p && status === 'blocked' && p.failed_label && (
        <p className="mt-2 text-xs text-amber-700">Waiting on: {p.failed_label}</p>
      )}

      {status === 'waiting_for_approval' && (
        <button onClick={onApprove} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Review & Approve <ArrowRight size={14} />
        </button>
      )}
      {status === 'failed' && (
        <button onClick={onRetry} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />} Try again
        </button>
      )}
      {status === 'capability_not_available' && (
        <p className="mt-2 text-[11px] text-slate-400">Try “show my customers”, “improve my website”, or “improve my SEO”.</p>
      )}
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === 'running' || status === 'preparing' || status === 'queued' || status === 'understanding') return <Loader2 size={15} className="animate-spin text-sky-500" />;
  if (status === 'completed') return <CheckCircle2 size={15} className="text-emerald-600" />;
  if (status === 'failed') return <AlertTriangle size={15} className="text-rose-600" />;
  if (status === 'blocked') return <Lock size={15} className="text-amber-600" />;
  if (status === 'waiting_for_approval') return <Sparkles size={15} className="text-amber-600" />;
  return <Sparkles size={15} className="text-slate-400" />;
}

function humanStatus(s) {
  return ({
    understanding: 'Understanding', preparing: 'Preparing', queued: 'Queued', running: "I'm on it",
    waiting_for_approval: 'Needs your approval', awaiting_clarification: 'Needs a detail',
    completed: 'Done', failed: 'Needs attention', blocked: 'Waiting on another step', capability_not_available: 'Not available yet',
  })[s] || s;
}