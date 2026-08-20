import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';

const TONE = {
  seo: 'bg-emerald-50 text-emerald-700', website: 'bg-sky-50 text-sky-700', crm: 'bg-violet-50 text-violet-700',
  domain: 'bg-amber-50 text-amber-700', growth: 'bg-pink-50 text-pink-700', team: 'bg-indigo-50 text-indigo-700',
  support: 'bg-cyan-50 text-cyan-700', marketing: 'bg-rose-50 text-rose-700', automation: 'bg-lime-50 text-lime-700',
  other: 'bg-slate-100 text-slate-600',
};

export default function TodayRecommendations({ businessId, excludeTo }) {
  const q = useQuery({
    queryKey: ['home', 'recommendations', businessId, excludeTo || null],
    enabled: !!businessId,
    queryFn: async () => {
      const rows = await base44.entities.LaunchRecommendation.filter({ business_id: businessId }).catch(() => []);
      return (rows || [])
        .filter((r) => r.status === 'open' && r.action_target !== excludeTo)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .slice(0, 5);
    },
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={15} className="text-violet-600" />
        <h3 className="text-sm font-semibold text-slate-900">Recommended next</h3>
      </div>
      {q.isLoading ? <div className="flex items-center gap-2 text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        : q.data && q.data.length === 0 ? <p className="text-sm text-slate-500">No recommendations right now. Publish your website and SEO to unlock growth tips.</p>
        : <ul className="space-y-2.5">
            {(q.data || []).map((r) => (
              <li key={r.id} className="flex items-start gap-3">
                <span className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TONE[r.category] || TONE.other}`}>{r.category}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{r.title}</p>
                  {r.rationale && <p className="text-xs text-slate-500">{r.rationale}</p>}
                </div>
                {r.action_target && <Link to={r.action_target} className="shrink-0 text-slate-400 hover:text-emerald-700"><ArrowRight size={15} /></Link>}
              </li>
            ))}
          </ul>}
    </div>
  );
}