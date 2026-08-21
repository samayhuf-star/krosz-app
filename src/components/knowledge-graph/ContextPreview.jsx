import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

function Section({ title, children, count }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-slate-900">{title}{count != null && <span className="ml-2 text-xs font-normal text-slate-400">({count})</span>}</span>
        {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-3">{children}</div>}
    </div>
  );
}

function Chips({ items }) {
  if (!items?.length) return <p className="text-xs text-slate-400">None</p>;
  return <div className="flex flex-wrap gap-1.5">{items.map((it, i) => <span key={i} className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">{typeof it === 'string' ? it : it.label || it.name || it.keyword || it.title}</span>)}</div>;
}

export default function ContextPreview({ context }) {
  if (!context) return <p className="text-sm text-slate-400">No context. Rebuild the graph to generate the unified business context snapshot.</p>;
  const c = context;
  return (
    <div className="space-y-4">
      <Section title="Business" >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div><dt className="text-slate-400">Name</dt><dd className="font-medium text-slate-800">{c.business?.name}</dd></div>
          <div><dt className="text-slate-400">Industry</dt><dd className="font-medium text-slate-800">{c.business?.industry}</dd></div>
          <div><dt className="text-slate-400">Location</dt><dd className="font-medium text-slate-800">{[c.business?.city, c.business?.country].filter(Boolean).join(', ')}</dd></div>
          <div><dt className="text-slate-400">Contact</dt><dd className="font-medium text-slate-800">{c.business?.contact_email || c.business?.contact_phone || '—'}</dd></div>
        </dl>
      </Section>
      <Section title="Services" count={c.services?.length}><Chips items={c.services} /></Section>
      <Section title="Target audience" count={c.target_audience?.length}><Chips items={c.target_audience} /></Section>
      <Section title="Lead sources" count={c.lead_sources?.length}><Chips items={c.lead_sources} /></Section>
      <Section title="Locations" count={c.locations?.length}><Chips items={c.locations} /></Section>
      <Section title="Domain" >
        {c.domain ? <p className="text-xs font-medium text-slate-800">{c.domain.domain_name} <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 capitalize text-slate-500">{c.domain.status}</span></p> : <p className="text-xs text-slate-400">No domain registered</p>}
      </Section>
      <Section title="Pipeline stages" count={c.pipeline_stages?.length}>
        <ol className="space-y-1">
          {(c.pipeline_stages || []).map((s, i) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">{i + 1}</span>
              <span className="font-medium text-slate-800">{s.name}</span>
              {s.owner_role && <span className="text-slate-400">· {s.owner_role}</span>}
              {s.probability != null && <span className="text-slate-400">· {s.probability}%</span>}
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Pages" count={c.pages?.length}>
        <ul className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
          {(c.pages || []).map((p) => (
            <li key={p.slug} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1">
              <span className="truncate font-medium text-slate-700">/{p.slug}</span>
              {p.primary_keyword && <span className="ml-2 truncate text-slate-400">{p.primary_keyword}</span>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Top keywords" count={c.keywords?.length}><Chips items={c.keywords} /></Section>
      <Section title="Topic clusters" count={c.clusters?.length}><Chips items={(c.clusters || []).map((x) => x.topic)} /></Section>
      <Section title="Content opportunities" count={c.content_opportunities?.length}>
        <ul className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
          {(c.content_opportunities || []).map((o) => (
            <li key={o.slug} className="rounded-md bg-slate-50 px-2 py-1">
              <span className="rounded bg-emerald-100 px-1 text-[10px] font-semibold uppercase text-emerald-700">{o.type}</span>
              <span className="ml-2 font-medium text-slate-700">{o.title}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}