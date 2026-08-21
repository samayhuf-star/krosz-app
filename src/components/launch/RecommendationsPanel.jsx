import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Lightbulb, RefreshCw, ArrowUpRight, Loader2 } from 'lucide-react';
import { launchApi } from '@/lib/launchApi';

const CATEGORY_STYLE = {
  seo: 'bg-violet-50 text-violet-700', website: 'bg-sky-50 text-sky-700', domain: 'bg-emerald-50 text-emerald-700',
  crm: 'bg-amber-50 text-amber-700', team: 'bg-indigo-50 text-indigo-700', automation: 'bg-fuchsia-50 text-fuchsia-700',
  growth: 'bg-teal-50 text-teal-700', support: 'bg-rose-50 text-rose-700', marketing: 'bg-orange-50 text-orange-700', other: 'bg-slate-100 text-slate-600',
};

export default function RecommendationsPanel({ plan }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['launch-recs', plan.id], queryFn: () => launchApi.recommendations(plan.id), enabled: plan.progress >= 60 || plan.status === 'completed' });
  const recs = data?.recommendations || [];

  if (plan.progress < 60) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">Recommendations appear once your launch is at least 60% complete. Keep going — the assistant will surface your best next moves.</div>;
  }
  if (isLoading) return <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto animate-spin" size={20} /></div>;
  if (!recs.length) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <Lightbulb className="mx-auto mb-2 text-amber-500" size={28} />
      <p className="text-slate-600">No recommendations yet.</p>
      <button onClick={async () => { await launchApi.report(plan.id); qc.invalidateQueries({ queryKey: ['launch-recs', plan.id] }); }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"><RefreshCw size={13} /> Compile launch report</button>
    </div>;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Prioritized next actions to grow and optimize your launched business.</p>
        <button onClick={async () => { await launchApi.recommendations(plan.id); qc.invalidateQueries({ queryKey: ['launch-recs', plan.id] }); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><RefreshCw size={13} /> Refresh</button>
      </div>
      {recs.map((r) => (
        <div key={r.key} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Lightbulb size={17} /></div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-900">{r.title}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${(CATEGORY_STYLE[r.category] || CATEGORY_STYLE.other)}`}>{r.category}</span>
              <span className="text-[11px] font-medium text-slate-400">priority {r.priority}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{r.rationale}</p>
          </div>
          {r.action_target && <Link to={r.action_target} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">{r.action_label || 'Open'} <ArrowUpRight size={13} /></Link>}
        </div>
      ))}
    </div>
  );
}