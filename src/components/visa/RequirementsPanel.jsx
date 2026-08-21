import { FileCheck2, ShieldAlert, ShieldCheck } from 'lucide-react';

const LEVEL_STYLE = {
  mandatory: 'bg-red-50 text-red-700',
  conditional: 'bg-amber-50 text-amber-700',
  optional: 'bg-slate-100 text-slate-500',
  recommended: 'bg-blue-50 text-blue-700',
  na: 'bg-slate-100 text-slate-400',
};

export default function RequirementsPanel({ data }) {
  if (!data || !data.version) {
    return (
      <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <p className="text-sm font-semibold text-slate-900">Requirements</p>
        <p className="mt-1 text-sm text-slate-500">No requirements graph found for this route.</p>
      </div>
    );
  }
  const { version, requirements = [], documents = [], rules = [], _provenance } = data;
  return (
    <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Requirements</p>
        <span className="inline-flex items-center gap-1 text-xs text-amber-700"><ShieldAlert size={13} /> Verification pending</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">Pinned to <span className="font-mono text-slate-500">{version.requirements_version}</span></p>

      <ul className="mt-4 space-y-2.5">
        {requirements.map((r, i) => (
          <li key={r.id || i} className="flex items-start gap-3">
            <FileCheck2 size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="text-sm text-slate-800">{r.title}</p>
              {r.description && <p className="text-xs text-slate-400">{r.description}</p>}
            </div>
            <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${LEVEL_STYLE[r.mandatory_level] || LEVEL_STYLE.mandatory}`}>{r.mandatory_level}</span>
          </li>
        ))}
      </ul>

      {documents.length > 0 && (
        <>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Documents to collect</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {documents.map((d, i) => (
              <span key={d.id || i} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                {d.name}
                {d.mandatory_level !== 'mandatory' && <span className="text-[10px] capitalize text-slate-400">· {d.mandatory_level}</span>}
              </span>
            ))}
          </div>
        </>
      )}

      {rules.length > 0 && (
        <>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Conditional rules</p>
          <ul className="mt-2 space-y-1">
            {rules.map((rl, i) => (
              <li key={rl.id || i} className="flex items-start gap-2 text-xs text-slate-500">
                <ShieldCheck size={13} className="mt-0.5 shrink-0 text-orange-600" />
                <span><span className="font-mono text-slate-600">{rl.rule_id}</span> — if <span className="font-medium text-slate-700">{rl.condition_field} {rl.operator} {rl.value}</span>, <span className="capitalize">{rl.applies_to_category}</span> becomes <span className="font-medium text-slate-700">{rl.effect}</span>.</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}