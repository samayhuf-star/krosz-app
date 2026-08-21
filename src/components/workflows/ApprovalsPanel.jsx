import { ShieldCheck, Loader2, Check, X } from 'lucide-react';
import { prettyKey } from './statusMeta';
import { Button } from '@/components/ui/button';

// Single-screen approval center for the selected run: every task in
// awaiting_approval state, with Approve / Reject actions wired to the engine
// (orchestrator approve/reject). Approval gates that carry options let the user
// pick one and approve WITH a decision (lightweight "Modify").
export default function ApprovalsPanel({ tasks = [], run, onApprove, onReject }) {
  const pending = tasks.filter((t) => t.status === 'awaiting_approval');
  if (!pending.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
        <ShieldCheck size={26} className="text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-500">No approvals waiting</p>
        <p className="mt-1 text-xs text-slate-400">When a workflow reaches an approval gate, it pauses here for your decision.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pending.map((t) => {
        const opts = t.approval_payload?.options || [];
        return (
          <div key={t.id} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-amber-200 bg-white text-amber-600">
                <ShieldCheck size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{t.approval_payload?.title || prettyKey(t.task_key)}</h3>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Approval required</span>
                  {t.money_spending && (
                    <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[11px] font-medium text-fuchsia-700">Spend</span>
                  )}
                </div>
                {opts.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    {opts.map((o, i) => (
                      <li key={i} className={`rounded-lg px-2.5 py-1.5 ${i === (t.approval_payload?.recommended_option ?? 0) ? 'bg-white font-medium text-slate-900 ring-1 ring-amber-300' : ''}`}>
                        {typeof o === 'string' ? o : o?.label || JSON.stringify(o)}
                        {i === (t.approval_payload?.recommended_option ?? 0) && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">Recommended</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {t.approval_payload?.decision_type && !opts.length && (
                  <p className="mt-1.5 text-sm text-slate-600">Review and decide to continue the workflow.</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => onReject(t)} className="border-rose-200 text-rose-700 hover:bg-rose-50">
                <X size={14} /> Reject
              </Button>
              <Button size="sm" onClick={() => onApprove(t)} className="bg-emerald-700 hover:bg-emerald-800">
                <Check size={14} /> Approve
              </Button>
            </div>
          </div>
        );
      })}
      {onApprove.__busy && (
        <p className="flex items-center justify-center gap-2 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Processing…</p>
      )}
    </div>
  );
}