import { useState, useRef } from 'react';
import { UploadCloud, Loader2, ShieldCheck, AlertTriangle, CheckCircle2, Link2 } from 'lucide-react';
import {
  uploadPrivateDocument, createDocument, replaceDocument, attachDocument,
  getDocumentIntelligence, confirmDocumentExtraction, accountUpdateTraveler, addPassport,
  validateApplicationDocuments, evaluateMvpEngine, recordDocumentEngineResult,
} from '@/lib/visaApi';
import { inspectPassportImage, createEnhancedPassportScan } from '@/lib/passportImage';

const FIELD_LABELS = {
  surname: 'Surname', given_names: 'Given names', passport_number: 'Passport number',
  nationality: 'Nationality', date_of_birth: 'Date of birth', sex: 'Sex',
  place_of_birth: 'Place of birth', issue_date: 'Issue date', expiry_date: 'Expiry date',
  issuing_country: 'Issuing country',
};
const PROFILE_FIELDS = new Set(['surname', 'given_names', 'nationality', 'date_of_birth', 'sex']);
const REQUIRED_PASSPORT_FIELDS = ['passport_number', 'surname', 'given_names', 'date_of_birth', 'expiry_date'];
const cleanValue = (value) => {
  if (value == null) return '';
  const text = String(value).trim();
  return /^(null|undefined|n\/a|na)$/i.test(text) ? '' : text;
};

