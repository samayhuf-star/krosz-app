import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UploadCloud, Link2, Loader2, CheckCircle2, AlertCircle, ExternalLink, Info } from 'lucide-react';
import { accountListTravelers, listApplicationDocuments, createDocument, attachDocument, uploadPrivateDocument, createOrder, createCheckout, getPaymentGate, evaluateMvpEngine, recordDocumentEngineResult, checkReadiness } from '@/lib/visaApi';
import { base44 } from '@/api/base44Client';
import PassportAutopilot from '@/components/wizard/PassportAutopilot';
import { inspectVisaPhoto } from '@/lib/visaPhoto';

const fmtMinor = (m, c) => (m ? `${(c || '')} ${(Number(m) / 100).toFixed(2)}`.trim() : '—');

// ---- Step 1: Travel ----
export function StepTravel({ form, setForm, ctx, caseRow, onPassportReady }) {
  const t = form.travel || {};
  const set = (k, v) => setForm({ ...form, travel: { ...t, [k]: v } });
  return (
    <Section title="Upload / Import" desc="Start with your passport. We’ll read the details so you can review and confirm them before continuing.">
      <PassportAutopilot caseRow={caseRow} ctx={ctx} form={form} setForm={setForm} onReadyChange={onPassportReady} />
      <div className="mt-5">
        <NumField label="Travellers" value={t.travelers || 1} min={1} onChange={(v) => set('travelers', v)} />
      </div>
    </Section>
  );
}

