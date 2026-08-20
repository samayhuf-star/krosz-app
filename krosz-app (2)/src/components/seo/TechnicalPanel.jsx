import { Badge } from '@/components/ui/badge';
import { AlertTriangle, AlertCircle, FileCode, Gauge } from 'lucide-react';

function List({ title, items, icon: Icon, tone }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon size={15} className="text-emerald-600" /> {title} <Badge variant="secondary" className="text-[10px]">{items.length}</Badge></p>
      <ul className="mt-2 space-y-1 text-sm text-slate-600">
        {items.map((it, i) => <li key={i} className="rounded-md bg-slate-50 px-2 py-1 font-mono text-xs">{typeof it === 'string' ? it : JSON.stringify(it)}</li>)}
      </ul>
    </div>
  );
}

export default function TechnicalPanel({ technical }) {
  if (!technical) return <p className="text-sm text-slate-500">No technical SEO report.</p>;
  const t = technical, s = t.summary || {};
  const cards = [
    { label: 'Sitemap entries', value: s.sitemap_entries ?? 0 },
    { label: 'Canonical issues', value: s.canonical_issues ?? 0, tone: s.canonical_issues ? 'text-rose-600' : '' },
    { label: 'Duplicate titles', value: s.duplicate_titles ?? 0, tone: s.duplicate_titles ? 'text-rose-600' : '' },
    { label: 'Duplicate descriptions', value: s.duplicate_descriptions ?? 0, tone: s.duplicate_descriptions ? 'text-rose-600' : '' },
    { label: 'Broken links', value: s.broken_links ?? 0, tone: s.broken_links ? 'text-rose-600' : '' },
    { label: 'Missing H1', value: s.missing_h1 ?? 0, tone: s.missing_h1 ? 'text-amber-600' : '' },
    { label: 'Missing ALT', value: s.missing_alt ?? 0, tone: s.missing_alt ? 'text-amber-600' : '' },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p><p className={`mt-1 text-2xl font-semibold text-slate-900 ${c.tone || ''}`}>{c.value}</p></div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><FileCode size={15} className="text-emerald-600" /> robots.txt</p>
          <pre className="overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-emerald-200"><code>{t.robots_txt}</code></pre>
          <p className="mb-1 mt-4 text-sm font-semibold text-slate-900">Sitemap ({t.sitemap?.length || 0})</p>
          <ul className="max-h-40 space-y-1 overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-xs">
            {t.sitemap?.map((u, i) => <li key={i} className="font-mono text-slate-600">{u.url} <span className="text-slate-400">· pri {u.priority} · {u.changefreq}</span></li>)}
          </ul>
        </div>
        <div className="space-y-3">
          <List title="Canonical issues" items={t.canonical_issues} icon={AlertCircle} />
          <List title="Duplicate titles" items={t.duplicate_titles} icon={AlertTriangle} />
          <List title="Duplicate descriptions" items={t.duplicate_descriptions} icon={AlertTriangle} />
          <List title="Broken links" items={t.broken_links} icon={AlertCircle} />
          <List title="Missing H1" items={t.missing_h1} icon={AlertTriangle} />
          <List title="Missing alt text" items={t.missing_alt} icon={AlertTriangle} />
          <List title="Accessibility recommendations" items={t.accessibility} icon={Gauge} />
          <List title="Page speed recommendations" items={t.page_speed} icon={Gauge} />
          <List title="Core Web Vitals" items={t.core_web_vitals} icon={Gauge} />
        </div>
      </div>
    </div>
  );
}