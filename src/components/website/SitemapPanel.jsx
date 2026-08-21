import { Badge } from '@/components/ui/badge';

const TONE = { home: 'bg-emerald-100 text-emerald-800', service_detail: 'bg-violet-100 text-violet-800', services_overview: 'bg-violet-100 text-violet-800', pricing: 'bg-amber-100 text-amber-800', faq: 'bg-sky-100 text-sky-800', contact: 'bg-rose-100 text-rose-800', legal: 'bg-slate-200 text-slate-700', blog_landing: 'bg-cyan-100 text-cyan-800', blog_category: 'bg-cyan-100 text-cyan-800' };

export default function SitemapPanel({ pages }) {
  if (!pages?.length) return <p className="text-sm text-slate-500">No pages.</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="hidden grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid">
        <div className="col-span-4">Page</div><div className="col-span-3">Slug</div><div className="col-span-2">Template</div><div className="col-span-1">Pri.</div><div className="col-span-2">Intent</div>
      </div>
      <ul className="divide-y divide-slate-100">
        {pages.map((p) => (
          <li key={p.id} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-12 sm:items-center sm:gap-2">
            <div className="col-span-4">
              <p className="font-medium text-slate-900">{p.title}</p>
              <p className="text-xs text-slate-500">{p.purpose}</p>
            </div>
            <div className="col-span-3 font-mono text-xs text-slate-600">{p.slug}</div>
            <div className="col-span-2"><Badge variant="outline" className={TONE[p.template] || 'bg-slate-100 text-slate-700'}>{p.template}</Badge></div>
            <div className="col-span-1 text-xs text-slate-500">{p.priority ?? '—'}</div>
            <div className="col-span-2 text-xs text-slate-500">{p.seo_intent || '—'}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}