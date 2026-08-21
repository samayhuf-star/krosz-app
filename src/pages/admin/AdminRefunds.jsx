import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, CheckCircle2, XCircle, FileText, Gavel } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { adminListRefunds, adminReviewRefund, adminRejectRefund, adminEvidencePack } from '@/lib/refundApi';
import { base44 } from '@/api/base44Client';

const STATUS_TONE = {
  REQUESTED: 'bg-amber-50 text-amber-700', UNDER_REVIEW: 'bg-blue-50 text-blue-700', APPROVED: 'bg-emerald-50 text-emerald-700',
  PROCESSING: 'bg-blue-50 text-blue-700', COMPLETED: 'bg-emerald-50 text-emerald-700', FAILED: 'bg-rose-50 text-rose-700', REJECTED: 'bg-slate-100 text-slate-600',
};
const EL_TONE = { POTENTIALLY_ELIGIBLE: 'bg-emerald-50 text-emerald-700', REQUIRES_HUMAN_REVIEW: 'bg-amber-50 text-amber-700', NOT_ELIGIBLE: 'bg-rose-50 text-rose-700' };
const fmtMoney = (m, c) => `${(Number(m || 0) / 100).toFixed(2)} ${c || ''}`;

export default function AdminRefunds() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [pack, setPack] = useState(null);
  const [packFor, setPackFor] = useState(null);
  const [rejectId, setRejectId] = useState(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  const load = () => { setLoading(true); adminListRefunds().then((r) => setRows(r.refunds || [])).catch((e) => setErr(e?.message)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const run = async (fn, id, label) => { setBusy(`${label}:${id}`); setErr(''); try { await fn(); load(); } catch (e) { setErr(e?.message || `Could not ${label}`); } finally { setBusy(''); } };
  const approve = (id) => run(() => base44.functions.invoke('visaApi', { action: 'approve-refund', refund_id: id }).then((r) => r.data ?? r), id, 'approve');
  const execute = (id) => run(() => base44.functions.invoke('visaApi', { action: 'execute-refund', refund_id: id }).then((r) => r.data ?? r), id, 'execute');
  const review = (id) => run(() => adminReviewRefund(id), id, 'review');
  const reject = (id, rsn) => run(() => adminRejectRefund(id, rsn), id, 'reject');
  const evidence = async (id, orderId) => { setPackFor(id); setPack(null); try { const r = await adminEvidencePack({ refund_id: id, order_id: orderId }); setPack(r.pack); } catch (e) { setErr(e?.message); } };

  return (
    <div>
      <PageHeader eyebrow="Trust & Compliance" title="Refunds" description="Review refund requests with the deterministic eligibility triage. A human always approves — nothing is auto-refunded. Evidence packs are read-only." />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        {err && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">No refund requests yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="p-3 font-medium">Refund</th><th className="p-3 font-medium">Order</th><th className="p-3 font-medium">Amount</th><th className="p-3 font-medium">Reason</th><th className="p-3 font-medium">Eligibility</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Stage / submission</th><th className="p-3 font-medium">Policy</th><th className="p-3 text-right font-medium">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="p-3"><p className="font-medium text-slate-900">{r.id.slice(-8)}</p><p className="text-[11px] text-slate-400">{new Date(r.created_date).toLocaleString()}</p>{r.reviewer && <p className="text-[11px] text-slate-400">by {r.reviewer}</p>}</td>
                    <td className="p-3 text-slate-700">{r.order_number || '—'}{r.application_destination ? <span className="block text-[11px] text-slate-400">{r.application_destination} · {r.application_case_state || '—'}</span> : null}</td>
                    <td className="p-3 text-slate-800">{fmtMoney(r.amount_minor, r.currency)}<p className="text-[11px] text-slate-400">of {fmtMoney(r.total_minor, r.currency)}</p></td>
                    <td className="p-3 text-slate-700">{(r.reason || '').replace(/_/g, ' ').toLowerCase()}<p className="text-[11px] text-slate-400 line-clamp-2">{r.reason_detail || r.eligibility_notes || ''}</p></td>
                    <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${EL_TONE[r.eligibility] || 'bg-slate-100 text-slate-600'}`}>{(r.eligibility || '—').replace(/_/g, ' ')}</span></td>
                    <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status] || 'bg-slate-100 text-slate-600'}`}>{r.status.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className="p-3 text-[11px] text-slate-500">{r.application_stage || '—'}<br />{r.submission_status || '—'}</td>
                    <td className="p-3 text-[11px] text-slate-500">{r.policy_version || '—'}</td>
                    <td className="p-3 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.status === 'REQUESTED' && <button disabled={busy === `review:${r.id}`} onClick={() => review(r.id)} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-200">Review</button>}
                        {(r.status === 'REQUESTED' || r.status === 'UNDER_REVIEW') && r.eligibility !== 'NOT_ELIGIBLE' && <button disabled={busy === `approve:${r.id}`} onClick={() => approve(r.id)} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700">Approve</button>}
                        {r.status === 'APPROVED' && <button disabled={busy === `execute:${r.id}`} onClick={() => execute(r.id)} className="rounded bg-[#003580] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#00225A]">Execute</button>}
                        {(r.status === 'REQUESTED' || r.status === 'UNDER_REVIEW') && <button onClick={() => { setRejectId(r.id); setReason(''); }} className="rounded bg-rose-100 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-200">Reject</button>}
                        <button onClick={() => evidence(r.id, rows.find((x) => x.id === r.id)?.order_id)} className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">Evidence</button>
                      </div>
                      {busy.startsWith(`:${r.id}`) && <Loader2 size={12} className="mt-1 ml-auto animate-spin text-slate-400" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rejectId && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
            <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950"><Gavel size={16} /> Reject refund</h3>
              <p className="mt-1 text-xs text-slate-500">No money is moved. The customer is emailed and the order returns to its paid state.</p>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for rejection (shown to the customer)" className="mt-3 w-full rounded-lg border border-slate-200 p-2 text-sm" />
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setRejectId(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Cancel</button>
                <button onClick={() => { reject(rejectId, reason); setRejectId(null); }} disabled={!reason.trim()} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">Confirm rejection</button>
              </div>
            </div>
          </div>
        )}

        {packFor && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
            <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
              <div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-base font-semibold text-slate-950"><FileText size={16} /> Evidence pack</h3><button onClick={() => setPackFor(null)} className="text-slate-400 hover:text-slate-700">Close</button></div>
              {pack ? (
                <div className="space-y-3 text-xs">
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">Read-only. Assembled from existing immutable records — nothing fabricated or modified.</p>
                  <Row label="Order" value={`${pack.order?.order_number || '—'} · ${pack.order?.status || '—'}`} />
                  <Row label="Order total" value={fmtMoney(pack.order?.total_minor, pack.order?.currency)} />
                  <Row label="Terms version" value={pack.terms_version || '—'} />
                  <Row label="Refund policy version" value={pack.refund_policy_version || '—'} />
                  <Row label="Application" value={pack.application ? `${pack.application.destination} · ${pack.application.case_state || pack.application.status}` : '—'} />
                  <Section title="Confirmations">{(pack.confirmations || []).length ? pack.confirmations.map((c, i) => <li key={i}>v{c.application_version} · accepted {new Date(c.accepted_at).toLocaleString()}{c.terms_version ? ` · terms ${c.terms_version}` : ''}</li>) : <li>None recorded.</li>}</Section>
                  <Section title="Payments">{(pack.payments || []).length ? pack.payments.map((p, i) => <li key={i}>{p.status} · {fmtMoney(p.amount_minor, pack.order?.currency)} · {p.provider_key} · {new Date(p.created_date).toLocaleString()}</li>) : <li>None.</li>}</Section>
                  <Section title="Refunds">{(pack.refunds || []).length ? pack.refunds.map((r, i) => <li key={i}>{r.status} · {fmtMoney(r.amount_minor, pack.order?.currency)} · {r.reason} · eligibility {r.eligibility}{r.reviewer ? ` · by ${r.reviewer}` : ''}</li>) : <li>None.</li>}</Section>
                  <Section title="Timeline">{(pack.timeline || []).length ? pack.timeline.map((t, i) => <li key={i}>{t.event_type} · {new Date(t.created_date).toLocaleString()} · {t.actor_type}</li>) : <li>None.</li>}</Section>
                  <Section title="Support">{(pack.support || []).length ? pack.support.map((t, i) => <li key={i}>{t.ticket_number} · {t.category} · {t.status}</li>) : <li>None.</li>}</Section>
                </div>
              ) : <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) { return <div className="flex items-center justify-between border-b border-slate-100 py-1.5"><span className="text-slate-400">{label}</span><span className="font-medium text-slate-800">{value}</span></div>; }
function Section({ title, children }) { return <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p><ul className="mt-1 space-y-0.5 text-slate-600">{children}</ul></div>; }