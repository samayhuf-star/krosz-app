import { useEffect, useState } from 'react';
import { ShieldCheck, Activity, Route as RouteIcon, Play } from 'lucide-react';
import { listSubmissionProviders, runSubmissionContractTests, seedSubmissionCatalog } from '@/lib/visaApi';

const CAPABILITY_BADGE = {
  VALIDATE: 'bg-blue-50 text-blue-700', CREATE_DRAFT: 'bg-indigo-50 text-indigo-700', SUBMIT: 'bg-orange-50 text-orange-700',
  STATUS: 'bg-slate-100 text-slate-600', RECEIPT: 'bg-amber-50 text-amber-700', CANCEL: 'bg-red-50 text-red-700',
  APPOINTMENT: 'bg-purple-50 text-purple-700', PAYMENT: 'bg-orange-50 text-orange-700', DOCUMENT_UPLOAD: 'bg-blue-50 text-blue-700',
};

export default function SubmissionProviders() {
  const [data, setData] = useState({ providers: [], routes: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await listSubmissionProviders()); } catch (e) { setError(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const seed = async () => { setBusy('seed'); try { await seedSubmissionCatalog(); await load(); } catch (e) { setError(e?.message); } finally { setBusy(''); } };
  const runTests = async () => { setBusy('tests'); setError(''); setResults(null); try { setResults(await runSubmissionContractTests()); } catch (e) { setError(e?.message); } finally { setBusy(''); } };

  return (
    <div className="px-4 md:px-8 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Submission Providers</h1>
          <p className="text-sm text-slate-500">Provider-neutral submission layer · capabilities, routes, health</p>
        </div>
        <div className="flex gap-2">
          <button onClick={seed} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"><ShieldCheck size={13} /> Seed catalog</button>
          <button onClick={runTests} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"><Play size={13} /> Run contract tests</button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {busy && <p className="mt-3 text-xs text-slate-400">{busy}…</p>}

      {results && (
        <div className="mt-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <div className="flex items-center gap-2">
            {results.allPassed ? <ShieldCheck className="text-orange-600" size={18} /> : <Activity className="text-amber-600" size={18} />}
            <p className="text-sm font-semibold text-slate-900">Contract suite: {results.allPassed ? 'ALL PASSED' : 'FAILURES'} · {results.total} assertions · {results.failed?.length} failed</p>
          </div>
          {results.failed?.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-red-600">
              {results.failed.map((f) => <li key={f}>• {f}</li>)}
            </ul>
          )}
          <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">All assertions</summary>
            <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {results.assertions?.map((a) => <li key={a.name} className={a.passed ? 'text-orange-700' : 'text-red-600'}>{a.passed ? '✓' : '✗'} {a.name}</li>)}
            </ul>
          </details>
        </div>
      )}

      {loading ? <p className="mt-6 text-sm text-slate-500">Loading…</p> : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.providers.map((p) => (
              <div key={p.id} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${p.enabled ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>{p.enabled ? 'ACTIVE' : 'DISABLED'}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{p.key} · {p.environment} · {p.adapter_config?.provider_type || p.category}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(p.capabilities || []).map((c) => <span key={c} className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAPABILITY_BADGE[c] || 'bg-slate-100 text-slate-600'}`}>{c.replace(/_/g, ' ')}</span>)}
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><Activity size={12} /> health: {p.health_status || 'unknown'}</span>
                  <span>·</span><span>failures: {p.failure_count || 0}</span>
                </div>
              </div>
            ))}
          </div>

          <h2 className="mt-8 flex items-center gap-2 text-sm font-semibold text-slate-900"><RouteIcon size={15} /> Submission routes</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="px-4 py-2.5 font-medium">Destination</th><th className="px-4 py-2.5 font-medium">Visa</th><th className="px-4 py-2.5 font-medium">Purpose</th><th className="px-4 py-2.5 font-medium">Channel</th><th className="px-4 py-2.5 font-medium">Provider type</th><th className="px-4 py-2.5 font-medium">Priority</th><th className="px-4 py-2.5 font-medium">Capabilities</th><th className="px-4 py-2.5 font-medium">Appointment</th></tr>
              </thead>
              <tbody>
                {data.routes.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{r.destination}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.visa_type_key}</td>
                    <td className="px-4 py-2.5 text-slate-600 capitalize">{r.purpose}</td>
                    <td className="px-4 py-2.5 text-slate-600 uppercase">{r.channel}</td>
                    <td className="px-4 py-2.5 text-slate-600">{(r.provider_type || '').replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.priority}</td>
                    <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1">{(r.capabilities || []).map((c) => <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{c}</span>)}</div></td>
                    <td className="px-4 py-2.5 text-slate-600">{r.appointment_required ? `Yes · ${r.appointment_location || ''}` : 'No'}</td>
                  </tr>
                ))}
                {!data.routes.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">No routes seeded.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-amber-700"><ShieldCheck size={12} /> Credentials are managed via platform secrets and never exposed here.</p>
        </>
      )}
    </div>
  );
}