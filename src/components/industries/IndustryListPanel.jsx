import { useState } from 'react';
import { Search, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function IndustryListPanel({ blueprints, loading, onOpen, onSeed, onGenerate }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = Array.from(new Set(blueprints.map((b) => b.category))).sort();
  const filtered = blueprints.filter((b) => (!q || (b.industry_label + ' ' + b.industry_key).toLowerCase().includes(q.toLowerCase())) && (!cat || b.category === cat));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search industries…" className="h-8 w-full rounded-lg border border-slate-200 pl-8 pr-3 text-sm outline-none focus:border-emerald-400" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-8 rounded-lg border border-slate-200 px-2 text-sm">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={onSeed} className="h-8"><Database size={14} /> Seed</Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? <p className="p-4 text-sm text-slate-400">Loading library…</p> : (
          <div className="divide-y divide-slate-100">
            {filtered.map((b) => (
              <button key={b.id} onClick={() => onOpen(b.industry_key)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-emerald-50/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{b.industry_label}</p>
                  <p className="text-[11px] text-slate-400">{b.category.replace(/_/g, ' ')} · {b.field_count || 0} fields · v{b.version}</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span title="Usage">👥 {b.usage_count || 0}</span>
                  {b.human_verified ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">verified</span> : b.ai_generated ? <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-700">AI</span> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">stub</span>}
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="p-4 text-sm text-slate-400">No blueprints. Click "Generate" or "Seed" to build the library.</p>}
          </div>
        )}
      </div>
    </div>
  );
}