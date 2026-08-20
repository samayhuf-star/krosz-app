import { useState } from 'react';
import { Wand2, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PatternsPanel({ allIndustries }) {
  const [patterns, setPatterns] = useState(null);
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [industry, setIndustry] = useState('');
  const [suggested, setSuggested] = useState(null);

  const load = async () => { setLoading(true); try { const { industryApi } = await import('@/lib/industryApi'); const r = await industryApi.listPatterns(); setPatterns(r.patterns || []); } finally { setLoading(false); } };
  const suggest = async () => { if (!industry) return; setSuggesting(true); try { const { industryApi } = await import('@/lib/industryApi'); const r = await industryApi.suggestPatterns(industry); setSuggested(r.patterns || []); } finally { setSuggesting(false); } };
  const apply = async (p) => { if (!industry) return; const { industryApi } = await import('@/lib/industryApi'); await industryApi.applyPattern(p.id || p.pattern_id, industry); load(); };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <Button size="sm" variant="outline" onClick={load} className="h-8">{loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Load patterns</Button>
        <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-sm">
          <option value="">target industry…</option>
          {(allIndustries || []).map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
        </select>
        <Button size="sm" onClick={suggest} disabled={!industry || suggesting} className="h-8 bg-violet-600 hover:bg-violet-700">{suggesting ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Suggest cross-industry</Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {suggested && (
          <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
            <p className="mb-1.5 font-semibold text-violet-800">AI-suggested for {industry}</p>
            {suggested.length === 0 ? <p className="text-slate-500">No suggestions.</p> : suggested.map((p, i) => (
              <div key={i} className="mb-2 rounded-md border border-violet-100 bg-white p-2">
                <p className="font-medium text-slate-800">{p.name} <span className="text-[10px] text-slate-400">from {p.origin_industry}</span></p>
                <p className="text-slate-600">{p.mechanism}</p>
                {p.implementation_hint && <p className="mt-1 text-[11px] text-slate-500">↳ {p.implementation_hint}</p>}
                <Button size="sm" variant="outline" onClick={() => apply({ pattern_id: p.id })} className="mt-1.5 h-6 text-[11px]">Save & apply</Button>
              </div>
            ))}
          </div>
        )}
        {patterns && (
          <div>
            <p className="mb-1.5 font-semibold text-slate-500">Pattern library ({patterns.length})</p>
            {patterns.length === 0 ? <p className="text-slate-400">No patterns yet. Generate suggestions and save them.</p> : patterns.map((p) => (
              <div key={p.id} className="mb-2 rounded-md border border-slate-200 p-2">
                <p className="font-medium text-slate-800">{p.name} <span className="text-[10px] text-slate-400">{p.status} · from {p.origin_industry || '—'}</span></p>
                <p className="text-slate-600">{p.description || p.mechanism}</p>
                {p.applicable_industries?.length > 0 && <p className="mt-1 text-[10px] text-slate-400">applies to: {p.applicable_industries.join(', ')}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}