import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import PassportAutopilot from '@/components/wizard/PassportAutopilot';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { StepDocuments, StepReview } from '@/components/wizard/WizardSteps';
import { listDestinations, listTravelPurposes, accountListTravelers, bulkAnswers, confirmApplicationApi } from '@/lib/visaApi';
import { applicationCaseCreate, applicationCaseContext, applicationCaseTransition } from '@/lib/applicationCaseApi';

const STEPS = ['Destination', 'Passport', 'Documents', 'Review'];

const JOURNEY_LABELS = {
  evisa: 'eVisa (online application)',
  vac: 'Visa Application Centre (VAC)',
  embassy: 'Embassy / Consulate',
  onsite: 'On-site / on arrival',
  visafree: 'Visa-free entry',
  visaonarrival: 'Visa on arrival',
  eta: 'Electronic Travel Authorization (eTA)',
  visarequired: 'Standard visa (application required)',
  noadmission: 'Not available for direct application',
  other: 'Other route',
};

export default function UnifiedWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [destinations, setDestinations] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const [primary, setPrimary] = useState(null);
  const initialParams = new URLSearchParams(window.location.search);
  const [form, setForm] = useState({
    destination: (initialParams.get('destination') || '').toUpperCase(),
    nationality: 'IN',
    purpose: initialParams.get('purpose') || '',
    departure: '',
    return: '',
  });
  const [destQuery, setDestQuery] = useState('');
  const [caseRow, setCaseRow] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [passportReady, setPassportReady] = useState(false);
  const [documentsReady, setDocumentsReady] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // Clearing the resolved case when the selection changes forces a fresh
  // eligibility/route check before the traveler proceeds to passport upload.
  const updateField = (patch) => { setForm((f) => ({ ...f, ...patch })); if (caseRow) { setCaseRow(null); setCtx(null); } };

  useEffect(() => {
    listDestinations().then((r) => setDestinations(r.destinations || [])).catch(() => {});
    listTravelPurposes().then((r) => setPurposes(r.purposes || [])).catch(() => {});
    accountListTravelers().then((r) => {
      const list = r.travelers || [];
      setPrimary(list.find((t) => t.is_primary && t.status !== 'ARCHIVED') || list[0] || null);
    }).catch(() => {});
  }, []);

  const filteredDest = destinations.filter((d) => !destQuery || d.name.toLowerCase().includes(destQuery.toLowerCase()));
  const today = new Date().toISOString().slice(0, 10);
  const tooSoon = form.departure && (new Date(form.departure).getTime() - new Date(today).getTime()) / 86400000 < 15;

  // Screen 1: destination + purpose are mandatory; dates are optional.
  const step1Valid = !!form.destination && !!form.purpose;

  // Keep status fresh when entering the documents/review screens.
  useEffect(() => {
    if ((step === 3 || step === 4) && caseRow?.id) {
      applicationCaseContext(caseRow.id).then(setCtx).catch(() => {});
    }
  }, [step, caseRow?.id]);

  const nextFromDiscovery = async () => {
    if (!step1Valid) { setError('Please choose a destination and your reason for travelling.'); return; }
    if (form.departure && form.departure < today) { setError('Departure date cannot be in the past.'); return; }
    if (form.return && form.departure && form.return < form.departure) { setError('Return date cannot be before departure.'); return; }
    setError(''); setCreating(true);
    try {
      const idempotency_key = `case_${form.nationality}_${form.destination}_${form.purpose}_${form.departure || 'nodate'}_${form.return || 'noreturn'}_${primary?.id || ''}`;
      const res = await applicationCaseCreate({
        destination: form.destination,
        nationality: form.nationality,
        purpose: form.purpose,
        travel_dates: { departure: form.departure || undefined, return: form.return || undefined },
        traveler_id: primary?.id,
        idempotency_key,
      });
      const c = res?.case;
      if (!c?.id) throw new Error('Could not start the application.');
      const context = await applicationCaseContext(c.id);
      // Stay on the discovery step so the traveler reviews the resolved visa
      // route (eVisa / VAC / embassy) before proceeding to passport upload.
      setCaseRow(c); setCtx(context);
    } catch (e) { setError(e?.message || 'Could not start the application.'); }
    finally { setCreating(false); }
  };

  const nextFromPassport = async () => {
    if (!passportReady) { setError('Upload and confirm your passport before continuing.'); return; }
    setError(''); setBusy(true);
    try {
      // Save the material answers we collected (passport/personal fields are
      // auto-filled by PassportAutopilot). Dates are optional and recorded if set.
      await bulkAnswers(caseRow.id, {
        'travel.purpose': form.purpose,
        'travel.departure_date': form.departure || '',
        'travel.return_date': form.return || '',
      }).catch(() => {});
      const state = ctx?.case_view?.state || caseRow?.case_state;
      if (state === 'DRAFT') await applicationCaseTransition({ id: caseRow.id, to: 'INTAKE', idempotency_key: `step_INTAKE_${caseRow.id}` });
      const context = await applicationCaseContext(caseRow.id);
      setCtx(context);
      // Fail closed: force a fresh check on the Documents step rather than
      // trusting whatever documentsReady happened to be left at from an
      // earlier visit.
      setDocumentsReady(false);
      setStep(3);
    } catch (e) { setError(e?.message || 'Could not save your progress.'); }
    finally { setBusy(false); }
  };

  const nextFromDocuments = async () => {
    if (!documentsReady) { setError('Resolve all document issues before continuing.'); return; }
    setError(''); setBusy(true);
    try {
      const state = ctx?.case_view?.state || caseRow?.case_state;
      if (state === 'DOCUMENTS_REQUIRED' || state === 'DOCUMENTS_REVIEW') {
        await applicationCaseTransition({ id: caseRow.id, to: 'DOCUMENTS_REVIEW', idempotency_key: `step_DR_${caseRow.id}` }).catch(() => {});
      }
      const context = await applicationCaseContext(caseRow.id);
      setCtx(context);
      // Same fail-closed reset before entering Review — its own readiness
      // check runs on mount, but never start from a stale "ready" value.
      setReviewReady(false);
      setStep(4);
    } catch (e) { setError(e?.message || 'Could not save your progress.'); }
    finally { setBusy(false); }
  };

  // The final-review "Submit application" click must always fire the network
  // request: the server-side confirm-application + READY_FOR_SUBMISSION gates
  // are authoritative, so we never block the button on a client-side readiness
  // flag that can get stuck false (that was the dead-end — zero requests fired).
  // If the server rejects, its reasons are surfaced below (never silent).
  const submit = async () => {
    if (!confirmed) { setError('Please confirm the information is accurate before continuing.'); return; }
    setError(''); setBusy(true);
    try {
      await confirmApplicationApi(caseRow.id);
      const stateOf = async () => { const c = await applicationCaseContext(caseRow.id); return c?.case_view?.state || c?.case?.case_state; };
      let s = await stateOf();
      if (s !== 'READY_FOR_SUBMISSION' && s !== 'SUBMISSION_PENDING' && s !== 'SUBMITTED') {
        await applicationCaseTransition({ id: caseRow.id, to: 'READY_FOR_SUBMISSION', idempotency_key: `ready_${caseRow.id}` });
        s = await stateOf();
      }
      navigate(`/cases/${caseRow.id}`);
    } catch (e) {
      console.error('UnifiedWizard: submit failed', e);
      const rs = Array.isArray(e?.reasons) ? e.reasons : (Array.isArray(e?.reason) ? e.reason : null);
      const base = e?.message || 'Application is not ready for confirmation.';
      setError(rs && rs.length ? `${base} — ${rs.slice(0, 5).map((r) => r.message || r.code || r).join('; ')}` : base);
    } finally { setBusy(false); }
  };

  const back = () => {
    setError('');
    const prev = Math.max(1, step - 1);
    // Same fail-closed reset when navigating backward, so re-entering a step
    // never inherits a stale "ready" reading from before.
    if (prev === 2) setPassportReady(false);
    if (prev === 3) setDocumentsReady(false);
    setStep(prev);
  };
  const onContinue = () => {
    if (step === 1) { if (caseRow?.id && ctx) setStep(2); else nextFromDiscovery(); return; }
    if (step === 2) { nextFromPassport(); return; }
    if (step === 3) { nextFromDocuments(); return; }
  };
  const continueDisabled = creating || busy ||
    (step === 1 && !caseRow && !step1Valid) ||
    (step === 1 && !!caseRow && ctx?.eligibility === 'ineligible') ||
    (step === 2 && !passportReady) ||
    (step === 3 && !documentsReady);

  return (
    <div>
      <PageHeader
        eyebrow="Visa application"
        title="Find the right visa in minutes"
        description="Tell us where you're going and why — then upload your passport and documents, and we'll prepare your application."
      />
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <Stepper step={step} />
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="mb-3 text-base font-semibold text-slate-950">Where are you going?</h2>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={destQuery} onChange={(e) => setDestQuery(e.target.value)} placeholder="Search destinations"
                    className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-orange-500" />
                </div>
                <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                  {filteredDest.map((d) => (
                    <button key={d.code} onClick={() => updateField({ destination: d.code })}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${form.destination === d.code ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <span className="text-2xl">{d.flag_emoji}</span>
                      <span className="text-sm font-medium text-slate-800">{d.name}</span>
                      {form.destination === d.code && <Check className="ml-auto h-4 w-4 text-orange-600" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="mb-3 text-base font-semibold text-slate-950">Passport</h2>
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">🇮🇳 Indian passport</p>
                  <p className="mt-1 text-xs text-slate-500">Krosz currently supports Indian passport holders. More nationalities coming soon.</p>
                </div>
              </div>

              <div>
                <h2 className="mb-2 text-base font-semibold text-slate-950">Why are you travelling?</h2>
                <Select value={form.purpose} onValueChange={(v) => updateField({ purpose: v })}>
                  <SelectTrigger className="h-11 w-full rounded-lg border-slate-200 text-sm focus:border-orange-500">
                    <SelectValue placeholder="Select a reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    {purposes.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <h2 className="mb-2 text-base font-semibold text-slate-950">When are you travelling? <span className="text-xs font-normal text-slate-400">(optional)</span></h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">Departure date</span>
                    <input type="date" min={today} value={form.departure} onChange={(e) => updateField({ departure: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">Return date</span>
                    <input type="date" min={form.departure || today} value={form.return} onChange={(e) => updateField({ return: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500" />
                  </label>
                </div>
                {tooSoon && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-800">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>Most visas need at least 15 days to process. This date may be too close to travel.</span>
                  </p>
                )}
              </div>

              {caseRow && ctx && <EligibilityResult ctx={ctx} />}
            </div>
          )}

          {step === 2 && <PassportAutopilot caseRow={caseRow} ctx={ctx} form={form} setForm={setForm} onReadyChange={setPassportReady} />}
          {step === 3 && <StepDocuments ctx={ctx} caseRow={caseRow} onReadyChange={setDocumentsReady} />}
          {step === 4 && <StepReview ctx={ctx} caseRow={caseRow} form={form} confirmed={confirmed} setConfirmed={setConfirmed} onReadyChange={setReviewReady} />}

          {error && <p className="mt-4 flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><AlertCircle size={14} /> {error}</p>}

          <div className="mt-6 flex items-center justify-between">
            <button onClick={back} disabled={step === 1}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50">
              <ChevronLeft size={16} /> Back
            </button>
            {step < 4 ? (
              <button
                onClick={onContinue}
                disabled={continueDisabled}
                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-40">
                {(creating || busy) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight size={16} />} {step === 1 && !caseRow ? 'Check eligibility' : 'Continue'}
              </button>
            ) : (
              <button onClick={submit} disabled={busy || !confirmed}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check size={16} />} Submit application
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EligibilityResult({ ctx }) {
  const s = ctx?.case_view?.snapshot || {};
  const el = ctx?.eligibility;
  const jKey = String(s.journey || '').toLowerCase().replace(/[^a-z]/g, '');
  const journeyLabel = JOURNEY_LABELS[jKey]
    || (s.journey ? (String(s.journey).charAt(0).toUpperCase() + String(s.journey).slice(1)) : 'Route not resolved yet');
  const elMap = {
    eligible: ['emerald', 'You appear eligible for this route based on the verified destination rule.', CheckCircle2],
    ineligible: ['rose', 'You do not appear eligible for this route based on current rules.', AlertCircle],
    unknown: ['amber', 'Eligibility requires further verification — we cannot confirm it yet.', AlertCircle],
    requires_review: ['amber', 'Eligibility needs a manual review before proceeding.', AlertCircle],
  };
  const [tone, msg, Icon] = elMap[el] || elMap.unknown;
  const reqs = ctx?.required_docs || [];
  const toneCls = tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-800'
    : 'border-amber-200 bg-amber-50 text-amber-800';
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-950">Your visa route</h3>
        <span className="text-xs text-slate-400">Resolved from verified visa data</span>
      </div>
      <div className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${toneCls}`} role="status">
        <Icon size={16} className="mt-0.5 shrink-0" />
        <span>{msg}</span>
      </div>
      <dl className="mt-3 divide-y divide-slate-200 text-sm">
        <ERRow label="Destination" value={s.country} />
        <ERRow label="Nationality" value={s.nationality || 'IN'} />
        <ERRow label="Visa route" value={journeyLabel} />
        <ERRow label="Verification status" value={s.verification_status} />
        <ERRow label="Data confidence" value={s.confidence} />
      </dl>
      {reqs.length > 0 && <p className="mt-3 text-xs text-slate-500">{reqs.length} document{reqs.length === 1 ? '' : 's'} typically required for this route.</p>}
      {s.official_source?.url && (
        <a href={s.official_source.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"><ExternalLink size={14} /> Official source</a>
      )}
      <p className="mt-3 text-xs text-slate-500">Review the route above, then continue to upload your passport.</p>
    </div>
  );
}
function ERRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm font-medium text-slate-800">{String(value ?? '—')}</dd>
    </div>
  );
}

function Stepper({ step }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${active ? 'bg-orange-600 text-white' : done ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-400'}`}>
              {done ? <Check size={14} /> : n}
            </div>
            <span className={`text-xs font-medium ${active ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className="mx-1 h-px flex-1 bg-slate-200" />}
          </div>
        );
      })}
    </div>
  );
}