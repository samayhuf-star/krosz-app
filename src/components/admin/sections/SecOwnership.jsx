import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { adminCaseAssign, adminCasePrioritySet } from '@/lib/adminCaseApi';
import { Loader2 } from 'lucide-react';

export default function SecOwnership({ d, reload, caseId }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [pri, setPri] = useState('');
  const [priReason, setPriReason] = useState('');
  const c = d.case;
  const assign = async (assign_to_me) => {
    setBusy('assign');
    try { await adminCaseAssign({ id: caseId, role: 'operations_owner', assign_to_me, assignee: assign_to_me ? undefined : ownerId, reason: 'Operations assignment' }); toast({ title: 'Assigned' }); setOwnerId(''); reload(); }
    catch (e) { toast({ title: 'Failed', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(''); }
  };
  const setPriority = async () => {
    setBusy('pri'); try { await adminCasePrioritySet({ id: caseId, priority: pri, reason: priReason }); toast({ title: 'Priority set' }); setPri(''); setPriReason(''); reload(); }
    catch (e) { toast({ title: 'Failed', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(''); }
  };
  const prev = (d.case_view?.ownership?.operations_owner) || c.ops_owner_id;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Ownership</h3>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <KV label="Current owner" value={c.ops_owner_id ? String(c.ops_owner_id).slice(-8) : 'Unassigned'} />
          <KV label="Priority" value={c.ops_priority || 'NORMAL'} />
          <KV label="Override" value={c.ops_priority_overridden ? 'Yes' : 'No'} />
          <KV label="Priority reason" value={c.ops_priority_reason || '—'} />
          <KV label="Previous owner" value={prev ? String(prev).slice(-8) : '—'} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Every reassignment is audited.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="Assignee user id" className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <button onClick={() => assign(false)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">{busy === 'assign' ? <Loader2 size={14} className="animate-spin" /> : null} Assign</button>
          <button onClick={() => assign(true)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Assign to me</button>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Priority</h3>
        <p className="mt-1 text-[11px] text-slate-400">HIGH/URGENT overrides require a reason + actor (audited). An override can never silently lower an URGENT business rule.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={pri} onChange={(e) => setPri(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm"><option value="">Priority…</option>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <input value={priReason} onChange={(e) => setPriReason(e.target.value)} placeholder="Reason (required for override)" className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <button onClick={setPriority} disabled={!pri || !!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50">Set</button>
        </div>
      </div>
    </div>
  );
}
function KV({ label, value }) { return <div><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p><p className="text-sm font-medium text-slate-800">{String(value ?? '—')}</p></div>; }