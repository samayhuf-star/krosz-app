import { Badge } from '@/components/ui/badge';

const TONE = { Organization: 'bg-slate-200 text-slate-700', LocalBusiness: 'bg-rose-100 text-rose-800', Service: 'bg-emerald-100 text-emerald-800', FAQ: 'bg-sky-100 text-sky-800', Review: 'bg-amber-100 text-amber-800', Article: 'bg-violet-100 text-violet-800', Breadcrumb: 'bg-cyan-100 text-cyan-800', Person: 'bg-fuchsia-100 text-fuchsia-800', Product: 'bg-indigo-100 text-indigo-800', Video: 'bg-pink-100 text-pink-800', Event: 'bg-orange-100 text-orange-800' };

export default function SchemaPanel({ schemas }) {
  if (!schemas?.length) return <p className="text-sm text-slate-500">No schema definitions.</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {schemas.map((s, i) => (
        <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={TONE[s.schema_type] || 'bg-slate-100'}>{s.schema_type}</Badge>
            <span className="text-[10px] uppercase text-slate-400">{s.scope}</span>
          </div>
          <p className="mt-2 font-mono text-xs text-slate-500">{s.page_slug ? `/${s.page_slug}` : 'global'}</p>
          {s.relevance && <p className="mt-1 text-sm text-slate-600">{s.relevance}</p>}
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-emerald-200"><code>{JSON.stringify(s.schema_data, null, 2)}</code></pre>
        </div>
      ))}
    </div>
  );
}