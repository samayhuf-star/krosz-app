// Worldz Visa (Phase 23 §28) — Country x Provider x Execution Capability Matrix table.
import { useMemo, useState } from 'react';
import { Search, Download } from 'lucide-react';
import { JOURNEY_LABEL, AUTOMATION_LABEL, STATUS_TONE, AV_TONE, VERIF_TONE, EXEC_LABEL, Chip } from './matrixShared';

const JOURNEYS = ['VISA_FREE', 'VISA_ON_ARRIVAL', 'ETA', 'EVISA', 'OTHER_LOW_FRICTION', 'EMBASSY_VISA', 'CONSULAR_VISA', 'TRANSIT_VISA', 'OTHER'];
const AUTOMATIONS = ['FULLY_AUTOMATED', 'SEMI_AUTOMATED', 'GUIDED', 'MANUAL', 'UNSUPPORTED'];
const VERIF_STATES = ['INVENTORIED', 'RESEARCHING', 'PARTIALLY_VERIFIED', 'VERIFIED', 'STALE', 'BLOCKED', 'NEEDS_REVIEW'];
const EXEC_STATES = ['GUIDANCE_ONLY', 'INTELLIGENCE_ONLY', 'PARTIAL_ASSIST', 'DOCUMENT_ASSIST', 'APPLICATION_ASSIST', 'END_TO_END'];

export default function MatrixTab({ report, idMap, busy, onSelect, onPublish, onSuspend, onExport }) {
  const [q, setQ] = useState('');
  const [j, setJ] = useState('');
  const [a, setA] = useState('');
  const [api, setApi] = useState('');
  const [mcp, setMcp] = useState('');
  const [vstat, setVstat] = useState('');
  const [ex, setEx] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);

  const rows = useMemo(() => {
    if (!report?.rows) return [];
    return report.rows.filter((r) => {
      if (q && !r.country_code.includes(q.toUpperCase())) return false;
      if (j && r.journey_type !== j) return false;
      if (a && r.automation !== a) return false;
      if (api && r.api_available !== api) return false;
      if (mcp && r.mcp_available !== mcp) return false;
      if (vstat && r.verification_status !== vstat) return false;
      if (ex && r.execution_capability !== ex) return false;
      if (staleOnly && !r.stale) return false;
      return true;
    });
  }, [report, q, j, a, api, mcp, vstat, ex, staleOnly]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by country…" className="w-56 rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm" />
        </div>
        <Select value={j} onChange={setJ} placeholder="All journeys" options={JOURNEYS.map((x) => [x, JOURNEY_LABEL[x] || x])} />
        <Select value={a} onChange={setA} placeholder="All automation" options={AUTOMATIONS.map((x) => [x, AUTOMATION_LABEL[x]])} />
        <Select value={api} onChange={setApi} placeholder="API" options={[['YES', 'API: yes'], ['NO', 'API: no'], ['UNKNOWN', 'API: unknown']]} />
        <Select value={mcp} onChange={setMcp} placeholder="MCP" options={[['YES', 'MCP: yes'], ['NO', 'MCP: no'], ['UNKNOWN', 'MCP: unknown']]} />
        <Select value={vstat} onChange={setVstat} placeholder="All verification" options={VERIF_STATES.map((x) => [x, x])} />
        <Select value={ex} onChange={setEx} placeholder="All execution" options={EXEC_STATES.map((x) => [x, EXEC_LABEL[x]])} />
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} /> Stale only</label>
        <button onClick={onExport} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Download size={14} /> Export</button>
        <span className="text-xs text-slate-400">{rows.length} rows</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Country</th><th className="p-3">Journey</th><th className="p-3">Visa</th><th className="p-3">App</th>
              <th className="p-3">Verification</th><th className="p-3">Execution</th><th className="p-3">Class</th>
              <th className="p-3">API</th><th className="p-3">MCP</th><th className="p-3">Submission</th><th className="p-3">Tracking</th>
              <th className="p-3">Appt</th><th className="p-3">Automation</th><th className="p-3">Source</th><th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.country_code} className={`cursor-pointer hover:bg-slate-50/60 ${r.stale ? 'bg-orange-50/40' : ''}`} onClick={() => onSelect(r)}>
                <td className="p-3 font-semibold text-slate-900">{r.country_code}</td>
                <td className="p-3 text-slate-600">{JOURNEY_LABEL[r.journey_type] || r.journey_type || '—'}</td>
                <td className="p-3 text-slate-600">{r.visa_required ? 'Yes' : 'No'}</td>
                <td className="p-3 text-slate-600">{r.application_required}</td>
                <td className="p-3"><Chip value={r.verification_status} items={VERIF_TONE} />{r.stale && <span className="ml-1 text-[10px] text-orange-600">stale</span>}</td>
                <td className="p-3 text-xs text-slate-600">{EXEC_LABEL[r.execution_capability] || r.execution_capability || '—'}</td>
                <td className="p-3 text-xs text-slate-600">{r.verification_class || r.final_classification}</td>
                <td className="p-3"><Chip value={r.api_available} items={AV_TONE} /></td>
                <td className="p-3"><Chip value={r.mcp_available} items={AV_TONE} /></td>
                <td className="p-3 text-xs text-slate-600">{r.submission_capability}</td>
                <td className="p-3 text-xs text-slate-600">{r.tracking_capability}</td>
                <td className="p-3 text-xs text-slate-600">{r.appointment_requirement}</td>
                <td className="p-3 text-xs text-slate-600">{AUTOMATION_LABEL[r.automation] || r.automation}</td>
                <td className="p-3 max-w-[160px] truncate text-xs text-slate-500">{r.source_name || '—'}</td>
                <td className="p-3"><Chip value={r.status} items={STATUS_TONE} /></td>
                <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                  {r.status !== 'PUBLISHED' && <button onClick={() => onPublish(idMap[r.country_code])} disabled={busy} className="rounded border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] font-medium text-orange-700 hover:bg-orange-100">Publish</button>}
                  {r.status !== 'SUSPENDED' && <button onClick={() => onSuspend(idMap[r.country_code])} disabled={busy} className="ml-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700 hover:bg-rose-100">Suspend</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={16} className="p-8 text-center text-slate-400">No capabilities match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Select({ value, onChange, placeholder, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-700">
      <option value="">{placeholder}</option>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}