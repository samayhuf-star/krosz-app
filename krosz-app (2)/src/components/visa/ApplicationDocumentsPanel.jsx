import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, Circle, Loader2, Upload, Link2, X, ShieldCheck, AlertTriangle, FileSearch, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  listApplicationDocuments, findReusableDocuments, attachDocument,
  uploadPrivateDocument, createDocument, validateApplicationDocuments,
} from '@/lib/visaApi';

const STATE_META = {
  verified: { icon: CheckCircle2, tone: 'text-orange-600', ring: 'border-orange-100 bg-orange-50/50', label: 'Verified' },
  processing: { icon: Loader2, tone: 'text-amber-500', ring: 'border-amber-100 bg-amber-50/40', label: 'Processing', spin: true },
  needs_review: { icon: AlertTriangle, tone: 'text-rose-500', ring: 'border-rose-100 bg-rose-50/40', label: 'Needs review' },
  uploaded: { icon: FileSearch, tone: 'text-sky-500', ring: 'border-sky-100 bg-sky-50/40', label: 'Uploaded' },
  missing: { icon: Circle, tone: 'text-slate-300', ring: 'border-slate-200', label: 'Missing' },
};

export default function ApplicationDocumentsPanel({ applicationId }) {
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [activeItem, setActiveItem] = useState(null);
  const [rechecking, setRechecking] = useState(false);

  const load = () => {
    setLoading(true);
    listApplicationDocuments(applicationId)
      .then((r) => { setData(r); setErr(''); })
      .catch((e) => setErr(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [applicationId]);

  useEffect(() => {
    import('@/lib/visaApi').then(({ getDocumentConfig }) => getDocumentConfig().then((c) => setConfig(c)).catch(() => {}));
  }, []);

  const recheck = async () => {
    setRechecking(true);
    try { await validateApplicationDocuments(applicationId); load(); }
    catch (e) { setErr(e?.message || 'Recheck failed'); }
    finally { setRechecking(false); }
  };

  if (loading) return <div className="mt-6 text-sm text-slate-500">Loading documents…</div>;
  if (err) return <div className="mt-6 text-sm text-red-600">{err}</div>;

  const progress = data?.progress;
  const items = progress?.items || [];
  const pct = progress?.progress || 0;

  return (
    <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Documents</p>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-500">{progress?.complete || 0} / {progress?.total || 0} verified</span>
          <button onClick={recheck} disabled={rechecking} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw size={12} className={rechecking ? 'animate-spin' : ''} /> {rechecking ? 'Checking…' : 'Re-run checks'}
          </button>
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ul className="mt-4 space-y-2">
        {items.map((it) => {
          const meta = STATE_META[it.state] || STATE_META.missing;
          const Icon = meta.icon;
          const ad = it.application_document;
          return (
            <li key={it.requirement_id} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${meta.ring}`}>
              <div className="flex items-center gap-2.5">
                <Icon size={16} className={`${meta.tone} ${meta.spin ? 'animate-spin' : ''}`} />
                <div>
                  <p className="text-sm font-medium text-slate-800">{it.name}</p>
                  <p className="text-[11px] text-slate-400 capitalize">{it.mandatory_level}{ad ? ` · ${meta.label}` : ' · missing'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {ad?._intelligence?.extraction_confidence != null && it.state !== 'missing' && (
                  <span className="text-[11px] text-slate-400">{Math.round((ad._intelligence.extraction_confidence || 0) * 100)}%</span>
                )}
                {ad && <Link to={`/documents/${ad.document_id}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">View</Link>}
                {!ad && <button onClick={() => setActiveItem(it)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Link2 size={13} /> Attach</button>}
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li className="text-xs text-slate-500">No mandatory document requirements for this route.</li>}
      </ul>

      {activeItem && (
        <ResolveModal
          applicationId={applicationId}
          item={activeItem}
          travelerId={data?.application?.traveler_id}
          config={config}
          onClose={() => setActiveItem(null)}
          onDone={() => { setActiveItem(null); load(); }}
        />
      )}
    </div>
  );
}

function ResolveModal({ applicationId, item, travelerId, config, onClose, onDone }) {
  const [reusable, setReusable] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const primaryType = item.document_types?.[0];

  useEffect(() => {
    findReusableDocuments({ traveler_id: travelerId, document_type: primaryType })
      .then((r) => setReusable(r.documents || []))
      .catch(() => setReusable([]));
  }, [travelerId, primaryType]);

  const attach = async (document_id, document_version_id) => {
    setBusy(true); setErr('');
    try {
      await attachDocument({ application_id: applicationId, document_id, document_version_id, requirement_id: item.requirement_id });
      onDone();
    } catch (e) { setErr(e?.message || 'Attach failed'); }
    finally { setBusy(false); }
  };

  const uploadNew = async () => {
    if (!fileRef.current?.files?.[0]) return;
    const file = fileRef.current.files[0];
    setBusy(true); setErr('');
    try {
      const file_uri = await uploadPrivateDocument(file);
      const created = await createDocument({ traveler_id: travelerId, document_type: primaryType, display_name: item.name, storage_uri: file_uri, mime_type: file.type, file_size: file.size });
      await attach(created.document_id, created.version_id);
    } catch (e) { setErr(e?.message || 'Upload failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold text-slate-900">{item.name}</p>
          <button onClick={onClose}><X size={18} className="text-slate-500" /></button>
        </div>
        {reusable.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500">Existing document available</p>
            <div className="mt-2 space-y-2">
              {reusable.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{d.display_name}</p>
                    <p className="text-[11px] text-slate-400">v{d.current_version?.version_number} · {d.expiry_status}</p>
                  </div>
                  <button onClick={() => attach(d.id, d.current_version_id)} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60">Use</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-500">Upload a new {primaryType?.toLowerCase()}</p>
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-5 text-sm text-slate-600 hover:border-orange-400">
            <Upload size={16} /> {fileRef.current?.files?.[0]?.name || 'Choose PDF, JPG or PNG'}
          </button>
          <input ref={fileRef} type="file" accept={(config?.allowed_mime || ['application/pdf','image/jpeg','image/png']).join(',')} className="hidden" onChange={() => { /* name updates via ref on click; force re-render */ }} />
          <button onClick={uploadNew} disabled={busy} className="mt-2 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{busy ? 'Working…' : 'Upload & attach'}</button>
        </div>

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-amber-700"><ShieldCheck size={12} /> The exact version is pinned; later uploads won't change this application.</p>
      </div>
    </div>
  );
}