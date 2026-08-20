import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, ShieldCheck, Package, RefreshCw, Download, AlertTriangle, CheckCircle2, Hash, Layers } from 'lucide-react';
import { getApplication, resolveForm, generateForm, listSnapshots, checkFormStaleness, buildPackage, listPackages, exportSnapshot } from '@/lib/visaApi';

export default function GovernmentForm() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [form, setForm] = useState(null);
  const [result, setResult] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [staleness, setStaleness] = useState(null);
  const [packages, setPackages] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getApplication(id).then(async (r) => {
      setApp(r.application);
      setLoading(false);
      const fr = await resolveForm(id).catch(() => null);
      setForm(fr?.form || null);
      await loadSnapshots();
      await loadPackages();
    }).catch((e) => { setErr(e?.message || 'Not found'); setLoading(false); });
  }, [id]);

  const loadSnapshots = async () => {
    const r = await listSnapshots(id).catch(() => null);
    if (r?.snapshots) {
      setSnapshots(r.snapshots);
      const latest = r.snapshots[0];
      if (latest?.status === 'fresh') checkFormStaleness(id, latest.form_definition_id).then((s) => setStaleness(s)).catch(() => {});
    }
  };
  const loadPackages = async () => {
    const r = await listPackages(id).catch(() => null);
    if (r?.packages) setPackages(r.packages);
  };

  const handleGenerate = async () => {
    setBusy('generate'); setErr('');
    try {
      const res = await generateForm(id, form?.id);
      setResult(res);
      await loadSnapshots();
    } catch (e) { setErr(e?.message || 'Generation failed'); }
    finally { setBusy(''); }
  };

  const handleBuild = async () => {
    setBusy('package'); setErr('');
    try { await buildPackage(id, form?.id); await loadPackages(); }
    catch (e) { setErr(e?.message || 'Package build failed'); }
    finally { setBusy(''); }
  };

  const handleExport = async (snapshotId, format) => {
    const r = await exportSnapshot(snapshotId, format);
    const blob = new Blob([typeof r.exported === 'string' ? r.exported : JSON.stringify(r.exported, null, 2)], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `government-form-${snapshotId.slice(-8)}.${format}`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="px-4 md:px-8 py-8 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="px-4 md:px-8">
      <Link to={`/applications/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Back to application</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <div>
          <p className="text-lg font-semibold text-slate-900">Government form</p>
          <p className="text-sm text-slate-500">{form ? `${form.form_name} · v${form.version}` : 'No matching form for this route'}</p>
          <p className="text-xs text-slate-400">{app?.destination} · <span className="capitalize">{app?.purpose}</span> · {app?.visa_type_key}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleGenerate} disabled={!form || busy === 'generate'} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            <RefreshCw size={14} className={busy === 'generate' ? 'animate-spin' : ''} /> {busy === 'generate' ? 'Generating…' : 'Generate form'}
          </button>
          <button onClick={handleBuild} disabled={!form || busy === 'package'} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <Package size={14} /> {busy === 'package' ? 'Building…' : 'Build submission package'}
          </button>
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {form?.metadata?.unverified && <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-700"><ShieldCheck size={13} /> Form verification is pending</p>}

      {/* Generation result */}
      {result && (
        <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Form generation</p>
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${result.ok ? 'bg-orange-50 text-orange-700' : 'bg-rose-50 text-rose-700'}`}>
              {result.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {result.ok ? 'Valid' : 'Incomplete'}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            <KV k="Fields" v={`${Object.keys(result.fields || {}).length}`} />
            <KV k="Missing" v={`${(result.missing || []).length}`} />
            <KV k="Validation errors" v={`${(result.validation?.errors || []).length}`} />
          </div>
          {(result.missing || []).length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-rose-600">Missing / unmapped</p>
              <ul className="mt-1 space-y-1">
                {result.missing.map((m, i) => <li key={i} className="text-xs text-slate-600"><span className="font-mono">{m.field}</span> · {m.kind}</li>)}
              </ul>
            </div>
          )}
          {/* Field-by-field trace */}
          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-700">Field mapping trace</p>
            <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
              {(result.trace || []).map((t, i) => (
                <div key={i} className={`grid grid-cols-12 gap-2 px-3 py-2 text-xs ${i % 2 ? 'bg-slate-50' : 'bg-white'}`}>
                  <div className="col-span-4 font-mono text-slate-800">{t.government_field}</div>
                  <div className="col-span-3 text-slate-700">{String(t.value)}</div>
                  <div className="col-span-3 font-mono text-slate-400">{t.source}</div>
                  <div className="col-span-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{t.transformation}</span>{t.overridden && <span className="ml-1 text-[10px] text-amber-600">override</span>}</div>
                </div>
              ))}
              {(result.trace || []).length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No fields generated.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Snapshots */}
      <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <p className="text-sm font-semibold text-slate-900">Form snapshots</p>
        {staleness?.stale && <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700"><RefreshCw size={12} /> Latest snapshot is stale (changed: {staleness.changed_fields.join(', ') || '—'})</p>}
        <ul className="mt-3 space-y-2">
          {snapshots.map((s) => (
            <li key={s.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${s.status === 'fresh' ? 'border-orange-100 bg-orange-50/40' : s.status === 'stale' ? 'border-amber-100 bg-amber-50/40' : 'border-slate-200 bg-slate-50/40'}`}>
              <div className="flex items-center gap-2">
                <FileText size={15} className="text-slate-500" />
                <div>
                  <p className="text-xs font-medium text-slate-800">{s.form_code} v{s.form_version}</p>
                  <p className="text-[11px] text-slate-400">{new Date(s.generated_at).toLocaleString()} · {s.status}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Hash size={11} /> {s.data_hash?.slice(0, 12)}…</span>
                <button onClick={() => handleExport(s.id, 'json')} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"><Download size={11} className="inline" /> JSON</button>
                <button onClick={() => handleExport(s.id, 'csv')} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"><Download size={11} className="inline" /> CSV</button>
              </div>
            </li>
          ))}
          {snapshots.length === 0 && <li className="text-xs text-slate-400">No snapshots yet — generate the form to create one.</li>}
        </ul>
      </div>

      {/* Submission packages */}
      <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <p className="text-sm font-semibold text-slate-900">Submission packages</p>
        <ul className="mt-3 space-y-2">
          {packages.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package size={15} className="text-slate-500" />
                  <p className="text-xs font-medium text-slate-800">Package v{p.version} · {p.form_code} v{p.form_version}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.status === 'ready' ? 'bg-orange-50 text-orange-700' : p.status === 'submitted' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{p.status}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1"><Hash size={11} /> {p.package_hash?.slice(0, 16)}…</span>
                <span className="inline-flex items-center gap-1"><Layers size={11} /> {(p.items || []).length} items</span>
              </div>
              {p.metadata?.errors?.length > 0 && (
                <p className="mt-1 text-[11px] text-rose-600">Blocks: {p.metadata.errors.join(', ')}</p>
              )}
            </li>
          ))}
          {packages.length === 0 && <li className="text-xs text-slate-400">No packages yet — build one above.</li>}
        </ul>
      </div>
    </div>
  );
}

function KV({ k, v }) { return <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-2 py-1.5"><p className="text-[10px] text-slate-400">{k}</p><p className="text-sm font-semibold text-slate-900">{v}</p></div>; }