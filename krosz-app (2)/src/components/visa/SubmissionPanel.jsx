import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Send, ShieldCheck, UploadCloud, RefreshCw, XCircle, AlertTriangle, FileText } from 'lucide-react';
import { resolveSubmissionProvider, listSubmissions, approveSubmission, createSubmission, submitSubmission,
  getSubmissionStatusApi, enterExternalReference, uploadReceipt, cancelSubmission, checkPackageIntegrity, uploadPrivateDocument } from '@/lib/visaApi';

const STATUS_STYLE = {
  CREATED: 'bg-slate-100 text-slate-600', VALIDATING: 'bg-blue-50 text-blue-700', READY: 'bg-orange-50 text-orange-700',
  SUBMITTING: 'bg-amber-50 text-amber-700', SUBMITTED: 'bg-blue-100 text-blue-800', PROCESSING: 'bg-indigo-50 text-indigo-700',
  ACTION_REQUIRED: 'bg-amber-100 text-amber-800', COMPLETED: 'bg-orange-100 text-orange-800', REJECTED: 'bg-red-50 text-red-700',
  FAILED: 'bg-red-100 text-red-800', CANCELLED: 'bg-slate-100 text-slate-500',
};

export default function SubmissionPanel({ applicationId }) {
  const [provider, setProvider] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [integrity, setIntegrity] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [refInput, setRefInput] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);

  const load = async () => {
    setError('');
    try {
      const [p, s, i] = await Promise.all([
        resolveSubmissionProvider(applicationId).catch((e) => ({ error: e?.message })),
        listSubmissions(applicationId).catch(() => ({ submissions: [] })),
        checkPackageIntegrity(applicationId).catch(() => null),
      ]);
      setProvider(p);
      setSubmissions(s?.submissions || []);
      setIntegrity(i);
    } catch (e) { setError(e?.message || 'Failed to load submission'); }
  };

  useEffect(() => { load(); }, [applicationId]);

  const run = async (label, fn) => {
    setBusy(label); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(e?.message || `${label} failed`); }
    finally { setBusy(''); }
  };

  const handleApprove = () => run('approve', () => approveSubmission(applicationId));
  const handleCreate = () => run('create', () => createSubmission(applicationId));
  const handleSubmit = () => run('submit', () => submitSubmission(applicationId));
  const handleStatus = (id) => run('status', () => getSubmissionStatusApi(id));
  const handleCancel = (id) => run('cancel', () => cancelSubmission(id));
  const handleEnterRef = (id) => run('enter-ref', async () => { if (!refInput) return; await enterExternalReference(id, refInput); setRefInput(''); });
  const handleUploadReceipt = (id) => run('upload-receipt', async () => {
    if (!receiptFile) return;
    const file_uri = await uploadPrivateDocument(receiptFile);
    await uploadReceipt(id, { storage_uri: file_uri, mime_type: receiptFile.type, file_size: receiptFile.size, display_name: receiptFile.name });
    setReceiptFile(null);
  });

  const latest = submissions[0];
  const pkgReady = integrity?.package?.status === 'ready';
  const pkgValid = integrity?.integrity?.valid;
  const pkgStale = integrity?.stale?.stale;
  const isManual = provider?.provider_type === 'MANUAL_OPERATOR';
  const approved = !!latest || provider?.package_status === 'ready';

  return (
    <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Submission</p>
        <span className="text-xs text-slate-400">Phase 8 · provider-neutral</span>
      </div>

      {/* Provider + package summary (§47) */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KV k="Provider" v={provider?.provider_key || '—'} sub={provider?.provider_type} />
        <KV k="Channel" v={provider?.channel || '—'} sub={provider?.environment} />
        <KV k="Package" v={integrity?.package?.status || '—'} sub={pkgValid ? 'hash verified' : pkgValid === false ? 'modified' : ''} warn={!pkgValid} />
        <KV k="Approval" v={approved ? 'Approved' : 'Pending'} sub={pkgStale ? 'stale' : ''} warn={pkgStale} />
      </div>
      {provider?.error && <p className="mt-2 text-xs text-amber-700">{provider.error}</p>}
      {provider?.appointment_required && <p className="mt-2 text-xs text-slate-500">Appointment required at {provider.appointment_location || 'the submission center'}.</p>}

      {/* Stale / integrity warnings (§50/§51) */}
      {pkgStale && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5" />
          <span>Package is stale ({integrity?.stale?.reasons?.join(', ')}). Regenerate the government form and rebuild the package before submitting.</span>
        </div>
      )}
      {pkgValid === false && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-0.5" />
          <span>Package integrity check failed — the package was modified after building. Submission is blocked.</span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={handleApprove} disabled={!!busy || !pkgReady || approved} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"><ShieldCheck size={13} /> Approve for submission</button>
        {approved && !latest && <button onClick={handleCreate} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"><FileText size={13} /> Create submission</button>}
        {latest && !['SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'ACTION_REQUIRED'].includes(latest.status) && (
          <button onClick={handleSubmit} disabled={!!busy || pkgStale || !pkgValid} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"><Send size={13} /> {isManual ? 'Start manual submission' : 'Submit'}</button>
        )}
        {latest?.status === 'ACTION_REQUIRED' && !latest.external_reference && (
          <>
            <input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="External reference (e.g. VFS stamp #)" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
            <button onClick={() => handleEnterRef(latest.id)} disabled={!!busy || !refInput} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"><CheckCircle2 size={13} /> Enter reference</button>
          </>
        )}
        {latest?.external_reference && !latest.receipt_document_id && (
          <>
            <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} className="text-xs" />
            <button onClick={() => handleUploadReceipt(latest.id)} disabled={!!busy || !receiptFile} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"><UploadCloud size={13} /> Upload receipt</button>
          </>
        )}
        {latest && ['SUBMITTED', 'PROCESSING', 'ACTION_REQUIRED'].includes(latest.status) && (
          <button onClick={() => handleStatus(latest.id)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"><RefreshCw size={13} /> Refresh status</button>
        )}
        {latest && !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(latest.status) && (
          <button onClick={() => handleCancel(latest.id)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"><XCircle size={13} /> Cancel</button>
        )}
      </div>

      {/* Submission status (§47 after-submission) */}
      {latest && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[latest.status] || 'bg-slate-100 text-slate-600'}`}>{latest.status.replace(/_/g, ' ')}</span>
            <span className="text-xs text-slate-400">{latest.provider_key} · {latest.environment}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <KV k="Reference" v={latest.external_reference || '—'} />
            <KV k="Submitted" v={latest.submitted_at ? new Date(latest.submitted_at).toLocaleDateString() : '—'} />
            <KV k="Receipt" v={latest.receipt_document_id ? 'Uploaded' : '—'} />
          </div>
          {latest.error_code && <p className="mt-2 text-xs text-red-600">{latest.error_code}{latest.error_category ? ` · ${latest.error_category}` : ''}</p>}
        </div>
      )}

      {/* Timeline-ish state hints */}
      {submissions.length > 1 && (
        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer">Previous submissions ({submissions.length - 1})</summary>
          <ul className="mt-2 space-y-1">
            {submissions.slice(1).map((s) => <li key={s.id} className="flex items-center gap-2"><Circle size={10} className="text-slate-300" /> {s.status.replace(/_/g, ' ')} · {s.external_reference || 'no ref'} · {new Date(s.created_date).toLocaleDateString()}</li>)}
          </ul>
        </details>
      )}

      {busy && <p className="mt-3 text-xs text-slate-400">{busy}…</p>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-400"><ShieldCheck size={12} /> Frontend never calls government portals directly — all submission goes through the application API.</p>
    </div>
  );
}

function KV({ k, v, sub = '', warn = false }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs text-slate-400">{k}</p>
      <p className="mt-0.5 font-medium capitalize text-slate-900">{v || '—'}</p>
      {sub && <p className={`mt-0.5 text-xs ${warn ? 'text-amber-700' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  );
}