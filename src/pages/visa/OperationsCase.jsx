import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Send, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { opsGetCase, opsPrepare, opsAssign, opsStartReview, opsRequestInfo, opsRequestDocument, opsFlagIssue, opsRejectPackage, opsReturn, opsEscalate, opsApprove, opsStartSubmission, opsConfirmSubmission, opsEnterTracking, opsHandleDecision, opsListPostPaymentReviews, opsStartVerifierReview, opsVerifierDecision, opsCeoDecision } from '@/lib/visaApi';

export default function OperationsCase() {
  const { caseId } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [assignee, setAssignee] = useState('');
  const [refs, setRefs] = useState({ government_reference: '', embassy_reference: '', courier_tracking_id: '', appointment_reference: '', notes: '' });
  const [track, setTrack] = useState({ raw_status: '', source: 'MANUAL', provider_key: 'visa_tracking_manual' });
  const [postReview, setPostReview] = useState(null);
  const [reviewReasonCode, setReviewReasonCode] = useState('');
  const [reviewReason, setReviewReason] = useState('');

  const load = async () => {
    try {
      const r = await opsGetCase(caseId);
      setData(r);
      const pr = await opsListPostPaymentReviews({ application_id: r?.case?.application_id }).catch(() => ({ reviews: [] }));
      setPostReview((pr?.reviews || [])[0] || null);
    } catch (e) { setErr(e?.message); }
  }; 
  useEffect(() => { if (user?.role === 'admin') load(); }, [user, caseId]);

  if (user?.role !== 'admin') return <div className="px-4 md:px-8 py-12 text-sm text-slate-500">Operations access required.</div>;
  if (!data && !err) return <div className="px-4 md:px-8 py-12 text-sm text-slate-500">Loading case…</div>;
  if (err && !data) return <div className="px-4 md:px-8 py-8"><p className="text-sm text-rose-600">{err}</p><Link to="/admin/operations" className="mt-2 inline-flex items-center gap-1 text-sm text-orange-700"><ArrowLeft size={14} /> Back</Link></div>;

  const c = data.case;
  const app = data.application;
  const act = (fn, ...args) => { setBusy(true); fn(...args).then(load).catch((e) => setErr(e?.message)).finally(() => setBusy(false)); };

  return (
    <div className="px-4 md:px-8 pb-24">
      <Link to="/admin/operations" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Operations queue</Link>
      <div className="mt-3 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-950">APP-{String(c.application_id).slice(-6).toUpperCase()} · {c.destination} <span className="capitalize text-slate-500">{c.purpose}</span></h1>
            <p className="text-sm text-slate-500">State: {c.state} · Review: {c.review_state} · Method: {c.submission_method || '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <RiskBadge score={c.quality_score} level={c.risk_level} />
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.qc_status === 'PASS' ? 'bg-orange-100 text-orange-700' : c.qc_status === 'WARNING' ? 'bg-amber-100 text-amber-700' : c.qc_status === 'BLOCKER' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>QC {c.qc_status}</span>
            <button onClick={() => act(opsPrepare, c.application_id)} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Re-run QC</button>
          </div>
        </div>
      </div>

      {/* Krosz locked post-payment review gate */}
      <div className="mt-4 rounded-[24px] border border-orange-200 bg-orange-50/50 p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Visa Approver Manager · post-payment gate</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">Krosz takes payment only after digital quality ≥90 with zero blockers. Human review happens after payment and must pass before managed submission.</p>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-orange-800">{postReview?.status || 'WAITING_FOR_PAYMENT'}</span>
        </div>
        {postReview ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label="Digital score" value={`${postReview.digital_quality_score ?? '—'}/100`} />
              <MiniStat label="Digital blockers" value={postReview.digital_blocking_count ?? '—'} />
              <MiniStat label="CEO status" value={postReview.ceo_status || 'NOT_REQUIRED'} />
              <MiniStat label="Refund due" value={postReview.refund_due_at ? new Date(postReview.refund_due_at).toLocaleString() : '—'} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => act(opsStartVerifierReview, postReview.id)} disabled={busy || !['PENDING_VERIFIER','IN_VERIFIER_REVIEW'].includes(postReview.status)} className="rounded-lg border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-800 disabled:opacity-40">Start Visa Approver review</button>
              <button onClick={() => act(opsVerifierDecision, postReview.id, 'APPROVE', 'APPROVED', reviewReason || 'Approved for managed submission')} disabled={busy || !['PENDING_VERIFIER','IN_VERIFIER_REVIEW'].includes(postReview.status)} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Approve for submission</button>
              <button onClick={() => reviewReasonCode && reviewReason && act(opsVerifierDecision, postReview.id, 'NOT_DOABLE', reviewReasonCode, reviewReason)} disabled={busy || !reviewReasonCode || !reviewReason || !['PENDING_VERIFIER','IN_VERIFIER_REVIEW'].includes(postReview.status)} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-40">Mark not doable → CEO</button>
              {postReview.status === 'NOT_DOABLE_PENDING_CEO' && <button onClick={() => act(opsCeoDecision, postReview.id, true, reviewReason || 'CEO approved eligible refund')} disabled={busy} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">CEO approve refund</button>}
              {postReview.status === 'NOT_DOABLE_PENDING_CEO' && <button onClick={() => act(opsCeoDecision, postReview.id, false, reviewReason || 'CEO declined refund')} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">CEO decline</button>}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input value={reviewReasonCode} onChange={(e) => setReviewReasonCode(e.target.value)} placeholder="reason code (required if not doable)" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" />
              <textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="Verifier / CEO reason" rows={2} className="sm:col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            {postReview.verifier_reason && <p className="mt-2 text-xs text-slate-600"><span className="font-semibold">Verifier reason:</span> {postReview.verifier_reason_code} · {postReview.verifier_reason}</p>}
            {postReview.refund_id && <p className="mt-2 text-xs text-slate-600">Refund: {postReview.refund_id} · {postReview.status === 'REFUNDED' ? 'completed' : 'processing/attention required'}</p>}
          </>
        ) : <p className="mt-3 text-xs text-slate-500">No post-payment review exists yet. It is created automatically after payment succeeds.</p>}
      </div>

      {/* Reviewer actions (§11) */}
      <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
        <h3 className="text-sm font-semibold text-slate-900">Reviewer actions</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="assignee user id" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
          <button onClick={() => assignee && act(opsAssign, caseId, assignee)} disabled={busy || !assignee} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Assign</button>
          <button onClick={() => act(opsStartReview, caseId)} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Start review</button>
          <button onClick={() => act(opsApprove, caseId)} disabled={busy} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700"><CheckCircle2 size={13} className="mr-1 inline" /> Approve for submission</button>
          <button onClick={() => reason && act(opsRequestInfo, caseId, reason)} disabled={busy || !reason} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Request info</button>
          <button onClick={() => reason && act(opsRequestDocument, caseId, reason)} disabled={busy || !reason} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Request document</button>
          <button onClick={() => reason && act(opsFlagIssue, caseId, reason)} disabled={busy || !reason} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50"><AlertTriangle size={13} className="mr-1 inline" /> Flag</button>
          <button onClick={() => reason && act(opsRejectPackage, caseId, reason)} disabled={busy || !reason} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50">Reject package</button>
          <button onClick={() => reason && act(opsReturn, caseId, reason)} disabled={busy || !reason} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Return to applicant</button>
          <button onClick={() => reason && act(opsEscalate, caseId, reason)} disabled={busy || !reason} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700">Escalate</button>
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason / message to applicant (used by request-info, request-document, flag, reject, return, escalate)" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={2} />
      </div>

      {/* Manual submission workflow (§16) */}
      <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
        <h3 className="text-sm font-semibold text-slate-900">Manual submission</h3>
        <p className="text-[11px] text-slate-500">Open the external authority portal, submit the application, then enter the confirmation details. The system does NOT record submission until you confirm (§16).</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => act(opsStartSubmission, caseId)} disabled={busy || c.state !== 'READY_TO_SUBMIT'} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">Start submission</button>
          <span className="text-xs text-slate-400 self-center">then confirm:</span>
          <button onClick={() => act(opsConfirmSubmission, caseId, refs)} disabled={busy || !c.submission_id} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-40"><Send size={13} className="mr-1 inline" /> Confirm submission</button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <RefInput label="Government application ID" value={refs.government_reference} onChange={(v) => setRefs({ ...refs, government_reference: v })} />
          <RefInput label="Embassy reference" value={refs.embassy_reference} onChange={(v) => setRefs({ ...refs, embassy_reference: v })} />
          <RefInput label="Courier tracking ID" value={refs.courier_tracking_id} onChange={(v) => setRefs({ ...refs, courier_tracking_id: v })} />
          <RefInput label="Appointment reference" value={refs.appointment_reference} onChange={(v) => setRefs({ ...refs, appointment_reference: v })} />
          <RefInput label="Notes" value={refs.notes} onChange={(v) => setRefs({ ...refs, notes: v })} />
        </div>
      </div>

      {/* Tracking & decision (§19/§26) */}
      {c.submission_id && (
        <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
          <h3 className="text-sm font-semibold text-slate-900">Tracking & decision</h3>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Raw status (from authority)</span>
              <input value={track.raw_status} onChange={(e) => setTrack({ ...track, raw_status: e.target.value })} placeholder="e.g. Application under consideration" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Source</span>
              <select value={track.source} onChange={(e) => setTrack({ ...track, source: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option>MANUAL</option><option>GOVERNMENT_API</option><option>PORTAL</option><option>EMAIL</option><option>MOCK</option></select></label>
            <button onClick={() => track.raw_status && act(opsEnterTracking, caseId, track)} disabled={busy || !track.raw_status} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">Enter tracking update</button>
            <span className="text-xs text-slate-400 self-center">or record a decision:</span>
            <button onClick={() => act(opsHandleDecision, caseId, { decision: 'APPROVED' })} disabled={busy} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700">Approve</button>
            <button onClick={() => act(opsHandleDecision, caseId, { decision: 'REFUSED' })} disabled={busy} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700">Refuse</button>
            <button onClick={() => act(opsHandleDecision, caseId, { decision: 'NEEDS_REVIEW' })} disabled={busy} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50">Needs review</button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Normalized: {c.normalized_status || '—'} · Raw: {c.raw_status || '—'}{c.decision && ` · Decision: ${c.decision}`}</p>
          <div className="mt-3 divide-y divide-slate-100">
            {(data.tracking || []).map((ev) => (
              <div key={ev.id} className="flex items-center justify-between py-2 text-sm"><span className="text-slate-700"><span className="font-medium">{ev.normalized_status}</span> <span className="text-slate-400">· {ev.raw_status}</span></span><span className="text-xs text-slate-400">{new Date(ev.occurred_at).toLocaleString()}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* Checklist + audit + findings (§5/§33) */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
          <h3 className="text-sm font-semibold text-slate-900">Submission checklist</h3>
          <div className="mt-2 divide-y divide-slate-100">
            {(c.checklist || []).map((it) => (
              <div key={it.code} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-700">{it.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${it.status === 'PASS' ? 'bg-orange-100 text-orange-700' : it.status === 'WARNING' ? 'bg-amber-100 text-amber-700' : it.status === 'BLOCKER' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{it.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
          <h3 className="text-sm font-semibold text-slate-900">Audit trail</h3>
          <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-slate-100">
            {(data.audit || []).map((a) => (
              <div key={a.id} className="py-2 text-xs"><span className="font-medium text-slate-800">{a.action}</span> <span className="text-slate-400">{a.previous_state}→{a.new_state}</span>{a.reason && <span className="text-slate-500"> · {a.reason}</span>}<div className="text-slate-400">{a.actor_name} · {new Date(a.occurred_at).toLocaleString()}</div></div>
            ))}
          </div>
        </div>
      </div>

      {/* Sensitive data controls (§35): masked applicant context */}
      <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
        <h3 className="text-sm font-semibold text-slate-900">Application (masked <ShieldCheck size={12} className="inline" />)</h3>
        <p className="text-[11px] text-slate-500">Sensitive fields masked in the ops view (§35). Open the traveler workspace only when needed.</p>
        <p className="mt-2 text-sm text-slate-700">Destination {app?.destination} · Purpose {app?.purpose} · Visa {app?.visa_type_key} · Channel {app?.channel} · Status {app?.status}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to={`/applications/${c.application_id}/workspace`} className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:underline"><ExternalLink size={12} /> Open traveler workspace</Link>
          <Link to={`/applications/${c.application_id}`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:underline"><ExternalLink size={12} /> Application detail</Link>
        </div>
      </div>
      {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
    </div>
  );
}

function RiskBadge({ score, level }) {
  const tone = level === 'LOW' ? 'bg-orange-100 text-orange-700' : level === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : level === 'HIGH' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{score != null ? `${score}/100` : '—'} {level}</span>;
}
function MiniStat({ label, value }) {
  return <div className="rounded-xl border border-orange-100 bg-white p-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-0.5 break-words text-xs font-semibold text-slate-800">{String(value ?? '—')}</p></div>;
}
function RefInput({ label, value, onChange }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>;
}