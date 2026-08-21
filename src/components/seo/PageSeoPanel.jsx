import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Search, Link2, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

function Row({ slug, data, isDraft, onSave }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(data.seo_title || '');
  const [desc, setDesc] = useState(data.meta_description || '');
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await onSave(slug, { seo_title: title, meta_description: desc }); } finally { setSaving(false); } };
  const og = data.open_graph || {}, tw = data.twitter_card || {};
  return (
    <li className="border-b border-slate-100 last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{data.title || slug}</p><p className="font-mono text-xs text-slate-500">/{slug} · {data.template}</p></div>
        <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">{data.search_intent}</Badge>
        {data.primary_keyword && <span className="hidden max-w-[12rem] truncate text-xs text-emerald-700 md:block">{data.primary_keyword}</span>}
      </button>
      {open && (
        <div className="space-y-3 bg-slate-50/50 px-4 py-4 text-sm">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            {isDraft ? (
              <div className="space-y-2">
                <div><label className="text-xs font-medium text-slate-500">SEO title (≤60)</label><Input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className="mt-1" /></div>
                <div><label className="text-xs font-medium text-slate-500">Meta description (≤160)</label><Textarea value={desc} maxLength={160} onChange={(e) => setDesc(e.target.value)} className="mt-1 min-h-[60px]" /></div>
                <Button size="sm" onClick={save} disabled={saving} className="bg-slate-900 hover:bg-slate-800">{saving ? 'Saving…' : 'Save metadata'}</Button>
              </div>
            ) : (
              <><p className="font-medium text-slate-900">{data.seo_title}</p><p className="text-slate-600">{data.meta_description}</p></>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px]"><Tag size={10} className="mr-1" />{data.primary_keyword || 'no primary kw'}</Badge>
              {(data.secondary_keywords || []).map((k, i) => <Badge key={i} variant="secondary" className="text-[10px]">{k}</Badge>)}
              <Badge variant="outline" className="text-[10px]">canonical: {data.canonical}</Badge>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="flex items-center gap-1 text-xs font-semibold uppercase text-slate-500"><Search size={11} /> Open Graph</p><p className="mt-1 text-sm text-slate-800">{og.title || '—'}</p><p className="text-xs text-slate-500">{og.description}</p></div>
            <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-semibold uppercase text-slate-500">Twitter card</p><p className="mt-1 text-sm text-slate-800">{tw.title || '—'}</p><p className="text-xs text-slate-500">{tw.description}</p></div>
          </div>
          {data.schemas?.length ? <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-semibold uppercase text-slate-500">Schema applied</p><div className="mt-1 flex flex-wrap gap-1.5">{data.schemas.map((s, i) => <Badge key={i} className="bg-indigo-100 text-indigo-800">{s}</Badge>)}</div></div> : null}
          {data.internal_links?.length ? <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="flex items-center gap-1 text-xs font-semibold uppercase text-slate-500"><Link2 size={11} /> Internal links</p><div className="mt-1 flex flex-wrap gap-1.5">{data.internal_links.map((l, i) => <Badge key={i} variant="outline" className="font-mono text-[10px]">{l.anchor_text || l.slug} → /{l.slug}</Badge>)}</div></div> : null}
        </div>
      )}
    </li>
  );
}

export default function PageSeoPanel({ pageSeo, isDraft, onSave }) {
  const entries = Object.entries(pageSeo || {});
  if (!entries.length) return <p className="text-sm text-slate-500">No page SEO data.</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {isDraft && <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">Draft version — expand any page to edit its SEO title & meta description.</p>}
      <ul>{entries.map(([slug, data]) => <Row key={slug} slug={slug} data={data} isDraft={isDraft} onSave={onSave} />)}</ul>
    </div>
  );
}