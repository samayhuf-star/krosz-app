import { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { listForms, getForm, validateFormPublish } from '@/lib/visaApi';

export default function GovernmentFormsAdmin() {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [validation, setValidation] = useState(null);

  useEffect(() => {
    listForms({ status: '' }).then((r) => { setForms(r.forms || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const toggle = async (formId) => {
    if (open === formId) { setOpen(null); setDetail(null); setValidation(null); return; }
    setOpen(formId);
    setDetail(null); setValidation(null);
    const r = await getForm(formId).catch(() => null);
    setDetail(r || null);
    validateFormPublish(formId).then((v) => setValidation(v)).catch(() => {});
  };

  if (loading) return <div className="px-4 md:px-8 py-8 text-sm text-slate-500">Loading forms…</div>;

  return (
    <div className="px-4 md:px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold text-slate-900">Government forms</p>
          <p className="text-sm text-slate-500">Versioned form definitions, fields and mappings (admin inspection).</p>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {forms.map((f) => {
          const isOpen = open === f.id;
          return (
            <div key={f.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <button onClick={() => toggle(f.id)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                  <FileText size={16} className="text-slate-500" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{f.form_name}</p>
                    <p className="text-[11px] text-slate-400 font-mono">{f.form_code} · v{f.version} · {f.country} · {f.purpose}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {f.metadata?.unverified && <span className="inline-flex items-center gap-1 text-[10px] text-amber-700"><ShieldCheck size={11} /> DEV</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${f.status === 'published' ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{f.status}</span>
                </div>
              </button>
              {isOpen && detail && (
                <div className="border-t border-slate-100 px-4 py-3">
                  {validation && (
                    <div className={`mb-3 rounded-lg p-2 text-xs ${validation.valid ? 'bg-orange-50 text-orange-700' : 'bg-rose-50 text-rose-700'}`}>
                      {validation.valid ? <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> Publish validation passed</span> : <span className="inline-flex items-center gap-1"><AlertTriangle size={12} /> {validation.errors.join(', ')}</span>}
                    </div>
                  )}
                  <p className="text-xs font-semibold text-slate-700">Fields ({detail.fields?.length || 0})</p>
                  <div className="mt-1 overflow-hidden rounded-lg border border-slate-200">
                    <div className="grid grid-cols-12 bg-slate-50 px-2 py-1.5 text-[10px] font-semibold uppercase text-slate-500">
                      <div className="col-span-4">code</div><div className="col-span-3">label</div><div className="col-span-2">type</div><div className="col-span-1">req</div><div className="col-span-2">section</div>
                    </div>
                    {(detail.fields || []).map((f) => (
                      <div key={f.id} className="grid grid-cols-12 px-2 py-1.5 text-[11px] border-t border-slate-100">
                        <div className="col-span-4 font-mono text-slate-700">{f.field_code}</div>
                        <div className="col-span-3 text-slate-600">{f.label}</div>
                        <div className="col-span-2 text-slate-500">{f.type}</div>
                        <div className="col-span-1">{f.required ? <span className="text-rose-500">●</span> : ''}</div>
                        <div className="col-span-2 text-slate-400">{f.section}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-700">Mappings ({detail.mappings?.length || 0})</p>
                  <div className="mt-1 overflow-hidden rounded-lg border border-slate-200">
                    <div className="grid grid-cols-12 bg-slate-50 px-2 py-1.5 text-[10px] font-semibold uppercase text-slate-500">
                      <div className="col-span-4">gov field</div><div className="col-span-4">source</div><div className="col-span-2">transform</div><div className="col-span-2">config</div>
                    </div>
                    {(detail.mappings || []).map((m) => (
                      <div key={m.id} className="grid grid-cols-12 px-2 py-1.5 text-[11px] border-t border-slate-100">
                        <div className="col-span-4 font-mono text-slate-700">{m.field_code}</div>
                        <div className="col-span-4 font-mono text-slate-500">{m.source_type}:{m.source_field}</div>
                        <div className="col-span-2"><span className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">{m.transformation}</span></div>
                        <div className="col-span-2 text-[10px] text-slate-400 truncate">{m.config ? Object.keys(m.config).join(',') : '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}