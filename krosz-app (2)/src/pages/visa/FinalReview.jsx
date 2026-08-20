import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, ShieldCheck, ExternalLink, Lock } from 'lucide-react';
import { getFinalReview, startWorkspace, confirmApplicationApi, createOrder, createCheckout, reconcilePayment, retryPayment, getPaymentGate } from '@/lib/visaApi';
import PricingBreakdown from '@/components/visa/PricingBreakdown';
import PaymentFailureState from '@/components/visa/PaymentFailureState';

export default function FinalReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [fr, setFr] = useState(null);
  const [ws, setWs] = useState(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pay, setPay] = useState(null); // { status, order, payment, checkout_url, error }
  const [optional, setOptional] = useState([]);
  const [digitalGate, setDigitalGate] = useState(null);

  const load = () => Promise.all([getFinalReview(id), startWorkspace(id), getPaymentGate(id)])
    .then(([f, w, dg]) => { setFr(f); setWs(w); setDigitalGate(dg); })
    .catch((e) => setErr(e?.message || 'Failed to load review'));

  useEffect(() => { load(); }, [id]);

  const answersByCode = useMemo(() => { const m = {}; for (const a of ws?.answers || []) if (a.active !== false) m[a.question_code] = a; return m; }, [ws?.answers]);
  const sections = ws?.sections || [];
  const progress = ws?.progress;
  const gate = fr?.gate;
  const quote = fr?.quote;
  const ready = gate?.state === 'READY';
  const digitalPayReady = digitalGate?.allowed === true;

  const applicantName = [answersByCode['personal.given_names']?.value, answersByCode['personal.surname']?.value].filter(Boolean).join(' ') || '—';
  const passportRaw = answersByCode['passport.passport_number']?.value || '';
  const passportMasked = passportRaw ? `********${String(passportRaw).slice(-3)}` : '—';
  const dep = answersByCode['travel.departure_date']?.normalized_value || fr?.application?.travel_start || '';
  const ret = answersByCode['travel.return_date']?.normalized_value || fr?.application?.travel_end || '';
  const visaName = fr?.application?.rule_snapshot?.visa_option?.name || fr?.application?.visa_type_key || '—';
  const docsDone = progress?.documents?.verified || 0;
  const docsTotal = progress?.documents?.total || 0;

  const continueToPayment = async () => {
    if (!accept || !ready || !digitalPayReady) return;
    setBusy(true); setErr(''); setPay({ status: 'initiating' });
    try {
      await confirmApplicationApi(id);
      const orderRes = await createOrder(id, { optional_services: optional });
      const order = orderRes.order || orderRes;
      if (orderRes.no_payment || order.status === 'COMPLETED' || order.status === 'PAID') {
        navigate(`/orders/${order.id}/confirmation`);
        return;
      }
      const ck = await createCheckout(order.id);
      if (ck.already_paid) { navigate(`/orders/${order.id}/confirmation`); return; }
      setPay({ status: 'awaiting', order, payment: ck.payment, checkout_url: ck.checkout_url });
    } catch (e) {
      setPay({ status: 'failed', error: e?.message || 'Could not start payment' });
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (!pay?.payment) return;
    setBusy(true);
    try {
      const res = await reconcilePayment(pay.payment.id);
      const st = res?.status;
      if (st === 'succeeded') { navigate(`/orders/${pay.order.id}/confirmation`); return; }
      if (res?.payment?.status === 'FAILED') { setPay({ status: 'failed', error: 'Payment failed', order: pay.order, payment: res.payment }); return; }
      setPay({ ...pay, status: 'awaiting', pending: true });
    } catch (e) { setPay({ status: 'failed', error: e?.message, order: pay.order, payment: pay.payment }); }
    finally { setBusy(false); }
  };

  const retry = async () => {
    if (!pay?.order) return;
    setBusy(true); setPay({ status: 'initiating' });
    try {
      const ck = await retryPayment(pay.order.id);
      setPay({ status: 'awaiting', order: pay.order, payment: ck.payment, checkout_url: ck.checkout_url });
    } catch (e) { setPay({ status: 'failed', error: e?.message, order: pay.order }); }
    finally { setBusy(false); }
  };

  if (!fr && !err) return <div className="px-4 md:px-8 py-12 text-sm text-slate-500">Loading final review…</div>;

  return (
    <div className="px-4 md:px-8 pb-24">
      <Link to={`/applications/${id}/workspace`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Back to application</Link>

      {/* Summary header (§4) */}
      <div className="mt-3 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <h1 className="text-xl font-semibold text-slate-950">{fr.application.destination} · <span className="capitalize">{fr.application.purpose}</span> visa</h1>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Applicant" value={applicantName} />
          <Field label="Passport" value={passportMasked} />
          <Field label="Travel dates" value={`${dep || '—'} → ${ret || '—'}`} />
          <Field label="Visa type" value={visaName} />
          <Field label="Documents" value={`${docsDone} / ${docsTotal} complete`} />
          <Field label="Application" value={ready ? 'Ready' : gate?.state === 'NEEDS_REVIEW' ? 'Needs review' : 'Not ready'} tone={ready ? 'good' : 'warn'} />
        </div>
      </div>

      {/* Sections (§4) */}
      <div className="mt-6 space-y-3">
        {sections.map((s) => {
          const sp = progress?.sections?.find((x) => x.key === s.key) || { done: 0, total: s.questions.length, complete: false };
          return (
            <div key={s.key} className="flex items-center justify-between rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
              <div className="flex items-center gap-3">
                {sp.complete ? <CheckCircle2 size={18} className="text-orange-600" /> : <AlertTriangle size={18} className="text-amber-500" />}
                <div>
                  <p className="text-sm font-semibold text-slate-900">{s.label}</p>
                  <p className="text-[11px] text-slate-400">{sp.complete ? 'Complete' : `${sp.done}/${sp.total} required`}</p>
                </div>
              </div>
              <Link to={`/applications/${id}/workspace`} className="text-sm font-medium text-orange-700 hover:text-orange-800">Edit</Link>
            </div>
          );
        })}
        <div className={`rounded-2xl border p-4 ${digitalPayReady ? 'border-orange-200 bg-orange-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className={`text-sm font-semibold ${digitalPayReady ? 'text-orange-800' : 'text-amber-800'}`}>Digital Application Quality</p>
              <p className="mt-1 text-xs text-slate-600">Payment unlocks only when the score is at least 90/100 and there are zero blocking issues.</p>
            </div>
            <div className={`rounded-xl px-3 py-2 text-lg font-semibold ${digitalPayReady ? 'bg-white text-orange-700' : 'bg-white text-amber-700'}`}>{digitalGate?.score ?? '—'}/100</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className={`rounded-full px-2 py-1 ${Number(digitalGate?.score || 0) >= 90 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-800'}`}>Score ≥90 {Number(digitalGate?.score || 0) >= 90 ? '✓' : 'required'}</span>
            <span className={`rounded-full px-2 py-1 ${digitalGate?.zero_blockers ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700'}`}>Zero blockers {digitalGate?.zero_blockers ? '✓' : `${digitalGate?.blocker_count || 0} open`}</span>
          </div>
          {!digitalPayReady && digitalGate?.reasons?.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{digitalGate.reasons.slice(0, 6).map((r) => <li key={r.code}>{r.message}</li>)}</ul>}
        </div>
        {gate?.needs_review?.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800">{gate.needs_review_count} item(s) to review</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">{gate.needs_review.map((n) => <li key={n.code}>{n.title}: {n.description}</li>)}</ul>
          </div>
        )}
        {!ready && gate?.reasons?.length > 0 && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm font-semibold text-rose-800">Resolve before paying ({gate.blocking_count})</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-rose-700">{gate.reasons.slice(0, 8).map((r) => <li key={r.code}>{r.message}</li>)}</ul>
          </div>
        )}
      </div>

      {/* Pricing + confirmation (§5/§7) */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PricingBreakdown quote={quote} selectedOptional={optional} />
        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <div className="flex items-center gap-2 text-slate-900"><ShieldCheck size={16} className="text-orange-600" /><h3 className="text-base font-semibold">Final confirmation</h3></div>
          <p className="mt-2 text-sm text-slate-600">{gate?.declaration?.text}</p>
          <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50 p-3 text-xs leading-5 text-orange-900">
            <p className="font-semibold">What happens after payment</p>
            <p>Once payment is confirmed, a Krosz Visa Approver Manager performs the final human verification. Approved applications move to our managed submission queue. In the rare case we determine we cannot proceed before government submission, the not-doable exception is escalated for CEO approval and the pre-submission full refund is initiated automatically and processed within 24 hours after approval.</p>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-orange-600" />
            <span>I confirm</span>
          </label>
          {pay?.status === 'failed'
            ? <div className="mt-4"><PaymentFailureState error={pay.error} onRetry={retry} onReturn={() => navigate(`/applications/${id}`)} /></div>
            : pay?.status === 'awaiting'
              ? <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-800">Complete your payment</p>
                  {pay.checkout_url && <a href={pay.checkout_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"><ExternalLink size={13} /> Open payment page</a>}
                  <button onClick={verify} disabled={busy} className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} I've completed payment</button>
                  {pay.pending && <p className="mt-2 text-[11px] text-amber-600">Still verifying with the provider — press again if needed.</p>}
                </div>
              : <button onClick={continueToPayment} disabled={!accept || !ready || !digitalPayReady || busy} className="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Continue to payment</button>}
          <p className="mt-3 text-[11px] text-slate-400">Payment is accepted only after the digital quality gate passes. Payment does not mean the visa has been submitted or approved; submission happens only after the Visa Approver Manager clears the case.</p>
        </div>
      </div>
      {err && <p className="mt-4 text-sm text-rose-600">{err}</p>}
    </div>
  );
}

function Field({ label, value, tone = '' }) {
  return <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-0.5 text-sm font-medium ${tone === 'good' ? 'text-orange-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</p></div>;
}