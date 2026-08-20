import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, RefreshCw, FilePlus, Loader2 } from 'lucide-react';
import { adminDocumentDecision } from '@/lib/adminCaseApi';
import { useToast } from '@/components/ui/use-toast';

export default function SecDocuments({ d, reload, caseId }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');
  const reqs = cv => cv?.snapshot?.document_requirements || [];
  const required = reqs(d.case_view);
  const docs = d.documents || [];
  const act = async (docId, decision, reason) => {
    setBusy(docId + decision);
    try { await adminDocumentDecision({ document_id: docId, decision, reason }); toast({ title: `Document ${decision}` }); reload(); }
    catch (e) { toast({ title: 'Failed', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Required documents (snapshot)</h3>
        {required.length === 0 ? <p className="mt-2 text-sm text-slate-400">No required documents in the snapshot.</p> : <ul className="mt-2 space-y-1">{required.map((r) => <li key={r.code} className="text-sm text-slate-700">{r.label || r.code} <span className="text-[10px] text-slate-400">{r.mandatory ? '· required' : '· optional'}</span></li>)}</ul>}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Uploaded documents</h3>
        {docs.length === 0 ? <p className="mt-2 text-sm text-slate-400">None uploaded yet.</p> : (
          <ul className="mt-2 divide-y divide-slate-100">
            {docs.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div><p className="text-sm font-medium text-slate-800">{doc.document_type}</p><p className="text-[11px] text-slate-400">status: {doc.status} · {doc.verified_at ? `verified ${new Date(doc.verified_at).toLocaleDateString()}` : 'not verified'}</p></div>
                <div className="flex flex-wrap gap-1.5">
                  <Btn icon={CheckCircle2} label="Approve" disabled={busy === doc.id + 'approved'} onClick={() => act(doc.id, 'approved')} />
                  <Btn icon={XCircle} label="Reject" tone="rose" disabled={busy === doc.id + 'rejected'} onClick={() => act(doc.id, 'rejected', 'Rejected by reviewer')} />
                  <Btn icon={RefreshCw} label="Replace" tone="amber" disabled={busy === doc.id + 'replacement_requested'} onClick={() => act(doc.id, 'replacement_requested', 'Replacement requested')} />
                  <Btn icon={FilePlus} label="Request more" disabled={busy === doc.id + 'request_additional'} onClick={() => act(doc.id, 'request_additional', 'Additional document requested')} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-slate-400">Each decision creates an auditable event and a timeline entry. Documents live in the existing document store — no second store is created.</p>
    </div>
  );
}
function Btn({ icon: Icon, label, onClick, disabled, tone = '' }) {
  const c = { rose: 'text-rose-700 hover:bg-rose-50', amber: 'text-amber-700 hover:bg-amber-50' }[tone] || 'text-emerald-700 hover:bg-emerald-50';
  return <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs ${c} disabled:opacity-50`}>{disabled ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />} {label}</button>;
}