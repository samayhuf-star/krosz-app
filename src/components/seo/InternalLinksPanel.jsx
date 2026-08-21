import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';

export default function InternalLinksPanel({ links }) {
  if (!links?.length) return <p className="text-sm text-slate-500">No internal links recommended.</p>;
  const broken = links.filter((l) => l.status === 'broken').length;
  return (
    <div className="space-y-4">
      {broken > 0 && <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{broken} broken link(s) detected — targets a page not in the published sitemap.</p>}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid">
          <div className="col-span-4">Source</div><div className="col-span-4">Target</div><div className="col-span-3">Anchor</div><div className="col-span-1">Type</div>
        </div>
        <ul className="divide-y divide-slate-100">
          {links.map((l, i) => (
            <li key={i} className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-12 sm:items-center sm:gap-2">
              <div className="col-span-4 font-mono text-xs text-slate-700">/{l.source_page_slug}</div>
              <div className="col-span-4 flex items-center gap-1 font-mono text-xs"><ArrowRight size={12} className="text-slate-400" /><span className={l.status === 'broken' ? 'text-rose-600' : 'text-emerald-700'}>/{l.target_page_slug}</span></div>
              <div className="col-span-3 truncate text-xs text-slate-600" title={l.anchor_text}>{l.anchor_text || '—'}</div>
              <div className="col-span-1"><Badge variant="outline" className="text-[10px]">{l.link_type}</Badge></div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}