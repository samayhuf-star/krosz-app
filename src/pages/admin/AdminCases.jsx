import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, ChevronRight, Download } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { adminCaseList, adminExport } from '@/lib/adminCaseApi';
import AdminCaseFilters from '@/components/admin/AdminCaseFilters';
import AdminCaseSummary from '@/components/admin/AdminCaseSummary';
import { stateTone, ecTone, priorityTone } from '@/components/admin/adminChips';

export default function AdminCases() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const q = useQuery({
    queryKey: ['admin-cases', filters, search, offset],
    queryFn: () => adminCaseList({ filters: { ...filters, search }, limit, offset }),
    placeholderData: (previousData = { cases: [], total: 0, summary: {} }) => previousData,
  });

  const cases = q.data?.cases || [];
  const total = q.data?.total || 0;
  const summary = q.data?.summary || {};

  const onExport = async (format) => {
    const res = await adminExport({ format, filters });
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(res.rows, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'cases.json'; a.click(); URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([res.csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'cases.csv'; a.click(); URL.revokeObjectURL(url);
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Phase 29 · Admin control plane" title="Case Management"
        description="Find, inspect, and action traveler application cases. All mutations go through the Phase 27 Application Case Engine — the UI never mutates case state directly."
        action={<div className="flex gap-2">
          <button onClick={() => onExport('csv')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Download size={14} /> CSV</button>
          <button onClick={() => onExport('json')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Download size={14} /> JSON</button>
        </div>} />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        <AdminCaseSummary summary={summary} />

        <AdminCaseFilters filters={filters} onChange={(p) => { setFilters(p); setOffset(0); }} search={search} onSearch={(s) => { setSearch(s); setOffset(0); }} onReset={() => { setFilters({}); setSearch(''); setOffset(0); }} />

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {['Case', 'Traveler', 'Destination', 'Journey', 'State', 'Normalized', 'Execution', 'Provider', 'Owner', 'Priority', 'Payment', 'Updated', 'Next action', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.isLoading && <tr><td colSpan={14} className="px-3 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
              {!q.isLoading && cases.length === 0 && <tr><td colSpan={14} className="px-3 py-10 text-center text-slate-400">No cases match these filters.</td></tr>}
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{c.id.slice(-8)}</td>
                  <td className="px-3 py-2.5 text-slate-700">{c.traveler_id?.slice(-6) || '—'}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{c.destination}</td>
                  <td className="px-3 py-2.5 text-slate-600">{c.journey}</td>
                  <td className="px-3 py-2.5"><Chip tone={stateTone(c.case_status)} label={c.state_label || c.case_status} /></td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{c.normalized_status}</td>
                  <td className="px-3 py-2.5"><Chip tone={ecTone(c.execution_capability)} label={(c.execution_capability || '').replace('_', ' ')} /></td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{c.provider || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{c.ops_owner_id ? c.ops_owner_id.slice(-6) : <span className="text-amber-600">Unassigned</span>}</td>
                  <td className="px-3 py-2.5"><Chip tone={priorityTone(c.ops_priority)} label={c.ops_priority} /></td>
                  <td className="px-3 py-2.5 text-xs">{c.paid_at ? <span className="text-emerald-700">Paid</span> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{new Date(c.updated_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{c.next_action?.label}</td>
                  <td className="px-3 py-2.5"><Link to={`/admin/cases/${c.id}`} className="inline-flex items-center text-emerald-700 hover:underline">Open <ChevronRight size={14} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>Showing {cases.length} of {total} (page {Math.floor(offset / limit) + 1})</span>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Prev</button>
            <button onClick={() => setOffset(offset + limit)} disabled={cases.length < limit} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ tone, label }) {
  const map = { emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', rose: 'bg-rose-50 text-rose-700', slate: 'bg-slate-100 text-slate-600', blue: 'bg-blue-50 text-blue-700', violet: 'bg-violet-50 text-violet-700' };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${map[tone] || map.slate}`}>{label}</span>;
}