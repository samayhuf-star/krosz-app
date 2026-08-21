import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Inbox } from 'lucide-react';
import { RUN_STATUS_META, prettyKey, fmtDateTime } from './statusMeta';

// Resolve a friendly business name for each run (left list), so the run list
// isn't just business_id UUIDs.
function useBusinessNames(businessIds) {
  const ids = Array.from(new Set(businessIds)).filter(Boolean);
  return useQuery({
    queryKey: ['workflows', 'business-names', ids.join('|')],
    queryFn: async () => {
      const rows = await base44.entities.Business.filter({ $or: ids.map((id) => ({ id })) }).catch(() => []);
      const m = {};
      (rows || []).forEach((b) => { m[b.id] = b.name; });
      return m;
    },
    enabled: ids.length > 0,
    staleTime: 60000,
  });
}

export default function RunList({ runs = [], selectedId, onSelect }) {
  const { data: names } = useBusinessNames(runs.map((r) => r.business_id));

  if (!runs.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
        <Inbox size={28} className="text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-500">No workflows yet</p>
        <p className="mt-1 text-xs text-slate-400">Launch a workflow to see it execute live.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((r) => {
        const meta = RUN_STATUS_META[r.status] || RUN_STATUS_META.pending;
        const active = r.id === selectedId;
        return (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
              active ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 flex-none rounded-full ${meta.dot} ${r.status === 'running' ? 'animate-pulse' : ''}`} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                {prettyKey(r.plan_template_id || r.goal || 'Workflow')}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {names?.[r.business_id] || 'Business'}
            </p>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
              <span className={`rounded-full px-2 py-0.5 font-medium ${meta.color}`}>{meta.label}</span>
              <span>{r.progress ?? 0}%</span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">{fmtDateTime(r.started_at || r.created_date)}</p>
          </button>
        );
      })}
    </div>
  );
}