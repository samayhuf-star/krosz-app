import { useState } from 'react';
import { Loader2, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Benchmarks architecture placeholder — no external data collection yet.
// Lets an admin store AI-estimated benchmarks per industry so future external
// providers can populate the same metrics shape.
export default function BenchmarksPanel({ allIndustries }) {
  const [benchmarks, setBenchmarks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [industry, setIndustry] = useState('');
  const [region, setRegion] = useState('global');
  const [metrics, setMetrics] = useState('{\n  "conversion_rate": 0.03,\n  "lead_cost": 8,\n  "cac": 40,\n  "marketing_cadence_days": 7\n}');

  const load = async () => { setLoading(true); try { const { industryApi } = await import('@/lib/industryApi'); const r = await industryApi.listBenchmarks(); setBenchmarks(r.benchmarks || []); } finally { setLoading(false); } };
  const save = async () => {
    let parsed = {}; try { parsed = JSON.parse(metrics); } catch { alert('Metrics must be valid JSON'); return; }
    if (!industry) { alert('Pick an industry'); return; }
    const { industryApi } = await import('@/lib/industryApi');
    await industryApi.upsertBenchmark(industry, parsed, region);
    load();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <Button size="sm" variant="outline" onClick={load} className="h-8">{loading ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />} Load</Button>
        <span className="text-xs text-slate-400">Architecture placeholder · future external data collection</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        <div className="mb-4 rounded-lg border border-slate-200 p-3">
          <p className="mb-2 font-semibold text-slate-600">Upsert benchmark</p>
          <div className="mb-2 flex gap-2">
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="h-8 flex-1 rounded border border-slate-200 px-2 text-sm">
              <option value="">industry…</option>
              {(allIndustries || []).map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
            </select>
            <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="region" className="h-8 w-28 rounded border border-slate-200 px-2 text-sm" />
          </div>
          <textarea value={metrics} onChange={(e) => setMetrics(e.target.value)} className="min-h-[120px] w-full rounded border border-slate-200 p-2 font-mono text-[11px]" />
          <Button size="sm" onClick={save} className="mt-2 h-8 bg-emerald-700 hover:bg-emerald-800">Save benchmark</Button>
        </div>
        {benchmarks && (
          <div>
            <p className="mb-1.5 font-semibold text-slate-500">Stored benchmarks ({benchmarks.length})</p>
            {benchmarks.length === 0 ? <p className="text-slate-400">No benchmarks stored yet.</p> : benchmarks.map((b, i) => (
              <div key={i} className="mb-2 rounded-md border border-slate-200 p-2">
                <p className="font-medium text-slate-800">{b.industry_key} · {b.region} · v{b.version} <span className="text-[10px] text-slate-400">{b.data_source}</span></p>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-50 p-2 text-[10px]">{JSON.stringify(b.metrics, null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}