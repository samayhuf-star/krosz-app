import { ChevronDown } from 'lucide-react';

// Static visual of the provider resolution hierarchy. An optional `activeLevel`
// highlights the level a given tenant actually resolved to.
const LEVELS = [
  { key: 'tenant_override', label: 'Tenant Override', desc: 'Highest priority — a provider pinned to one specific tenant.' },
  { key: 'reseller_override', label: 'Reseller Override', desc: 'Falls back to the white-label / reseller account the tenant belongs to.' },
  { key: 'platform_default', label: 'Platform Default', desc: 'The provider marked as default for the category.' },
  { key: 'platform_fallback', label: 'Platform Fallback', desc: 'Any other enabled provider in the category.' },
  { key: 'none', label: 'None', desc: 'No provider available — the operation cannot run.' },
];

export default function InheritanceChain({ activeLevel }) {
  return (
    <ol className="space-y-0">
      {LEVELS.map((lvl, i) => {
        const active = activeLevel === lvl.key;
        return (
          <li key={lvl.key}>
            <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{lvl.label}</p>
                <p className="text-xs leading-5 text-slate-500">{lvl.desc}</p>
              </div>
              {active && <span className="ml-auto self-center whitespace-nowrap text-xs font-semibold text-emerald-700">● Active</span>}
            </div>
            {i < LEVELS.length - 1 && (
              <div className="flex justify-center py-0.5"><ChevronDown size={16} className="text-slate-300" /></div>
            )}
          </li>
        );
      })}
    </ol>
  );
}