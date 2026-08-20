import { Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const TYPE_TONE = {
  blog: 'bg-emerald-100 text-emerald-700',
  landing_page: 'bg-blue-100 text-blue-700',
  faq: 'bg-violet-100 text-violet-700',
  case_study: 'bg-amber-100 text-amber-700',
  testimonial: 'bg-pink-100 text-pink-700',
  guide: 'bg-cyan-100 text-cyan-700',
  comparison: 'bg-orange-100 text-orange-700',
  pricing: 'bg-rose-100 text-rose-700',
  industry: 'bg-indigo-100 text-indigo-700',
  seasonal: 'bg-teal-100 text-teal-700',
};

export default function ContentOpportunitiesPanel({ opportunities }) {
  const list = opportunities || [];
  if (!list.length) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No content opportunities generated.</div>;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700"><Lightbulb size={16} className="text-emerald-700" />Content Opportunities · {list.length}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((o, idx) => (
          <div key={o.id || idx} className="flex flex-col rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-slate-900">{o.title}</p>
              <Badge variant="outline" className={`shrink-0 border-transparent capitalize ${TYPE_TONE[o.type] || 'bg-slate-100 text-slate-700'}`}>{o.type.replace('_', ' ')}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">/{o.slug} · <span className="font-medium text-slate-600">{o.keyword}</span></p>
            {o.description && <p className="mt-2 text-sm leading-6 text-slate-600">{o.description}</p>}
            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-xs text-slate-400">
              <Badge variant="outline" className="border-slate-300 capitalize text-slate-500">{o.intent}</Badge>
              {o.target_cluster && <span>· {o.target_cluster}</span>}
              <span>· priority {o.priority ?? '—'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}