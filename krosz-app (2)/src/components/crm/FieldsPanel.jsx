import { Boxes, UserSquare2, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

function FieldRow({ f }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800"><code className="text-xs text-slate-500">{f.key}</code> · {f.label}</p>
        {f.hint && <p className="truncate text-xs text-slate-500">{f.hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="outline" className="border-slate-300 text-slate-600">{f.type}</Badge>
        {f.required ? <Badge className="bg-rose-100 text-rose-700">required</Badge> : <span className="text-xs text-slate-400">optional</span>}
        {f.options?.length > 0 && <span className="text-xs text-slate-400">{f.options.length} options</span>}
      </div>
    </li>
  );
}

export default function FieldsPanel({ crmBlueprint }) {
  const leadFields = crmBlueprint?.lead_fields || [];
  const sections = crmBlueprint?.contact_profile?.sections || [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700"><Tag size={16} className="text-emerald-700" />Custom Lead Fields · {leadFields.length}</h3>
        <p className="mb-4 text-xs text-slate-500">Industry-specific lead attributes generated from the approved Blueprint.</p>
        {leadFields.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">{leadFields.map((f) => <FieldRow key={f.key} f={f} />)}</ul>
        ) : <p className="text-sm text-slate-400">No lead fields generated.</p>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700"><UserSquare2 size={16} className="text-emerald-700" />Contact Profile Model · {sections.length} sections</h3>
        <p className="mb-4 text-xs text-slate-500">The customer profile structure tailored to this business.</p>
        {sections.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {sections.map((s) => (
              <div key={s.name} className="rounded-xl border border-slate-200 p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Boxes size={14} className="text-slate-400" />{s.name}</p>
                <ul className="space-y-2">{(s.fields || []).map((f) => <FieldRow key={f.key} f={f} />)}</ul>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-400">No contact profile generated.</p>}
      </div>
    </div>
  );
}