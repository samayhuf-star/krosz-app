import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Component, Search, Link2, FileText } from 'lucide-react';

function ComponentBlock({ c }) {
  const p = c.properties || {};
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-emerald-700">{c.component_key}</p>
        <Badge variant="outline" className="text-[10px]">#{c.order} {c.visible === false ? '· hidden' : ''}</Badge>
      </div>
      <p className="text-sm font-medium text-slate-900">{c.name}</p>
      {p.headline && <p className="mt-1 text-sm font-semibold text-slate-800">{p.headline}</p>}
      {p.subheadline && <p className="text-xs text-slate-600">{p.subheadline}</p>}
      {p.body && <p className="mt-1 text-sm text-slate-600">{p.body}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {p.cta_text && <Badge variant="secondary">CTA: {p.cta_text}</Badge>}
        {p.internal_links?.length ? <Badge variant="outline" className="text-[10px]">links: {p.internal_links.join(', ')}</Badge> : null}
      </div>
      {p.faq?.length ? (
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {p.faq.slice(0, 3).map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function PageRow({ page }) {
  const [open, setOpen] = useState(false);
  const seo = page.seo || {};
  return (
    <li className="border-b border-slate-100 last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{page.title}</p>
          <p className="font-mono text-xs text-slate-500">/{page.slug} · {page.components?.length || 0} components</p>
        </div>
        <Badge variant="outline" className="text-[10px]">{page.template}</Badge>
        {page.primary_cta && <Badge variant="secondary" className="hidden text-[10px] sm:inline-flex">{page.primary_cta}</Badge>}
      </button>
      {open && (
        <div className="space-y-4 bg-slate-50/50 px-4 py-4">
          {page.purpose && <p className="text-sm text-slate-600"><FileText size={13} className="mr-1 inline text-slate-400" />{page.purpose}</p>}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Component size={13} /> Components</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(page.components || []).map((c, i) => <ComponentBlock key={i} c={c} />)}
            </div>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Search size={13} /> SEO</p>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium text-slate-900">{seo.seo_title || '—'}</p>
              <p className="text-slate-600">{seo.meta_description || '—'}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px]">canonical: {seo.canonical || page.url}</Badge>
                <Badge variant="outline" className="text-[10px]">robots: {seo.robots || '—'}</Badge>
                {seo.internal_links?.length ? <Badge variant="outline" className="text-[10px]"><Link2 size={10} className="mr-1" />{seo.internal_links.join(', ')}</Badge> : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export default function PagesPanel({ pages }) {
  if (!pages?.length) return <p className="text-sm text-slate-500">No pages.</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <ul>{pages.map((p) => <PageRow key={p.id} page={p} />)}</ul>
    </div>
  );
}