import { useEffect, useState, useRef } from 'react';
import { Plus, Eye, RefreshCw, Trash2, X, FileText, ImageIcon, Upload, ShieldCheck, Clock, AlertTriangle } from 'lucide-react';
import {
  listDocuments, getDocumentConfig, createDocument, replaceDocument, deleteDocument,
  uploadPrivateDocument, getSignedDocumentUrl,
} from '@/lib/visaApi';

const EXPIRY = {
  valid: { label: 'Valid', cls: 'bg-orange-50 text-orange-700', icon: ShieldCheck },
  expiring_soon: { label: 'Expiring soon', cls: 'bg-amber-50 text-amber-700', icon: Clock },
  expired: { label: 'Expired', cls: 'bg-red-50 text-red-700', icon: AlertTriangle },
  unknown: { label: 'Needs details', cls: 'bg-amber-50 text-amber-700', icon: AlertTriangle },
};

export default function DocumentVault({ travelerId }) {
  const [docs, setDocs] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([getDocumentConfig(), listDocuments(travelerId)])
      .then(([c, r]) => { setConfig(c); setDocs(r.documents || []); setError(''); })
      .catch((e) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [travelerId]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this document? Active applications keep a pinned copy.')) return;
    try { await deleteDocument(id); load(); } catch (e) { setError(e?.message); }
  };

  const handleReplace = async (id) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = (config?.allowed_mime || []).join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const file_uri = await uploadPrivateDocument(file);
        await replaceDocument({ document_id: id, storage_uri: file_uri, mime_type: file.type, file_size: file.size });
        load();
      } catch (e) { setError(e?.message || 'Replace failed'); }
      finally { setUploading(false); }
    };
    input.click();
  };

  const handleView = async (d) => {
    try { const url = await getSignedDocumentUrl(d.current_version?.storage_uri); if (url) window.open(url, '_blank'); }
    catch (e) { setError(e?.message || 'Cannot open document'); }
  };

  return (
    <div className="px-4 md:px-8">
      <div className="mt-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My documents</h1>
          <p className="text-sm text-slate-500">Private vault — reusable across all your visa applications.</p>
        </div>
        <button onClick={() => setShowUpload(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-orange-700"><Plus size={16} /> Upload document</button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading ? <p className="mt-6 text-sm text-slate-500">Loading…</p> : docs.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Upload size={22} className="mx-auto text-slate-400" />
          <p className="mt-2 text-sm font-medium text-slate-700">No documents yet</p>
          <p className="text-xs text-slate-500">Upload your passport, photo and supporting documents to reuse them across applications.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => {
            const ex = EXPIRY[d.expiry_status] || EXPIRY.unknown;
            const ExIcon = ex.icon;
            return (
              <div key={d.id} className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-orange-50 text-orange-700"><FileIcon mime={d.current_version?.mime_type} /></div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{d.display_name || typeLabel(config, d.document_type)}</p>
                      <p className="text-xs text-slate-500">{typeLabel(config, d.document_type)} · v{d.current_version?.version_number}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${ex.cls}`}><ExIcon size={11} /> {ex.label}</span>
                </div>
                {d.expires_at ? <p className="mt-2 text-xs text-slate-500">Expires {d.expires_at}</p> : d.document_type === 'PASSPORT' && <p className="mt-2 text-xs font-medium text-amber-700">Passport details must be verified before use.</p>}
                {d.usage_count > 0 && <p className="mt-0.5 text-xs text-slate-400">Used in {d.usage_count} application{d.usage_count > 1 ? 's' : ''}</p>}
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => handleView(d)} disabled={!d.current_version} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Eye size={13} /> View</button>
                  <button onClick={() => handleReplace(d.id)} disabled={uploading} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><RefreshCw size={13} /> Replace</button>
                  <button onClick={() => handleDelete(d.id)} className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck size={13} /> Your files are stored privately and opened through secure, time-limited links.</p>

      {showUpload && <UploadModal config={config} travelerId={travelerId} onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); load(); }} />}
      {uploading && <p className="mt-2 text-xs text-slate-500">Uploading…</p>}
    </div>
  );
}

function UploadModal({ config, travelerId, onClose, onDone }) {
  const [type, setType] = useState('PASSPORT');
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const max = config?.max_size_mb || 10;
  const submit = async () => {
    setErr('');
    if (!file) { setErr('Choose a file'); return; }
    if (!type) { setErr('Select a document type'); return; }
    if (file.size > max * 1024 * 1024) { setErr(`File exceeds ${max}MB`); return; }
    if (!(config?.allowed_mime || []).includes(file.type)) { setErr('Unsupported file type'); return; }
    const validationError = await validateSelectedFile(file);
    if (validationError) { setErr(validationError); return; }
    setBusy(true);
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timed out. Check your connection and try again.')), 30000));
      const file_uri = await Promise.race([uploadPrivateDocument(file), timeout]);
      await createDocument({
        traveler_id: travelerId, document_type: type,
        display_name: type === 'PASSPORT' ? typeLabel(config, type) : (name.trim().slice(0, 80) || typeLabel(config, type)),
        storage_uri: file_uri, mime_type: file.type, file_size: file.size,
        original_filename: file.name, document_source: 'USER_UPLOAD', intake_status: 'REVIEW_REQUIRED',
        expires_at: expiresAt || null, issued_at: issuedAt || null,
      });
      onDone();
    } catch (e) { setErr(e?.message || 'Upload failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold text-slate-900">Upload document</p>
          <button onClick={onClose}><X size={18} className="text-slate-500" /></button>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="Type">
            <select value={type} onChange={(e) => { setType(e.target.value); if (!name) setName(typeLabel(config, e.target.value)); }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {(config?.document_types || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Document label (optional)">
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={type === 'PASSPORT'} maxLength={80} placeholder={type === 'PASSPORT' ? 'Passport' : typeLabel(config, type)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issued (optional)"><input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
            <Field label="Expires (optional)"><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
          </div>
          <div>
            <button onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-6 text-sm text-slate-600 hover:border-orange-400 hover:text-orange-700">
              <Upload size={16} /> {file ? file.name : 'Choose PDF, JPG or PNG'}
            </button>
            <input ref={fileRef} type="file" accept={(config?.allowed_mime || []).join(',')} className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <p className="mt-1 text-xs text-slate-400">Max {max}MB · {config?.allowed_ext?.join(', ').toUpperCase()}</p>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button onClick={submit} disabled={busy} className="w-full rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>
    </div>
  );
}

async function validateSelectedFile(file) {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  if (!isPdf && !isJpeg && !isPng) return 'The file contents do not match a supported PDF, JPG, or PNG document.';
  if (file.type.startsWith('image/')) {
    const dimensions = await new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
    if (!dimensions) return 'This image cannot be read. Choose a clear passport photo or scan.';
    if (dimensions.width < 800 || dimensions.height < 500) return 'This image is too small for reliable document review. Use a clearer, higher-resolution scan.';
  }
  return '';
}

function Field({ label, children }) { return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>; }
function typeLabel(config, key) { return (config?.document_types || []).find((t) => t.key === key)?.label || key; }
function FileIcon({ mime }) { return mime?.startsWith('image/') ? <ImageIcon size={16} /> : <FileText size={16} />; }