import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { adminReviewDecision } from '@/lib/adminCaseApi';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function SecReviews({ d, reload, caseId }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const gates = d.review_gates || [];
  const decide = async (decision, notes) => {
    setBusy(decision);
    const gate = gates.find((g) => g.status === 'OPEN');
    try { await adminReviewDecision({ id: caseId, decision, gate_type: gate?.gate_type, notes }); toast({ title: `Review ${decision.toLowerCase()}` }); reload(); }
    catch (e) { toast({ title: 'Failed', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(''); }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Review gates go through the case engine — the UI cannot bypass them.</p>
      {gates.map((g) => (
        <div key={g.gate_type} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-semibold text-slate-900">{g.gate_type.replace('_', ' ')}</p><p className="text-[11px] text-slate-400">Status: {g.status}{g.assigned_to ? ` · assigned ${String(g.assigned_to).slice(-6)}` : ''}</p></div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${g.status === 'OPEN' ? 'bg-amber-50 text-amber-700' : g.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{g.status}</span>
          </div>
          {g.status === 'OPEN' && (
            <div className="mt-3 flex gap-1.5">
              <button onClick={() => decide('APPROVED', 'Approved')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{busy === 'APPROVED' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Approve</button>
              <button onClick={() => decide('REJECTED', 'Rejected')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50">{busy === 'REJECTED' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Reject</button>
              <button onClick={() => decide('REQUEST_CHANGES', 'Changes requested')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50">Request changes</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}