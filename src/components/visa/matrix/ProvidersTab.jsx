// Worldz Visa (Phase 23 §23/§37) — Provider matrix tab.
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { adminProviderList } from '@/lib/visaApi';
import { ABILITY_TONE, AV_TONE, Chip } from './matrixShared';

const PTYPE = ['VISA_INTELLIGENCE', 'VISA_APPLICATION', 'VISA_SUBMISSION', 'VISA_TRACKING', 'DOCUMENT_VALIDATION', 'PAYMENT', 'NOTIFICATION', 'GOVERNMENT_OFFICIAL'];

export default function ProvidersTab({ onSelect }) {
  const { data, isLoading } = useQuery({ queryKey: ['admin-provider-list'], queryFn: () => adminProviderList() });
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const rows = useMemo(() => {
    const list = data?.providers || [];
    return list.filter((p) => (!type || p.provider_type === type) && (!q || (p.key?.toLowerCase().includes(q.toLowerCase()) || (p.display_name || p.name || '').toLowerCase().includes(q.toLowerCase()))));
  }, [data, q, type]);

  if (isLoading) return <div className="py-20 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter providers…" className="w-56 rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm" />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm">
          <option value="">All types</option>
          {PTYPE.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <span className="text-xs text-slate-400">{rows.length} providers</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
            <tr>
              <th className="p-3">Provider</th><th className="p-3">Type</th><th className="p-3">MCP</th><th className="p-3">Commercial</th>
              <th className="p-3">Sandbox</th><th className="p-3">Production</th><th className="p-3">India</th><th className="p-3">Health</th><th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => onSelect(p)}>
                <td className="p-3"><p className="font-medium text-slate-900">{p.display_name || p.name}</p><p className="font-mono text-[10px] text-slate-400">{p.key}</p></td>
                <td className="p-3 text-xs text-slate-600">{(p.provider_type || p.category || '—').replace(/_/g, ' ')}</td>
                <td className="p-3"><Chip value={p.mcp_available ? 'YES' : 'NO'} items={ABILITY_TONE} /></td>
                <td className="p-3 text-xs text-slate-600">{p.commercial_model}</td>
                <td className="p-3"><Chip value={p.sandbox_available} items={AV_TONE} /></td>
                <td className="p-3"><Chip value={p.production_available} items={AV_TONE} /></td>
                <td className="p-3 text-xs text-slate-600">{p.india_coverage_score ?? 0}</td>
                <td className="p-3 text-xs text-slate-600">{p.health_status}</td>
                <td className="p-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] ${p.status === 'connected' || p.status === 'verified' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{p.status}</span></td>
                <td className="p-3 text-right text-xs text-orange-700">Detail →</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="p-8 text-center text-slate-400">No providers.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">Only validated providers populate this registry. Speculative providers stay out until vetted — never add a provider merely because it has a website (§23/§36).</p>
    </div>
  );
}