export default function PassportAutopilot({ caseRow, ctx, form, setForm, onReadyChange }) {
  const travelerId = ctx?.case_view?.traveler_id;
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState(null);
  const [intel, setIntel] = useState(null);
  const [versionId, setVersionId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [enhance, setEnhance] = useState(true);
  const [fields, setFields] = useState(/** @type {Record<string, string>} */ ({}));
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [manual, setManual] = useState(false);
  const [status, setStatus] = useState({ tone: 'idle', message: '' });
  // Monotonic request id so an older in-flight intelligence fetch can never
  // clobber a newer one's readiness verdict (upload() and confirm() both call
  // loadIntel, and nothing previously stopped a slow, stale response from
  // overwriting a faster, fresher one).
  const requestSeqRef = useRef(0);

  const toggleManual = () => {
    const next = !manual;
    setManual(next);
    if (next && !fields.nationality && !fields.issuing_country) setFields({ ...fields, nationality: 'IN', issuing_country: 'IN' });
  };

  const loadIntel = async (id, initial) => {
    const seq = ++requestSeqRef.current;
    const result = initial?.extractions ? initial : await getDocumentIntelligence(id);
    if (seq !== requestSeqRef.current) return result; // superseded by a newer call — do not apply stale state
    setIntel(result);
    const next = /** @type {Record<string, string>} */ ({});
    for (const item of result?.extractions || []) next[item.field_name] = cleanValue(item.normalized_value || item.field_value);
    setFields(next);
    const needsReview = result?.intelligence?.status !== 'ready' || (result?.findings || []).some((f) => f.blocking && !f.resolved);
    onReadyChange?.(!needsReview);
    return result;
  };

  const upload = async (file) => {
    if (!file) return;
    if (!travelerId) { setError('We could not start the passport step because your traveler profile is not ready. Please go back and select or create a traveler.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('This file is larger than 10 MB. Please upload a smaller JPG, PNG or PDF.'); return; }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) { setError('Please upload your passport as a JPG, PNG or PDF file.'); return; }
    setBusy(true); setError(''); setConfirmed(false);
    setStatus({ tone: 'progress', message: 'Uploading your passport securely…' });
    try {
      // Run the local quality inspection and upload concurrently. Neither depends
      // on the other, so this removes one full client-side wait from the hot path.
      const [report, originalUri] = await Promise.all([
        inspectPassportImage(file),
        uploadPrivateDocument(file),
      ]);
      setQuality(report);
      setStatus({ tone: 'progress', message: 'Passport uploaded. Reading the photo page and checking the details…' });
      const created = await createDocument({
        traveler_id: travelerId,
        document_type: 'PASSPORT',
        display_name: file.name,
        storage_uri: originalUri,
        mime_type: file.type || 'application/octet-stream',
        file_size: file.size,
      });
      let activeVersion = created.version_id || created.version?.id;
      let activeDocument = created.document_id || created.document?.id;
      let intelligence = created.intelligence;

      // Enhancement is a fallback, not the default hot path. A clean original is
      // already the best OCR/MRZ source and avoids a second upload + replacement.
      if (enhance && report.canEnhance && report.checks?.length > 0) {
        const derivative = await createEnhancedPassportScan(file);
        if (derivative) {
          const derivativeUri = await uploadPrivateDocument(derivative);
          const replaced = await replaceDocument({
            document_id: activeDocument,
            storage_uri: derivativeUri,
            mime_type: derivative.type,
            file_size: derivative.size,
            source_version_id: activeVersion,
            derivative_kind: 'ENHANCED_SCAN',
            transformation: { crop: 'none_full_frame_preserved', contrast: 1.12, brightness: 1.03, perspective: 'not_applied' },
          });
          activeVersion = replaced.version_id || replaced.version?.id;
          intelligence = replaced.intelligence;
        }
      }

      // Attach and persist deterministic quality metadata in parallel; neither is
      // required before we can render extraction results returned by create/replace.
      const attachPromise = attachDocument({ application_id: caseRow.id, document_id: activeDocument, document_version_id: activeVersion });
      // Persist deterministic image-quality checks into Document Intelligence so
      // readiness cannot disagree with the upload UI. Passport field/MRZ checks
      // remain owned by the existing intelligence + review engines.
      const passportQualityResult = await evaluateMvpEngine('passport_intelligence', {
        passport: { surname: 'QUALITY_ONLY', given_names: 'QUALITY_ONLY', passport_number: 'QUALITY_ONLY', nationality: 'IND', date_of_birth: '2000-01-01', expiry_date: '2099-01-01' },
        mrz: { detected: true, valid: true }, quality: report,
        travel_start: caseRow?.travel_start || new Date().toISOString().slice(0, 10),
        policy: { min_validity_months: 0, policy_version: 'QUALITY-ONLY' }, conflicts: [],
      });
      const qualityOnly = { ...passportQualityResult, checks: (passportQualityResult.checks || []).filter((x) => x.check_id === 'PASS-008') };
      const qualityPromise = recordDocumentEngineResult(activeVersion, 'passport_image_quality', qualityOnly, caseRow.id);
      setVersionId(activeVersion); setDocumentId(activeDocument);
      // Show extracted passport fields as soon as intelligence is available.
      // Attach is required for readiness (it's what makes the document count
      // against the requirement), so we wait for it too. The quality-metric
      // write-back is supplementary telemetry the traveler never needs to watch
      // finish — waiting on it here was why the dropzone kept spinning after
      // "Image quality" had already rendered its result below it. Stop the
      // spinner once there's something to review; let quality persistence
      // finish in the background.
      const intelPromise = loadIntel(activeVersion, intelligence);
      await Promise.all([intelPromise, attachPromise]);
      setBusy(false);
      setStatus({ tone: 'success', message: 'Passport uploaded successfully. Please review the details below and fill in anything we could not read.' });
      qualityPromise
        .then(() => validateApplicationDocuments(caseRow.id).catch(() => {}))
        .catch(() => setStatus((prev) => (prev.tone === 'success' ? { tone: 'warning', message: 'A background quality check failed to save. Your upload is safe — refresh before continuing if this persists.' } : prev)));
    } catch (e) {
      setStatus({ tone: 'error', message: '' });
      setError('We could not read this passport clearly. Please try a sharper full-page photo with all four corners visible, or enter the details manually.');
      onReadyChange?.(false);
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!versionId) return;
    const missing = REQUIRED_PASSPORT_FIELDS.filter((key) => !cleanValue(fields[key]));
    if (missing.length) {
      setError(`Please complete ${missing.map((key) => FIELD_LABELS[key]).join(', ')} before continuing.`);
      return;
    }
    setBusy(true); setError(''); setStatus({ tone: 'progress', message: 'Saving your passport details…' });
    try {
      const confirmation = await confirmDocumentExtraction(versionId, fields);
      const nameParts = String(fields.given_names || '').trim().split(/\s+/);
      const travelerPatch = {
        first_name: nameParts.shift() || undefined,
        middle_name: nameParts.join(' ') || undefined,
        last_name: fields.surname || undefined,
        date_of_birth: fields.date_of_birth || undefined,
        nationality: fields.nationality || undefined,
        gender: fields.sex === 'M' ? 'male' : fields.sex === 'F' ? 'female' : undefined,
        metadata: { passport_prefill: { document_id: documentId, version_id: versionId, confirmed_at: new Date().toISOString() } },
      };
      await accountUpdateTraveler(travelerId, Object.fromEntries(Object.entries(travelerPatch).filter(([, v]) => v !== undefined)));
      if (fields.passport_number) {
        await addPassport(travelerId, {
          passport_number: fields.passport_number, country: fields.issuing_country || fields.nationality,
          surname: fields.surname || '', given_names: fields.given_names || '', nationality: fields.nationality || '',
          date_of_birth: fields.date_of_birth || undefined, issue_date: fields.issue_date || undefined,
          expiry_date: fields.expiry_date || undefined, sex: fields.sex || undefined,
          verification_status: 'verified', confidence: 1, source: 'extraction',
        }).catch(() => {});
      }
      setForm({ ...form, traveler_info: { ...(form.traveler_info || {}), first_name: travelerPatch.first_name, last_name: travelerPatch.last_name, dob: fields.date_of_birth, passport_number: fields.passport_number }, passport: { version_id: versionId } });
      await validateApplicationDocuments(caseRow.id).catch(() => {});
      // Always refresh intelligence after confirmation so the UI reflects the
      // reconciled findings (remediated blockers are now resolved server-side).
      // `confirmed` is derived from THIS fresh result, not a pre-refresh
      // snapshot — otherwise a blocking finding that only shows up after the
      // refresh leaves the button permanently disabled ("Confirmed and saved")
      // with no way to act on the still-open issue.
      const refreshed = await loadIntel(versionId);
      const stillBlocking = (refreshed?.findings || []).filter((f) => f.blocking && !f.resolved);
      setConfirmed(stillBlocking.length === 0);
      onReadyChange?.(stillBlocking.length === 0);
      if (stillBlocking.length === 0) {
        setStatus({ tone: 'success', message: 'Passport details confirmed and saved successfully.' });
      } else {
        // Surface the ACTUAL remaining blocking issues instead of a generic
        // "image-quality or consistency issue" message, so the traveler knows
        // exactly what to fix or re-upload.
        const detail = stillBlocking.slice(0, 3).map((f) => f.message).join(' · ');
        setError(`Your details were saved, but we still need you to check this passport: ${detail}. You can correct the fields above or upload a clearer photo.`);
        setStatus({ tone: 'warning', message: 'Saved, but one or more passport checks still need attention.' });
      }
    } catch (e) { setStatus({ tone: 'error', message: '' }); setError('We could not save your passport confirmation. Please review the highlighted fields and try again.'); }
    finally { setBusy(false); }
  };

  // Manual entry lets a traveler proceed without a scan — useful when no photo
  // is on hand. We save to the traveler profile + Passport record (source: manual)
  // but create no vault DocumentVersion; a scanned photo can be uploaded later in
  // the Documents step to satisfy the document-readiness gate before submission.
  const confirmManual = async () => {
    if (!travelerId) { setError('Traveler profile is not ready yet.'); return; }
    const f = fields || {};
    if (!f.passport_number?.trim() || !f.surname?.trim() || !f.given_names?.trim() || !f.date_of_birth || !f.expiry_date) {
      setError('Passport number, surname, given names, date of birth and expiry date are required for manual entry.'); return;
    }
    setBusy(true); setError(''); setStatus({ tone: 'progress', message: 'Saving your passport details…' });
    try {
      const country = (f.issuing_country || f.nationality || 'IN').toUpperCase();
      const nameParts = String(f.given_names || '').trim().split(/\s+/);
      const travelerPatch = {
        first_name: nameParts.shift() || undefined,
        middle_name: nameParts.join(' ') || undefined,
        last_name: f.surname || undefined,
        date_of_birth: f.date_of_birth || undefined,
        nationality: f.nationality || undefined,
        gender: f.sex === 'M' ? 'male' : f.sex === 'F' ? 'female' : undefined,
        metadata: { passport_prefill: { manual: true, confirmed_at: new Date().toISOString() } },
      };
      await accountUpdateTraveler(travelerId, Object.fromEntries(Object.entries(travelerPatch).filter(([, v]) => v !== undefined)));
      await addPassport(travelerId, {
        passport_number: String(f.passport_number).toUpperCase(), country,
        surname: f.surname || '', given_names: f.given_names || '', nationality: f.nationality || country,
        date_of_birth: f.date_of_birth || undefined, issue_date: f.issue_date || undefined,
        expiry_date: f.expiry_date || undefined, sex: f.sex || undefined,
        verification_status: 'manual', confidence: 0, source: 'manual',
      }).catch(() => {});
      setForm({ ...form, traveler_info: { ...(form.traveler_info || {}), first_name: travelerPatch.first_name, last_name: travelerPatch.last_name, dob: f.date_of_birth, passport_number: f.passport_number }, passport: { confirmed: true, manual: true } });
      setConfirmed(true); onReadyChange?.(true); setStatus({ tone: 'success', message: 'Passport details saved successfully. You can continue.' });
    } catch (e) { setStatus({ tone: 'error', message: '' }); setError('We could not save your passport details. Please check the required fields and try again.'); }
    finally { setBusy(false); }
  };

  const extractions = intel?.extractions || [];
  const blocking = (intel?.findings || []).filter((f) => f.blocking && !f.resolved);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-orange-200 bg-orange-50/50 p-4">
        <h3 className="text-base font-semibold text-slate-950">Start with your passport</h3>
        <p className="mt-1 text-sm text-slate-600">Upload the passport photo page. We’ll securely upload it, read the details, and then ask you to confirm anything that needs attention.</p>
        <label className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-orange-300 bg-white px-4 py-5 text-center focus-within:ring-2 focus-within:ring-orange-500">
          {busy ? <Loader2 className="h-6 w-6 animate-spin text-orange-600" /> : <UploadCloud className="h-6 w-6 text-orange-600" />}
          <span className="mt-2 text-sm font-semibold text-slate-800">{busy ? 'Working on your passport…' : 'Upload passport photo or scan'}</span>
          <span className="text-xs text-slate-500">JPG, PNG or PDF · up to 10 MB</span>
          <input aria-label="Upload passport photo or scan" type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {status.message && <div aria-live="polite" role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${status.tone === 'success' ? 'bg-emerald-50 text-emerald-700' : status.tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700'}`}>{status.tone === 'progress' && <Loader2 size={14} className="mr-2 inline animate-spin" />}{status.tone === 'success' && <CheckCircle2 size={14} className="mr-2 inline" />}{status.message}</div>}
        <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} className="mt-0.5" />
          <span>Create a clearer scan copy when possible. Your original remains preserved and the enhanced copy is linked with its transformation history.</span>
        </label>
        <button type="button" disabled className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500" aria-describedby="digilocker-note"><Link2 size={14} /> Import from DigiLocker · Coming soon</button>
        <p id="digilocker-note" className="mt-1 text-[11px] text-slate-500">Connection-ready only. No DigiLocker data is accessed until requester credentials and OAuth approval are configured.</p>
        <button type="button" onClick={toggleManual} className="mt-3 text-xs font-medium text-orange-700 hover:underline">{manual ? 'Upload a passport photo instead' : 'Enter passport details manually instead'}</button>
      </div>

      {quality && <div className="rounded-xl border border-slate-200 p-3" aria-live="polite">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-800">{quality.checks?.length ? <AlertTriangle size={15} className="text-amber-600" /> : <CheckCircle2 size={15} className="text-emerald-600" />} Image quality</p>
        {quality.checks?.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">{quality.checks.map((c) => <li key={c.code}>{c.message}</li>)}</ul> : <p className="mt-1 text-xs text-emerald-700">Basic quality checks passed.</p>}
      </div>}

      {versionId && !manual && <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">Verify passport details</h3><span className="text-xs text-slate-500">Fill any field we could not read</span></div>
        <p className="mt-1 text-xs text-slate-500">Blank or highlighted fields need your attention. We never show technical values such as “null” to the traveler.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(FIELD_LABELS).map(([key, label]) => {
            const item = extractions.find((x) => x.field_name === key);
            const isDate = key === 'date_of_birth' || key === 'issue_date' || key === 'expiry_date';
            const needsAttention = !cleanValue(fields[key]) || !item || Number(item.confidence || 0) < 0.9 || item.source !== 'mrz';
            return (
              <label key={key} className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">{label}{REQUIRED_PASSPORT_FIELDS.includes(key) && <span className="ml-1 text-rose-500">*</span>}</span>
                <input type={isDate ? 'date' : 'text'} value={cleanValue(fields[key])} onChange={(e) => setFields({ ...fields, [key]: isDate ? e.target.value : e.target.value.toUpperCase() })}
                  placeholder={needsAttention ? 'Please enter this detail' : ''}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500 ${needsAttention ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 bg-white'}`} />
              </label>
            );
          })}
        </div>
        {blocking.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">We found {blocking.length} item{blocking.length === 1 ? '' : 's'} that need your review. Correct the highlighted details, then save.</p>}
        <button type="button" onClick={confirm} disabled={busy || (confirmed && blocking.length === 0)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><ShieldCheck size={15} /> {busy ? 'Saving…' : confirmed && blocking.length === 0 ? 'Confirmed and saved' : blocking.length > 0 ? 'Save corrections and re-check' : 'Confirm passport details'}</button>
      </div>}
      {manual && extractions.length === 0 && (
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">Enter passport details</h3><span className="text-xs text-slate-500">Type the details from your photo page</span></div>
          <p className="mt-1 text-xs text-slate-500">These are saved to the traveler profile and used to pre-fill the application. You can still upload a scanned photo later in the Documents step.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(FIELD_LABELS).map(([key, label]) => {
              const isDate = key === 'date_of_birth' || key === 'issue_date' || key === 'expiry_date';
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
                  <input type={isDate ? 'date' : 'text'} value={fields[key] || ''} onChange={(e) => { setFields({ ...fields, [key]: isDate ? e.target.value : e.target.value.toUpperCase() }); }}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 border-slate-200" />
                </label>
              );
            })}
          </div>
          <button type="button" onClick={confirmManual} disabled={busy || confirmed} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><ShieldCheck size={15} /> {busy ? 'Saving…' : confirmed ? 'Confirmed and saved' : 'Save passport details'}</button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    </div>
  );
}