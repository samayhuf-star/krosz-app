import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ChevronLeft, ChevronRight, Save, AlertCircle, RotateCw } from 'lucide-react';
import { applicationCaseContext, applicationCaseSaveProgress, applicationCaseTransition } from '@/lib/applicationCaseApi';
import { confirmApplicationApi, bulkAnswers } from '@/lib/visaApi';
import { base44 } from '@/api/base44Client';
import WizardProgress from '@/components/wizard/WizardProgress';
import { StepTravel, StepTraveler, StepJourney, StepEligibility, StepRequirements, StepTravelerInfo, StepMaterialDetails, StepDocuments, StepReview, StepPayment, StepSubmission, StepConfirmation } from '@/components/wizard/WizardSteps';

export default function VisaWizard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ctxQ = useQuery({ queryKey: ['wizard-context', id], queryFn: () => applicationCaseContext(id), enabled: !!id, retry: false });
  const ctx = ctxQ.data;
  const caseRow = ctx?.case;
  const cv = ctx?.case_view;

  const steps = ctx?.steps || [];
  const savedIndex = (typeof cv?.wizard?.step_index === 'number' && cv.wizard.step_index < steps.length) ? cv.wizard.step_index : 0;
  const activeIndex = Math.max(0, steps.findIndex((s) => s.id === ctx?.active_step));
  // Saved wizard progress is only a convenience cursor; case_state remains the
  // authority. Older builds could save Review while the case was still
  // DOCUMENTS_REQUIRED, producing the contradictory screenshots. Clamp those
  // milestone states to the backend's active step on resume.
  const forceAuthoritativeStep = ['DRAFT', 'INTAKE', 'ELIGIBILITY_REVIEW', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_REVIEW'].includes(cv?.state || caseRow?.case_state);
  const stepIndex0 = forceAuthoritativeStep ? activeIndex : savedIndex;
  const [stepIndex, setStepIndex] = useState(0);
  const [hydratedCaseId, setHydratedCaseId] = useState(null);
  const [form, setForm] = useState(cv?.wizard?.form || {});
  const [confirmed, setConfirmed] = useState(false);
  const [passportReady, setPassportReady] = useState(!!cv?.wizard?.form?.passport?.confirmed);
  const [documentsReady, setDocumentsReady] = useState(false);
  const [reviewReady, setReviewReady] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ctx && hydratedCaseId !== id) {
      setStepIndex(stepIndex0);
      setForm(cv?.wizard?.form || {});
      setHydratedCaseId(id);
    }
  }, [ctx, id, hydratedCaseId, stepIndex0, cv?.wizard?.form]);

  const currentStep = steps[stepIndex];
  const stateNow = cv?.state || caseRow?.case_state;

  const blockedStepId = useMemo(() => {
    if (!ctx) return null;
    if (ctx.next_action?.blocked) return currentStep?.id;
    return null;
  }, [ctx, currentStep]);

  // Resume once context loads.
  useEffect(() => {
    if (ctx) base44.analytics?.track?.({ eventName: stepIndex0 > 0 ? 'CASE_RESUMED' : 'CASE_STARTED', properties: { case_id: id, step: stepIndex0 } });
  }, [id]);  

  if (ctxQ.isLoading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (ctxQ.isError) return <ErrorState onRetry={() => ctxQ.refetch()} message="We couldn’t load your application. Please try again." />;
  if (!ctx || !caseRow) return <ErrorState onRetry={() => ctxQ.refetch()} message="This application could not be found or you don’t have access." />;

  const isTerminal = ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED'].includes(stateNow);
  const last = stepIndex >= steps.length - 1;
  const isFirst = stepIndex === 0;

  const persist = async (nextIndex, formData) => applicationCaseSaveProgress({ id, step_index: nextIndex, form: formData });

  const fireTransition = async (to) => {
    if (!to || to === stateNow) return null;
    const res = await applicationCaseTransition({ id, to, idempotency_key: `step_${to}_${id}` });
    if (res?.error) throw new Error(res.error);
    return res;
  };

  const onContinue = async () => {
    setError(null);
    if (currentStep?.id === 'travel' && !(passportReady || form?.passport?.confirmed)) { setError('Upload and confirm the passport details before continuing.'); return; }
    if (currentStep?.id === 'documents' && !documentsReady) { setError('We’re still checking the required documents. Resolve any missing or review items before continuing.'); return; }
    if (currentStep?.id === 'review' && !confirmed) { setError('Please confirm the information is accurate before continuing.'); return; }
    // The review-readiness gate is enforced server-side by confirm-application +
    // READY_FOR_SUBMISSION; we no longer hard-block the click on the client-side
    // reviewReady flag (it could stay false and make the button fire nothing).
    // A server rejection is surfaced in the catch below rather than swallowed.
    setBusy(true);
    try {
      const sid = currentStep?.id;
      let nextIndex = stepIndex + 1;
      const indexOf = (stepId) => steps.findIndex((s) => s.id === stepId);

      if (sid === 'travel') {
        // PassportAutopilot already created/updated the case traveler, so do not
        // make the customer click through a second traveler form plus read-only
        // journey screens. Persist travel first (which refreshes eligibility),
        // enter INTAKE, then jump to the combined Verify stage.
        const verifyIndex = indexOf('eligibility');
        nextIndex = verifyIndex >= 0 ? verifyIndex : Math.min(stepIndex + 1, steps.length - 1);
        await persist(nextIndex, form);
        if (stateNow === 'DRAFT') await fireTransition('INTAKE');
      } else if (sid === 'eligibility') {
        // Journey + eligibility + requirements are rendered together. Once the
        // traveler continues, advance the deterministic case engine through its
        // two internal milestones and land directly on missing documents/review.
        // Save the material application answers (passport/personal fields are
        // auto-filled by PassportAutopilot; travel dates + employment + income
        // are collected here) so the final-review readiness gate has verified
        // answers to check against instead of perma-blocking on never-collected
        // required questions.
        await bulkAnswers(id, {
          'travel.purpose': cv?.snapshot?.purpose || caseRow?.purpose || form?.travel?.purpose || 'tourism',
          'travel.departure_date': form?.travel?.departure || '',
          'travel.return_date': form?.travel?.return || '',
          'employment.status': form?.details?.employment_status || '',
          'financial.annual_income': form?.details?.annual_income || '',
        }).catch(() => {});
        await persist(stepIndex, form);
        const hasRequiredDocs = (ctx.required_docs || []).length > 0;
        if (stateNow === 'INTAKE') {
          await applicationCaseTransition({ id, to: 'ELIGIBILITY_REVIEW', idempotency_key: `step_ELIGIBILITY_REVIEW_${id}` });
          await applicationCaseTransition({ id, to: hasRequiredDocs ? 'DOCUMENTS_REQUIRED' : 'DOCUMENTS_REVIEW', idempotency_key: `step_${hasRequiredDocs ? 'DOCUMENTS_REQUIRED' : 'DOCUMENTS_REVIEW'}_${id}` });
        } else if (stateNow === 'ELIGIBILITY_REVIEW') {
          await applicationCaseTransition({ id, to: hasRequiredDocs ? 'DOCUMENTS_REQUIRED' : 'DOCUMENTS_REVIEW', idempotency_key: `step_${hasRequiredDocs ? 'DOCUMENTS_REQUIRED' : 'DOCUMENTS_REVIEW'}_${id}` });
        }
        const docsIndex = indexOf('documents');
        const reviewIndex = indexOf('review');
        nextIndex = hasRequiredDocs && docsIndex >= 0 ? docsIndex : (reviewIndex >= 0 ? reviewIndex : Math.min(stepIndex + 1, steps.length - 1));
        await persist(nextIndex, form);
      } else if (sid === 'documents') {
        nextIndex = indexOf('review');
        if (nextIndex < 0) nextIndex = Math.min(stepIndex + 1, steps.length - 1);
        await persist(nextIndex, form);
        // Documents move only into review. READY_FOR_SUBMISSION is deliberately
        // impossible here: the backend requires verified documents + traveler
        // confirmation first, so the review step owns that gate.
        if (stateNow === 'DOCUMENTS_REQUIRED') await fireTransition('DOCUMENTS_REVIEW');
      } else if (sid === 'review') {
        await persist(stepIndex, form);
        // Persist the legal/user attestation through the existing final-review
        // engine, then ask the case engine to cross the submission-readiness gate.
        // If documents are still processing or any review finding blocks, either
        // call fails and this wizard stays on Review instead of lying about state.
        await confirmApplicationApi(id);
        if (stateNow === 'DOCUMENTS_REVIEW' || stateNow === 'DOCUMENTS_REQUIRED') await fireTransition('READY_FOR_SUBMISSION');
        nextIndex = stepIndex + 1;
        await persist(nextIndex, form);
      } else {
        await persist(nextIndex, form);
      }

      base44.analytics?.track?.({ eventName: 'WIZARD_STEP_COMPLETED', properties: { case_id: id, step: sid } });
      await qc.invalidateQueries({ queryKey: ['wizard-context', id] });
      setStepIndex(Math.min(nextIndex, steps.length - 1));
    } catch (e) {
        const rs = Array.isArray(e?.reasons) ? e.reasons : (Array.isArray(e?.reason) ? e.reason : null);
        const base = e?.message || 'Something went wrong saving your progress.';
        setError(rs && rs.length ? `${base} — ${rs.slice(0, 5).map((r) => r.message || r.code || r).join('; ')}` : base);
      }
    finally { setBusy(false); }
  };

  const onSubmit = async () => {
    setBusy(true); setError(null);
    try {
      // Submission is a separate, explicit axis. A case must enter
      // SUBMISSION_PENDING before SUBMITTED; payment/confirmation alone never
      // means the provider or government received the application.
      if (stateNow === 'READY_FOR_SUBMISSION') {
        await applicationCaseTransition({ id, to: 'SUBMISSION_PENDING', idempotency_key: `submit_pending_${id}` });
      }
      await applicationCaseTransition({ id, to: 'SUBMITTED', idempotency_key: `submit_${id}` });
      base44.analytics?.track?.({ eventName: 'APPLICATION_SUBMITTED', properties: { case_id: id } });
      await qc.invalidateQueries({ queryKey: ['wizard-context', id] });
      setStepIndex(steps.length - 1);
    } catch (e) { setError(e?.message || 'Submission failed.'); }
    finally { setBusy(false); }
  };

  const onBack = () => { setError(null); setStepIndex(Math.max(0, stepIndex - 1)); };

  const onExit = async () => { await persist(stepIndex, form).catch(() => {}); navigate('/cases'); };

  const renderStep = () => {
    switch (currentStep?.id) {
      case 'travel': return <StepTravel form={form} setForm={setForm} ctx={ctx} caseRow={caseRow} onPassportReady={setPassportReady} />;
      case 'traveler': return <StepTraveler form={form} setForm={setForm} snapshot={cv?.snapshot} />;
      case 'journey': return <StepJourney ctx={ctx} />;
      case 'eligibility': return <div className="space-y-5"><StepEligibility ctx={ctx} /><StepMaterialDetails form={form} setForm={setForm} /></div>;
      case 'requirements': return <StepRequirements ctx={ctx} />;
      case 'traveler_info': return <StepTravelerInfo form={form} setForm={setForm} />;
      case 'documents': return <StepDocuments ctx={ctx} caseRow={caseRow} onReadyChange={setDocumentsReady} />;
      case 'review': return <StepReview ctx={ctx} form={form} confirmed={confirmed} setConfirmed={setConfirmed} onReadyChange={setReviewReady} />;
      case 'payment': return <StepPayment ctx={ctx} caseRow={caseRow} />;
      case 'submission': return <StepSubmission ctx={ctx} />;
      case 'confirmation': return <StepConfirmation ctx={ctx} form={form} />;
      default: return null;
    }
  };

  const stageForStep = (stepId) => {
    if (['travel', 'traveler', 'journey', 'eligibility', 'traveler_info'].includes(stepId)) return 0;
    if (['requirements', 'documents'].includes(stepId)) return 1;
    if (stepId === 'review') return 2;
    return 3;
  };
  const customerStages = [
    { id: 'passport', label: 'Passport & Details' },
    { id: 'documents', label: 'Documents' },
    { id: 'review', label: 'Review' },
    { id: 'submit', label: 'Submit & Track' },
  ];
  const customerStageIndex = stageForStep(currentStep?.id);

  const destination = cv?.snapshot?.country || caseRow?.destination || 'Destination';
  const journey = cv?.snapshot?.journey || caseRow?.journey || 'Visa';
  const passportFree = cv?.snapshot?.document_requirements?.passport_submission === false;
  const digitalOnly = cv?.snapshot?.document_requirements?.physical_documents === false;
  const onlineJourney = /evisa|eta|electronic/i.test(String(journey));

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/cases" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"><ChevronLeft size={16} /> My cases</Link>
        <span className="text-xs font-medium text-slate-400">{destination} · {journey}</span>
      </div>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <WizardProgress steps={customerStages} currentIndex={customerStageIndex} blockedStepId={blockedStepId} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Application</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">{destination}</h2>
              <p className="mt-0.5 text-sm text-slate-500">{journey}</p>
              <span className="mt-3 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{ctx.state_label || 'Application started'}</span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Progress</p>
              <div className="mt-3 space-y-3">
                {customerStages.map((s, i) => (
                  <div key={s.id} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${i === customerStageIndex ? 'bg-blue-600 text-white' : i < customerStageIndex ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>{i < customerStageIndex ? '✓' : i + 1}</span>
                    <div><p className={`text-sm font-medium ${i === customerStageIndex ? 'text-blue-700' : 'text-slate-700'}`}>{s.label}</p></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Step {customerStageIndex + 1} of 4</p>
                <h1 className="mt-1 text-xl font-semibold text-slate-950">{customerStages[customerStageIndex]?.label}</h1>
                <p className="mt-1 text-sm text-slate-500">Complete only what is needed. We save your progress automatically.</p>
              </div>
              <button onClick={onExit} disabled={busy} className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 sm:inline-flex"><Save size={14} /> Save & exit</button>
            </div>

            {renderStep()}
            {error && <p className="mt-4 flex items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><AlertCircle size={14} /> {error}</p>}

            {!isTerminal && (
              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                <button onClick={onBack} disabled={isFirst} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={16} /> Back</button>
                {!last ? (
                  <button onClick={onContinue} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : null} Continue <ChevronRight size={16} /></button>
                ) : (
                  <Link to="/cases" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">Done</Link>
                )}
              </div>
            )}
            {isTerminal && <div className="mt-6 flex justify-end"><Link to="/cases" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Back to My Cases</Link></div>}
          </div>
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Application summary</h3>
              <dl className="mt-4 space-y-3">
                <div><dt className="text-xs text-slate-400">Destination</dt><dd className="mt-0.5 text-sm font-medium text-slate-800">{destination}</dd></div>
                <div><dt className="text-xs text-slate-400">Visa type</dt><dd className="mt-0.5 text-sm font-medium text-slate-800">{journey}</dd></div>
                <div><dt className="text-xs text-slate-400">Travellers</dt><dd className="mt-0.5 text-sm font-medium text-slate-800">{form?.travel?.travelers || 1} Traveller{Number(form?.travel?.travelers || 1) === 1 ? '' : 's'}</dd></div>
              </dl>
              {(onlineJourney || passportFree || digitalOnly) && <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-slate-700">
                {onlineJourney && <p className="flex gap-2 py-1"><span className="text-emerald-600">✓</span> Online application route</p>}
                {passportFree && <p className="flex gap-2 py-1"><span className="text-emerald-600">✓</span> No passport submission</p>}
                {digitalOnly && <p className="flex gap-2 py-1"><span className="text-emerald-600">✓</span> Digital documents supported</p>}
              </div>}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-950">Need help?</h3>
              <p className="mt-1 text-xs text-slate-500">Our team is here if you get stuck.</p>
              <Link to="/help" className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-slate-50">Get help</Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="mx-auto max-w-md px-5 py-20 text-center">
      <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
      <p className="mt-3 text-sm text-slate-600">{message}</p>
      <button onClick={onRetry} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><RotateCw size={14} /> Try again</button>
    </div>
  );
}