import { Badge } from '@/components/ui/badge';
import { Lightbulb, FileText, Link2 } from 'lucide-react';

export default function ClustersPanel({ clusters, locationPages }) {
  if (!clusters?.length && !locationPages?.length) return <p className="text-sm text-slate-500">No clusters.</p>;
  return (
    <div className="space-y-5">
      {clusters?.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {clusters.map((c, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">{c.topic}</h3>
                <Badge variant="outline" className="border-slate-300 text-slate-600">priority {c.priority ?? '—'}</Badge>
              </div>
              <p className="mt-1 font-mono text-xs text-emerald-700">pillar: {c.pillar_keyword}</p>
              {c.description && <p className="mt-2 text-sm text-slate-600">{c.description}</p>}
              {c.supporting_pages?.length ? <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supporting pages</p><div className="mt-1 flex flex-wrap gap-1.5">{c.supporting_pages.map((s, j) => <Badge key={j} variant="secondary" className="font-mono text-[10px]">{s}</Badge>)}</div></div> : null}
              {c.internal_links?.length ? <div className="mt-2"><p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500"><Link2 size={11} /> Internal links</p><div className="mt-1 flex flex-wrap gap-1.5">{c.internal_links.map((s, j) => <Badge key={j} variant="outline" className="font-mono text-[10px]">{s}</Badge>)}</div></div> : null}
              {c.blog_topics?.length ? <div className="mt-2"><p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500"><FileText size={11} /> Blog topics</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{c.blog_topics.map((t, j) => <li key={j}>{t}</li>)}</ul></div> : null}
            </div>
          ))}
        </div>
      )}
      {locationPages?.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Lightbulb size={16} className="text-rose-600" /> Local SEO — recommended location pages</h3>
          <ul className="mt-3 space-y-2">
            {locationPages.map((p, i) => (
              <li key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{p.title}</p>
                  <Badge variant="outline" className="font-mono text-[10px]">/{p.slug}</Badge>
                </div>
                <p className="text-xs text-slate-500">keyword: <span className="font-mono">{p.keyword}</span> · intent {p.intent}</p>
                {p.business_value && <p className="mt-1 text-sm text-slate-600">{p.business_value}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}