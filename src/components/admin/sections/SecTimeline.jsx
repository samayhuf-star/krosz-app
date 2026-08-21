import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminTimeline } from '@/lib/adminCaseApi';
import { Loader2 } from 'lucide-react';

const FILTERS = [
  { v: '', label: 'All' }, { v: 'traveler', label: 'Traveler' }, { v: 'system', label: 'System' }, { v: 'provider', label: 'Provider' }, { v: 'admin', label: 'Admin' }, { v: 'review', label: 'Review' },
];

export default function SecTimeline({ caseId }) {
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['admin-timeline', caseId, filter], queryFn: () => adminTimeline(caseId, filter || undefined) });
  const tl = q.data?.timeline || [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => <button key={f.v} onClick={() => setFilter(f.v)} className={`rounded-lg border px-2.5 py-1.5 text-xs ${filter === f.v ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{f.label}</button>)}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {q.isLoading ? <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div> :
          tl.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No events.</p> :
          <ol className="relative border-l border-slate-200 pl-4">
            {tl.map((e, i) => <li key={i} className="mb-3"><p className="text-sm font-medium text-slate-800">{e.title}</p><p className="text-[11px] text-slate-400">{new Date(e.at).toLocaleString()} · {e.source || 'case'}{e.actor ? ` · ${e.actor}` : ''}</p></li>)}
          </ol>}
      </div>
      <p className="text-xs text-slate-400">Timeline is derived from actual case events — never fabricated.</p>
    </div>
  );
}