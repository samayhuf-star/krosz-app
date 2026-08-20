import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ArrowRightCircle } from 'lucide-react';
import { adminCaseTransition } from '@/lib/adminCaseApi';
import { CASE_STATE_LABELS as CASE_STATE_LABEL } from '@/lib/wizardLabels';

export default function SecTransitions({ d, trans, reload, caseId }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const allowed = trans?.allowed || [];
  const current = d.case_view.state;
  const go = async (to) => {
    setBusy(to);
    try { await adminCaseTransition({ id: caseId, to, reason }); toast({ title: `Transitioned to ${to}` }); setReason(''); reload(); }
    catch (e) { toast({ title: 'Transition rejected', description: e?.message || e?.error, variant: 'destructive' }); }
    finally { setBusy(''); }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Only valid transitions are exposed (§12). Invalid or submission-gated transitions are rejected by the case engine.</p>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Current state</p>
        <p className="text-sm font-semibold text-slate-900">{current} · {CASE_STATE_LABEL?.[current] || current}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Allowed transitions</h3>
        {allowed.length === 0 ? <p className="mt-2 text-sm text-slate-400">No transitions available from this state (terminal or gated).</p> : (
          <div className="mt-3 space-y-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (audited)" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            <div className="flex flex-wrap gap-1.5">
              {allowed.map((to) => (
                <button key={to} onClick={() => go(to)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {busy === to ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightCircle size={12} />} {to}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}