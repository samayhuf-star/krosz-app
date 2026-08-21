import { ShieldCheck, CheckCircle2, X, Lock } from 'lucide-react';

export default function ApprovalsPanel({ plan, tasks, onApprove, onReject, runTask }) {
  const gates = tasks.filter((t) => t.status === 'awaiting_approval' || t.status === 'rejected');
  if (!gates.length) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
      <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={32} />
      <h3 className="text-lg font-semibold text-slate-900">No approvals needed right now</h3>
      <p className="mx-auto mt-1 max-w-md text-slate-500">The assistant will pause here whenever an action requires your sign-off — domain purchase, publishing website, SEO and CRM.</p>
    </div>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Some steps require your explicit approval before the assistant continues. Review and decide.</p>
      {gates.map((t) => (
        <div key={t.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-amber-100 text-amber-700"><ShieldCheck size={18} /></div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-900">{t.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t.status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{t.status === 'rejected' ? 'Rejected' : 'Awaiting approval'}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500"><Lock size={10} /> {t.module_label}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">Approving lets the assistant run this step. Rejecting halts the workflow here — you can skip or retry from the Timeline.</p>
              {t.step_id === 'domain_purchase' && t.result == null && <p className="mt-1 text-[11px] text-slate-400">Recommended domain will be selected from the search results.</p>}
            </div>
            <div className="flex flex-none gap-2">
              <button onClick={() => onApprove(t)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"><CheckCircle2 size={14} /> Approve</button>
              <button onClick={() => onReject(t)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><X size={14} /> Reject</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}