import { useState } from 'react';
import { Badge } from '@/components/ui/badge';

const TONE = { primary: 'bg-emerald-100 text-emerald-800', secondary: 'bg-slate-100 text-slate-700', long_tail: 'bg-violet-100 text-violet-800', question: 'bg-sky-100 text-sky-800', commercial: 'bg-amber-100 text-amber-800', local: 'bg-rose-100 text-rose-800', competitor: 'bg-fuchsia-100 text-fuchsia-800' };
const TYPES = ['primary', 'secondary', 'long_tail', 'question', 'commercial', 'local', 'competitor'];

function diffColor(d) { return d >= 70 ? 'text-rose-600' : d >= 40 ? 'text-amber-600' : 'text-emerald-600'; }

export default function KeywordsPanel({ keywords }) {
  const [filter, setFilter] = useState('all');
  const list = keywords?.length ? keywords : [];
  const shown = filter === 'all' ? list : list.filter((k) => k.type === filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setFilter('all')} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>All ({list.length})</button>
        {TYPES.map((t) => { const n = list.filter((k) => k.type === t).length; if (!n) return null; return (
          <button key={t} onClick={() => setFilter(t)} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{t.replace('_', '-')} ({n})</button>
        ); })}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid">
          <div className="col-span-4">Keyword</div><div className="col-span-2">Type</div><div className="col-span-2">Intent</div><div className="col-span-1">Diff.</div><div className="col-span-1">Pri.</div><div className="col-span-2">Page</div>
        </div>
        <ul className="divide-y divide-slate-100">
          {shown.map((k, i) => (
            <li key={i} className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-12 sm:items-center sm:gap-2">
              <div className="col-span-4"><p className="font-medium text-slate-900">{k.keyword}</p>{k.cluster && <p className="text-xs text-slate-400">cluster: {k.cluster}</p>}</div>
              <div className="col-span-2"><Badge variant="outline" className={TONE[k.type] || 'bg-slate-100'}>{k.type}</Badge></div>
              <div className="col-span-2 text-xs text-slate-500">{k.search_intent}</div>
              <div className={`col-span-1 text-xs font-semibold ${diffColor(k.keyword_difficulty)}`}>{k.keyword_difficulty ?? '—'}</div>
              <div className="col-span-1 text-xs text-slate-500">{k.priority ?? '—'}</div>
              <div className="col-span-2 font-mono text-xs text-slate-500">{k.page_slug || '—'}</div>
            </li>
          ))}
          {!shown.length && <li className="px-4 py-6 text-sm text-slate-500">No keywords.</li>}
        </ul>
      </div>
    </div>
  );
}