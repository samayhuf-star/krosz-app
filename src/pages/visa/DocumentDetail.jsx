import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Calendar, Hash } from 'lucide-react';
import { getDocument } from '@/lib/visaApi';
import PageHeader from '@/components/app/PageHeader';
import DocumentIntelligencePanel from '@/components/visa/DocumentIntelligencePanel';

export default function DocumentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [activeVersionId, setActiveVersionId] = useState(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getDocument(id)
      .then((d) => { setDoc(d); setActiveVersionId(d.current_version_id); })
      .catch((e) => setErr(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="px-4 md:px-8 py-8 text-sm text-slate-500">Loading document…</div>;
  if (err) return <div className="px-4 md:px-8 py-8 text-sm text-red-600">{err}</div>;
  if (!doc) return null;

  const versions = doc.versions || [];
  const activeVersion = versions.find((v) => v.id === activeVersionId) || versions[0];

  return (
    <div className="px-4 md:px-8 py-8 pb-16 max-w-3xl">
      <button onClick={() => nav(-1)} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 mb-3">
        <ArrowLeft size={14} /> Back
      </button>
      <PageHeader eyebrow="Vault" title={doc.display_name} description={`${doc.document_type} · ${doc.status} · expires ${doc.expiry_status}`} />

      <div className="mt-6 grid gap-4">
        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <p className="text-sm font-semibold text-slate-900">Document</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Info icon={FileText} label="Type" value={doc.document_type} />
            <Info icon={Hash} label="Status" value={doc.status} />
            <Info icon={Calendar} label="Issued" value={doc.issued_at || '—'} />
            <Info icon={Calendar} label="Expires" value={doc.expires_at || '—'} />
          </div>
          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Versions</p>
            <ul className="mt-2 space-y-1.5">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => setActiveVersionId(v.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs ${v.id === activeVersionId ? 'border-orange-200 bg-orange-50/50' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <span className="font-medium text-slate-800">v{v.version_number} · {v.status}</span>
                    <span className="text-slate-400">{(v.file_size / 1024).toFixed(0)} KB · {v.mime_type}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {activeVersion && (
          <DocumentIntelligencePanel versionId={activeVersion.id} storageUri={activeVersion.storage_uri} />
        )}
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className="text-slate-400" />
      <div>
        <p className="text-[11px] text-slate-400 capitalize">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  );
}