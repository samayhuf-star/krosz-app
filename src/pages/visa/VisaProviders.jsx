import { useEffect, useState } from 'react';
import { Activity, RefreshCw, Search, ShieldAlert, Database, Trash2, AlertTriangle } from 'lucide-react';
import { pipeworxHealth, pipeworxRequirement, pipeworxFreeDestinations, pipeworxInvalidate, pipeworxResetHealth, pipeworxCacheList, runProviderContractTests } from '@/lib/visaApi';

const STATUS_TONE = { CLOSED: 'bg-orange-50 text-orange-700 border-orange-200', OPEN: 'bg-red-50 text-red-700 border-red-200', HALF_OPEN: 'bg-amber-50 text-amber-700 border-amber-200' };

function Stat({ label, value, hint = '' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function VisaProviders() {
  const [health, setHealth] = useState(null);
  const [diagnose, setDiagnose] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passport, setPassport] = useState('IN');
  const [destination, setDestination] = useState('TH');
  const [look, setLook] = useState(null);
  const [looking, setLooking] = useState(false);
  const [free, setFree] = useState(null);
  const [cache, setCache] = useState([])
  const [tests, setTests] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await pipeworxHealth();
      setHealth(r?.health);
      setDiagnose(r?.diagnose);
      const c = await pipeworxCacheList(50);
      setCache(c?.cache || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  const doLookup = async (e) => {
    e?.preventDefault();
    setLooking(true); setLook(null);
    try {
      const r = await pipeworxRequirement(passport, destination, true);
      setLook(r);
      refresh();
    } catch (e) { setLook({ error: e?.message }); }
    finally { setLooking(false); }
  };

  const doFree = async () => {
    setLooking(true);
    try { setFree(await pipeworxFreeDestinations(passport)); } catch (e) { setFree({ error: e?.message }); }
    finally { setLooking(false); }
  };

  const runTests = async () => {
    setTests({ running: true });
    try { setTests(await runProviderContractTests()); } catch (e) { setTests({ error: e?.message }); }
  };

  const pw = health?.PIPEWORX || {};
  const circuit = pw.circuit || 'CLOSED';

  return (
    <div className="px-4 md:px-8 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3 py-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Visa Intelligence Providers</h1>
          <p className="text-sm text-slate-500">External visa-intelligence adapters behind the Visa Intelligence layer. Traveler-facing surfaces never call these directly.</p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Provider health */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white"><Activity size={18} /></span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{pw.displayName || 'Pipeworx Visa Requirements'}</p>
              <p className="text-xs text-slate-500">endpoint: {diagnose?.endpoint || '—'} · available: {String(diagnose?.available ?? '—')}</p>
            </div>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_TONE[circuit] || STATUS_TONE.CLOSED}`}>circuit {circuit}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Success rate" value={`${pw.success_rate_pct ?? 100}%`} />
          <Stat label="Avg latency" value={`${pw.avg_latency_ms ?? 0}ms`} />
          <Stat label="Cache hits" value={pw.cache_hits ?? 0} hint={`misses ${pw.cache_misses ?? 0}`} />
          <Stat label="Fallbacks" value={pw.fallback_total ?? 0} hint={`failures ${pw.failure_total ?? 0}`} />
        </div>
        <div className="mt-3 text-xs text-slate-500">
          requests {pw.requests_total ?? 0} · timeouts {pw.timeout_total ?? 0} · last success {pw.last_success_at || '—'} · last failure {pw.last_failure_at || '—'}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => pipeworxResetHealth()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ShieldAlert size={13} /> Reset circuit &amp; metrics</button>
          <button onClick={runTests} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Database size={13} /> Run provider contract tests</button>
        </div>
        {tests && tests.results && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
            <span className="font-semibold text-slate-700">Contract tests:</span> <span className="text-orange-700">{tests.passed} passed</span> · <span className="text-red-600">{tests.failed} failed</span>
            {tests.failed > 0 && <ul className="mt-1 ml-4 list-disc text-red-600">{tests.results.filter((r) => !r.pass).map((r) => <li key={r.name}>{r.name} — {r.detail}</li>)}</ul>}
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Live lookup */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Search size={16} /> Live requirement lookup</h2>
          <p className="text-xs text-slate-500">Bypasses cache (admin only). Returns the normalized internal model.</p>
          <form onSubmit={doLookup} className="mt-3 flex gap-2">
            <input value={passport} onChange={(e) => setPassport(e.target.value.toUpperCase())} placeholder="Passport (ISO2)" className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase" />
            <input value={destination} onChange={(e) => setDestination(e.target.value.toUpperCase())} placeholder="Destination (ISO2)" className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase" />
            <button disabled={looking} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Look up</button>
          </form>
          {look && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
              {look.error ? <p className="text-red-600">{look.error}</p> : (
                <div className="space-y-1">
                  <p><span className="text-slate-500">available:</span> {String(look.available)} · <span className="text-slate-500">freshness:</span> {look.freshness} · <span className="text-slate-500">cached:</span> {String(look.cached)} · <span className="text-slate-500">degraded:</span> {String(look.degraded)}</p>
                  {look.normalized && <><p><span className="text-slate-500">visa_status:</span> <span className="font-mono">{look.normalized.visa_status}</span></p><p><span className="text-slate-500">stay:</span> {String(look.normalized.stay_duration_days)} days</p><p><span className="text-slate-500">confidence:</span> {look.normalized.confidence}</p><p><span className="text-slate-500">source:</span> {look.normalized.source}</p><p className="text-[11px] text-slate-400">dataset {look.normalized.dataset_last_updated} · retrieved {look.normalized.retrieved_at}</p></>}
                </div>
              )}
            </div>
          )}
          <button onClick={doFree} className="mt-2 text-xs text-orange-700 hover:underline">Fetch visa-free destinations for this passport →</button>
          {free && (
            <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs">
              {free.error ? <p className="text-red-600">{free.error}</p> : (
                <p>visa-free <b>{free.result?.counts?.visa_free}</b> · VOA {free.result?.counts?.visa_on_arrival} · e-visa {free.result?.counts?.e_visa} · eTA {free.result?.counts?.eta} · required {free.result?.counts?.visa_required}</p>
              )}
            </div>
          )}
        </div>

        {/* Cache */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Database size={16} /> Provider cache ({cache.length})</h2>
            <button onClick={() => pipeworxInvalidate({})} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"><Trash2 size={13} /> Invalidate all</button>
          </div>
          <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-slate-100">
            {cache.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Cache empty.</p>}
            {cache.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2 text-xs">
                <div>
                  <p className="font-mono text-slate-800">{c.nationality} → {c.destination}</p>
                  <p className="text-slate-400">{c.visa_status} · {c.stay_duration_days != null ? `${c.stay_duration_days}d` : '—'} · {c.confidence}{c.degraded ? ' · degraded' : ''}</p>
                </div>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-slate-500">{c.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle size={13} /> Provider data is external intelligence from a community-maintained dataset — not an official embassy decision. Always verify with official sources.</p>
    </div>
  );
}