// ---- Step 2: Traveler ----
export function StepTraveler({ form, setForm, snapshot }) {
  const { data } = useQuery({ queryKey: ['wizard-travelers'], queryFn: () => accountListTravelers().catch(() => ({ travelers: [] })) });
  const list = data?.travelers || [];
  const sel = form.traveler_id || list.find((x) => x.is_primary)?.id || '';
  return (
    <Section title="Who is this application for?" desc="Choose the traveller this visa is for. You can add more travellers in the Travellers page.">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {list.length === 0 && <p className="text-sm text-slate-500">No travellers yet — you can continue and add details later.</p>}
        {list.map((t) => (
          <button key={t.id} onClick={() => setForm({ ...form, traveler_id: t.id })}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left ${sel === t.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <span className="text-sm font-medium text-slate-800">{t.first_name} {t.last_name || ''}</span>
            {t.is_primary && <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">Primary</span>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-400">Passport: {snapshot?.nationality || 'IN'} · Destination: {snapshot?.country}</p>
    </Section>
  );
}

// ---- Step 3: Journey ----
export function StepJourney({ ctx }) {
  const s = ctx.case_view?.snapshot || {};
  return (
    <Section title="Your visa journey" desc="Resolved from the verified Travel Entry Engine — not invented.">
      <Row label="Destination" value={s.country} />
      <Row label="Journey type" value={s.journey} />
      <Row label="Verification status" value={s.verification_status} />
      <Row label="Data confidence" value={s.confidence} />
      {s.official_source?.url && <a href={s.official_source.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"><ExternalLink size={14} /> Official source</a>}
    </Section>
  );
}

// ---- Step 4: Eligibility ----
export function StepEligibility({ ctx }) {
  const el = ctx.eligibility;
  const map = { eligible: ['emerald', 'You appear eligible based on the verified destination rule.'], ineligible: ['rose', 'You do not appear eligible.'], unknown: ['amber', 'Eligibility requires further verification — we cannot confirm it yet.'], requires_review: ['amber', 'Eligibility needs a manual review.'] };
  const [tone, msg] = map[el] || map.unknown;
  return (
    <Section title="Eligibility" desc="Based on the resolved Travel Entry snapshot.">
      <div className={`rounded-xl border p-4 text-sm ${tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        <p className="flex items-center gap-2"><Info size={16} /> {msg}</p>
      </div>
      <p className="mt-3 text-xs text-slate-400">We never claim eligibility when the engine result is unknown.</p>
    </Section>
  );
}

// ---- Step 5: Requirements ----
export function StepRequirements({ ctx }) {
  const s = ctx.case_view?.snapshot || {};
  const conds = s.requirements || [];
  return (
    <Section title="Requirements" desc="From the resolved destination snapshot.">
      {conds.length === 0 ? <Empty /> : (
        <ul className="space-y-2">
          {conds.map((c, i) => (
            <li key={i} className="flex items-start justify-between rounded-lg border border-slate-200 p-3">
              <span className="text-sm text-slate-700">{c.label || c.code}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${c.required ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{c.required ? 'Required' : 'Note'}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- Step 6: Traveler info ----
export function StepTravelerInfo({ form, setForm }) {
  const t = { ...form.traveler_info };
  const set = (k, v) => setForm({ ...form, traveler_info: { ...t, [k]: v } });
  return (
    <Section title="Your details" desc="These populate the government form preview. They are saved to your case, not auto-submitted anywhere.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="First name" value={t.first_name || ''} onChange={(v) => set('first_name', v)} />
        <TextField label="Last name" value={t.last_name || ''} onChange={(v) => set('last_name', v)} />
        <DateField label="Date of birth" value={t.dob || ''} onChange={(v) => set('dob', v)} />
        <TextField label="Passport number" value={t.passport_number || ''} onChange={(v) => set('passport_number', v)} />
      </div>
    </Section>
  );
}

// ---- Step 6b: Material details (employment + income) ----
export function StepMaterialDetails({ form, setForm }) {
  const d = form.details || {};
  const set = (k, v) => setForm({ ...form, details: { ...d, [k]: v } });
  return (
    <Section title="Your details" desc="A couple of details needed for the application form. The rest is collected later.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Employment status</span>
          <select value={d.employment_status || ''} onChange={(e) => set('employment_status', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500">
            <option value="">Select…</option>
            <option value="EMPLOYED">Employed</option>
            <option value="SELF_EMPLOYED">Self-employed</option>
            <option value="STUDENT">Student</option>
            <option value="UNEMPLOYED">Unemployed</option>
            <option value="RETIRED">Retired</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Annual income (₹)</span>
          <input type="number" min={0} value={d.annual_income || ''} onChange={(e) => set('annual_income', e.target.value)} placeholder="e.g. 600000" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
        </label>
      </div>
    </Section>
  );
}

// ---- Step 7: Documents ----
export function StepDocuments({ ctx, caseRow, onReadyChange }) {
  const reqs = ctx.required_docs || [];
  const qcKey = ['wizard-docs', caseRow?.id];
  const { data, refetch, isLoading } = useQuery({ queryKey: qcKey, queryFn: () => listApplicationDocuments(caseRow?.id).catch(() => ({ documents: [] })), enabled: !!caseRow?.id });
  // list-application-documents returns authoritative `attachments` +
  // requirement `progress`. Older UI expected `documents`, which made uploaded
  // files look missing even when the backend had them.
  const docs = data?.attachments || data?.documents || [];
  const progress = data?.progress || null;
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [photoCheck, setPhotoCheck] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [readinessError, setReadinessError] = useState('');
  const travelerId = ctx.case_view?.traveler_id;
  const photoPolicy = ctx.engine_policies?.photo || ctx.case_view?.snapshot?.photo_policy || {};
  const supportingPolicy = ctx.engine_policies?.supporting_visa || ctx.case_view?.snapshot?.supporting_visa_policy || {};

  const upload = async (req, file) => {
    if (!file) return;
    setBusy(req.code); setErr('');
    try {
      let engineResult = null;
      const docCode = String(req.code || '').toUpperCase();
      if (docCode === 'PHOTO') {
        const metrics = await inspectVisaPhoto(file);
        const hasVerifiedPolicy = photoPolicy && Object.keys(photoPolicy).length > 0 && photoPolicy.policy_version;
        if (hasVerifiedPolicy) {
          engineResult = await evaluateMvpEngine('photo_compliance', { metrics, policy: photoPolicy });
          setPhotoCheck(engineResult);
          if (engineResult?.status === 'BLOCKED') throw new Error(engineResult.checks?.find((x) => x.status === 'BLOCKING')?.customer_message || 'This photo does not meet the configured visa-photo requirements.');
        } else {
          engineResult = { status: 'NEEDS_REVIEW', checks: [{ check_id: 'PHOTO-POLICY', status: 'NEEDS_REVIEW', customer_message: 'Country-specific photo rules are not yet verified for this route. The photo will be uploaded for manual review.' }], data: { metrics } };
          setPhotoCheck(engineResult);
        }
      } else if ((docCode === 'PREVIOUS_VISA' || docCode === 'RESIDENCE_PERMIT') && supportingPolicy?.allowed_issuers?.length) {
        // The uploaded document is extracted by Document Intelligence first. The
        // supporting-visa engine is deliberately held for server/manual review
        // until issuer, holder and expiry extractions are available.
        engineResult = { status: 'NEEDS_REVIEW', checks: [{ check_id: 'SUP-PENDING-EXTRACTION', status: 'NEEDS_REVIEW', customer_message: 'We will verify the issuing country, holder name and validity after reading this supporting document.' }], data: { policy_version: supportingPolicy.policy_version || null } };
      }
      const fileUri = await uploadPrivateDocument(file);
      const created = await createDocument({ traveler_id: travelerId, document_type: String(req.code || '').toUpperCase(), display_name: file.name, storage_uri: fileUri, mime_type: file.type, file_size: file.size });
      const documentId = created?.document_id || created?.document?.id;
      const versionId = created?.version_id || created?.version?.id;
      if (documentId && versionId) await attachDocument({ application_id: caseRow.id, document_id: documentId, document_version_id: versionId });
      if (versionId && engineResult && docCode === 'PHOTO') {
        await recordDocumentEngineResult(versionId, 'photo_compliance', engineResult, caseRow.id);
      } else if (versionId && engineResult && (docCode === 'PREVIOUS_VISA' || docCode === 'RESIDENCE_PERMIT')) {
        await recordDocumentEngineResult(versionId, 'supporting_visa', engineResult, caseRow.id);
      }
      await refetch();
      base44.analytics?.track?.({ eventName: 'DOCUMENT_UPLOADED', properties: { case_id: caseRow.id, doc: req.code } });
    } catch (e) { setErr(e?.message || 'Upload failed'); }
    finally { setBusy(''); }
  };

  useEffect(() => {
    if (!caseRow?.id) return;
    // Gate "Continue" on the SAME deterministic readiness the confirmation step
    // uses, so the customer can never reach Review with a backend that would
    // reject. progress changes (upload completes / refetch) re-run this.
    let cancelled = false;
    setReadinessError('');
    checkReadiness(caseRow.id)
      .then((r) => {
        if (cancelled) return;
        setReadiness(r);
        onReadyChange?.(r?.ready === true);
      })
      .catch((e) => {
        if (cancelled) return;
        // Fail closed: if we can't verify readiness, never leave "Continue"
        // enabled on a stale/previous true value.
        setReadiness(null);
        setReadinessError(e?.message || 'Could not check whether your documents are ready. Please try again.');
        onReadyChange?.(false);
      });
    return () => { cancelled = true; };
  }, [progress, caseRow?.id, onReadyChange]);

  const statusFor = (code) => {
    const key = String(code || '').toUpperCase();
    const item = (progress?.items || []).find((i) =>
      String(i.document_type || '').toUpperCase() === key ||
      (i.document_types || []).some((t) => String(t).toUpperCase() === key) ||
      String(i.requirement_id || '') === String(code || '')
    );
    if (item?.state === 'verified') return 'verified';
    if (item?.state === 'needs_review') return 'needs_review';
    if (item?.state === 'processing') return 'processing';
    if (item?.state === 'uploaded') return 'pending_review';
    const attached = docs.find((d) => String(d.document_type || d.type || '').toUpperCase() === key);
    return attached ? 'pending_review' : 'not_started';
  };

  return (
    <Section title="Documents" desc="Upload each required document. Upload alone does not mean accepted — each is reviewed against the destination rule.">
      {reqs.length === 0 ? <Empty /> : (
        <ul className="space-y-3">
          {reqs.map((d) => {
            const st = statusFor(d.code);
            return (
              <li key={d.code} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{d.label}</p>
                    <p className="text-xs text-slate-400">{d.mandatory ? 'Required' : 'Optional'}</p>
                  </div>
                  <DocStatus status={st} />
                </div>
                <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800">
                  {busy === d.code ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                  {docs.find((x) => String(x.document_type || x.type || '').toUpperCase() === String(d.code || '').toUpperCase()) ? 'Replace' : 'Upload'}
                  <input type="file" className="sr-only" onChange={(e) => upload(d, e.target.files?.[0])} />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {photoCheck && <div className={`mt-3 rounded-lg p-3 text-xs ${photoCheck.status === 'BLOCKED' ? 'bg-rose-50 text-rose-700' : photoCheck.status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
        <p className="font-semibold">Photo check: {String(photoCheck.status || '').replaceAll('_', ' ')}</p>
        {(photoCheck.checks || []).filter((x) => x.status !== 'PASS').slice(0, 4).map((x) => <p key={x.check_id} className="mt-1">{x.customer_message}</p>)}
      </div>}
      {readiness && !readiness.ready && readiness.blocking_items?.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">Still needed before you can continue:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {readiness.blocking_items.slice(0, 6).map((b, i) => <li key={`${b.code}-${i}`}>{b.message || b.code}</li>)}
          </ul>
        </div>
      )}
      {readinessError && <p className="mt-2 text-xs text-rose-600">{readinessError}</p>}
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      {isLoading && <p className="mt-2 text-xs text-slate-400"><Loader2 size={12} className="inline animate-spin" /> Loading documents…</p>}
    </Section>
  );
}

// ---- Step 8: Review ----
export function StepReview({ ctx, caseRow, form, confirmed, setConfirmed, onReadyChange }) {
  const s = ctx.case_view?.snapshot || {};
  const fee = ctx.fee || {};
  const submitCapable = ctx.requires_submission_step && ctx.submission_allowed;
  const [readiness, setReadiness] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!caseRow?.id) { setChecking(false); return; }
    // Re-verify with the SAME deterministic gate the backend uses to accept
    // confirmation, and do it up front — not only after a failed Submit click.
    // Without this, a traveler could reach Review with something still missing
    // and only find out generically after committing to Submit.
    let cancelled = false;
    setChecking(true);
    checkReadiness(caseRow.id)
      .then((r) => {
        if (cancelled) return;
        setReadiness(r);
        onReadyChange?.(r?.ready === true);
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed on an unknown result — never default to "ready".
        setReadiness(null);
        onReadyChange?.(false);
      })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [caseRow?.id, onReadyChange]);

  return (
    <Section title="Review your application" desc="Please review everything before continuing.">
      <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <Row label="Destination" value={s.country} />
        <Row label="Journey" value={s.journey} />
        <Row label="Nationality" value={s.nationality} />
        <Row label="Eligibility" value={ctx.eligibility} />
        <Row label="Required documents" value={`${(ctx.required_docs || []).length} item(s)`} />
        {fee.available && (
          <>
            <Row label="Government fee" value={fmtMinor(fee.government_minor, fee.currency)} />
            {!!fee.provider_minor && <Row label="Provider fee" value={fmtMinor(fee.provider_minor, fee.currency)} />}
            <Row label="Krosz service fee" value={fmtMinor(fee.service_minor, fee.currency)} />
            <div className="mt-1 border-t border-slate-200 pt-1"><Row label="Total" value={fmtMinor(fee.total_minor, fee.currency)} /></div>
          </>
        )}
      </div>

      {checking && <p className="mt-3 text-xs text-slate-400"><Loader2 size={12} className="inline animate-spin" /> Checking that everything required is in place…</p>}
      {!checking && readiness && !readiness.ready && readiness.blocking_items?.length > 0 && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <p className="font-semibold">Not ready to submit yet:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {readiness.blocking_items.slice(0, 6).map((b, i) => <li key={`${b.code}-${i}`}>{b.message || b.code}</li>)}
          </ul>
        </div>
      )}

      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600" />
        <span>I confirm that the information and documents provided are accurate.</span>
      </label>

      {submitCapable && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">A verified automated submission is available for this journey.</p>}
    </Section>
  );
}

// ---- Step 9: Payment ----
export function StepPayment({ ctx, caseRow }) {
  const fee = ctx.fee || {};
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [gate, setGate] = useState(null);
  if (!fee.available) return <Section title="Payment"><p className="text-sm text-amber-700">Fee currently unavailable. You can continue — payment will be collected later if required.</p></Section>;
  const pay = async () => {
    setBusy(true); setErr('');
    try {
      const dg = await getPaymentGate(caseRow.id);
      setGate(dg);
      if (!dg?.allowed) { setErr(`Payment unlocks at 90/100 with zero blockers. Current score: ${dg?.score ?? '—'}/100.`); return; }
      const order = await createOrder(caseRow.id).catch(() => null);
      if (order?.order?.id) { await createCheckout(order.order.id); setDone(true); base44.analytics?.track?.({ eventName: 'PAYMENT_STARTED', properties: { case_id: caseRow.id, digital_quality_score: dg.score } }); }
      else setErr('Could not start payment. Try again later.');
    } catch (e) { setErr(e?.message || 'Payment failed'); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Payment" desc="Krosz accepts payment only after digital verification reaches 90/100 or higher with zero blocking issues.">
      <div className="space-y-1 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
        <Row label="Government fee" value={fmtMinor(fee.government_minor, fee.currency)} />
        {!!fee.provider_minor && <Row label="Provider fee" value={fmtMinor(fee.provider_minor, fee.currency)} />}
        {!!fee.service_minor && <Row label="Service fee" value={fmtMinor(fee.service_minor, fee.currency)} />}
        <div className="mt-2 border-t border-slate-100 pt-2"><Row label="Total" value={fmtMinor(fee.total_minor, fee.currency)} /></div>
      </div>
      {gate && <div className={`mt-3 rounded-lg p-3 text-xs ${gate.allowed ? 'bg-orange-50 text-orange-800' : 'bg-amber-50 text-amber-800'}`}><span className="font-semibold">Digital Application Quality: {gate.score}/100.</span> Zero blockers: {gate.zero_blockers ? 'Yes' : 'No'}.</div>}
      <p className="mt-3 text-xs leading-5 text-slate-500">After successful payment, a Krosz Visa Approver Manager performs the final human review before your case can enter managed submission. If we exceptionally cannot proceed before government submission, the case goes to CEO review for the eligible refund process.</p>
      {done ? <p className="mt-3 flex items-center gap-2 text-sm text-orange-700"><CheckCircle2 size={16} /> Payment initiated. After confirmation, your application enters Visa Approver Manager review.</p>
        : <button onClick={pay} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Wallet />} Pay {fmtMinor(fee.total_minor, fee.currency)}</button>}
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </Section>
  );
}

// ---- Step 10: Submission ----
export function StepSubmission({ ctx }) {
  const managed = ctx.requires_submission_step && ctx.submission_allowed;
  if (!ctx.requires_submission_step || !managed) {
    return (
      <Section title="Submission route" desc="This destination is not currently in Krosz managed-submission coverage.">
        <p className="text-sm text-slate-700">We can prepare and verify your application, but this route still requires the applicant to continue on the official authority channel.</p>
        {ctx.case_view?.snapshot?.official_source?.url && <a href={ctx.case_view.snapshot.official_source.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Link2 size={14} /> Open official portal</a>}
      </Section>
    );
  }
  return (
    <Section title="Krosz managed submission" desc="You do not need to submit the application yourself.">
      <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
        <p className="font-semibold">Visa Approver Manager review comes first.</p>
        <p className="mt-1 text-xs leading-5">After payment is confirmed, our Visa Approver Manager completes the final human verification. Once approved, the Krosz operations team submits your application through the configured official channel and updates your Krosz tracking timeline.</p>
      </div>
    </Section>
  );
}

// ---- Step 11: Confirmation ----
export function StepConfirmation({ ctx, form }) {
  const na = ctx.next_action || {};
  const ec = ctx.case_view?.execution_capability || ctx.case_view?.snapshot?.execution_capability;
  return (
    <Section title={ctx.state_label || 'Confirmation'} desc="Here’s where your application stands.">
      <div className={`rounded-xl border p-4 ${na.blocked ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <p className="flex items-center gap-2 text-sm font-medium text-slate-800">{na.blocked ? <AlertCircle size={16} className="text-rose-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />} {na.label}</p>
        {na.blocked && <p className="mt-1 text-xs text-rose-700">Action required to continue.</p>}
      </div>
      <Row label="Execution route" value={ec} />
      <p className="mt-3 text-xs text-slate-400">Your application state is saved on our servers — resume any time from “My Cases”.</p>
    </Section>
  );
}

// ---- shared bits ----
function Section({ title, desc = "", children }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      {desc && <p className="mb-3 text-sm text-slate-500">{desc}</p>}
      <div className={desc ? '' : 'mt-3'}>{children}</div>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-800">{String(value ?? '—')}</span>
    </div>
  );
}
function Empty() { return <p className="text-sm text-slate-400">Nothing required here — proceed to the next step.</p>; }
function DateField({ label, value, onChange }) {
  return (<label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span><input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" /></label>);
}
function TextField({ label, value, onChange }) {
  return (<label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" /></label>);
}
function NumField({ label, value, min, onChange }) {
  return (<label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span><input type="number" min={min} value={value} onChange={(e) => onChange(Number(e.target.value) || 1)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" /></label>);
}
function DocStatus({ status }) {
  const tone = { not_started: 'bg-slate-100 text-slate-500', processing: 'bg-blue-50 text-blue-700', pending_review: 'bg-amber-50 text-amber-700', needs_review: 'bg-rose-50 text-rose-700', verified: 'bg-emerald-50 text-emerald-700', approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700', replacement_required: 'bg-rose-50 text-rose-700' };
  const label = { not_started: 'Missing', processing: 'Checking…', pending_review: 'In review', needs_review: 'Needs attention', verified: 'Verified', approved: 'Verified', rejected: 'Rejected', replacement_required: 'Replace' };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone[status] || tone.not_started}`}>{label[status] || 'Pending'}</span>;
}

import { Wallet } from 'lucide-react';