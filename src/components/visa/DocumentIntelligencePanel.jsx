import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle, FileSearch, ShieldCheck, Eye, ExternalLink } from 'lucide-react';
import { getDocumentIntelligence, getSignedDocumentUrl } from '@/lib/visaApi';

const SENSITIVE_FIELDS = ['passport_number', 'date_of_birth', 'account_number', 'personal_number', 'closing_balance'];

function maskValue(name, value) {
  if (!value) return '';
  if (!SENSITIVE_FIELDS.includes(name)) return value;
  const s = String(value);
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

const STAGES = [
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'classifying', label: 'Classified' },
  { key: 'extracting', label: 'Extracting' },
  { key: 'validating', label: 'Validating' },
];

const SEV_TONE = {
  CRITICAL: 'text-rose-600 bg-rose-50 border-rose-100',
  HIGH: 'text-rose-500 bg-rose-50/60 border-rose-100',
  MEDIUM: 'text-amber-600 bg-amber-50 border-amber-100',
  LOW: 'text-slate-500 bg-slate-50 border-slate-200',
  INFO: 'text-slate-500 bg-slate-50 border-slate-200',
};

export default function DocumentIntelligencePanel({ versionId, storageUri }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [processing, setProcessing] = useState(false);
  const [, setSignedUrl] = useState('');

  const load = () => {
    if (!versionId) return;
    setLoading(true);
    getDocumentIntelligence(versionId)
      .then((r) => { setData(r); setErr(''); })
      .catch((e) => setErr(e?.message || 'Failed to load intelligence'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [versionId]);

  const intel = data?.intelligence;
  const extractions = data?.extractions || [];
  const findings = data?.findings || [];

  const viewOriginal = async () => {
    setProcessing(true);
    try {
      const url = await getSignedDocumentUrl(storageUri);
      setSignedUrl(url); if (url) window.open(url, '_blank', 'noopener');
    } catch (e) { setErr(e?.message || 'Failed to open'); }
    finally { setProcessing(false); }
  };

  const currentStageIndex = STAGES.findIndex((s) => s.key === intel?.status);
  const failed = intel?.status === 'processing_failed';
  const needsReview = intel?.status === 'needs_review';
  const ready = intel?.status === 'ready';

  return (
    <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Intelligence</p>
        {intel && (
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              ready ? 'bg-orange-50 text-orange-700' : needsReview ? 'bg-rose-50 text-rose-700' : failed ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'
            }`}>
              {ready && <ShieldCheck size={12} />}
              {needsReview && <AlertTriangle size={12} />}
              {!ready && !needsReview && !failed && <Loader2 size={12} className="animate-spin" />}
              {failed ? 'Failed' : ready ? 'Verified' : needsReview ? 'Needs review' : 'Processing'}
            </span>
          </div>
        )}
      </div>

      {/* Processing state */}
      {loading && <p className="mt-4 text-xs text-slate-500">Analyzing document…</p>}
      {intel && !loading && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STAGES.map((s, i) => {
            const done = ready || needsReview || i < currentStageIndex;
            const active = i === currentStageIndex && !ready && !needsReview && !failed;
            return (
              <div key={s.key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${done ? 'border-orange-100 bg-orange-50/50 text-orange-700' : active ? 'border-amber-100 bg-amber-50/50 text-amber-700' : 'border-slate-200 text-slate-400'}`}>
                {done ? <CheckCircle2 size={13} /> : active ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
                <span className="font-medium">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {extractions.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Extracted information</p>
          <dl className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100">
            {extractions.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-3 py-2">
                <dt className="text-[11px] text-slate-400 capitalize">{(e.field_name || '').replace(/_/g, ' ')}</dt>
                <dd className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{maskValue(e.field_name, e.field_value) || '—'}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium uppercase">{e.source}</span>
                    {Math.round((e.confidence || 0) * 100)}%
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          {intel && <p className="mt-2 text-[11px] text-slate-400">Extractor {intel.extractor_version} · schema {intel.schema_version}{intel.model ? ` · ${intel.model}` : ''}</p>}
        </div>
      )}

      {findings.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Findings</p>
          <ul className="mt-2 space-y-1.5">
            {findings.map((f) => (
              <li key={f.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${SEV_TONE[f.severity] || SEV_TONE.LOW}`}>
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium">{f.message}</p>
                  <p className="text-[10px] opacity-70 uppercase">{f.type} · {f.source}{f.field ? ` · ${f.field}` : ''}{f.blocking ? ' · blocking' : ''}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {storageUri && (
        <button onClick={viewOriginal} disabled={processing} className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          <Eye size={13} /> {processing ? 'Opening…' : 'View original'} <ExternalLink size={11} />
        </button>
      )}

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
    </div>
  );
}