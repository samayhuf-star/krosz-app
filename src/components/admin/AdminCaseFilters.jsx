import { Search, RotateCcw } from 'lucide-react';

const STATES = ['DRAFT', 'INTAKE', 'ELIGIBILITY_REVIEW', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_REVIEW', 'READY_FOR_SUBMISSION', 'REVIEW_REQUIRED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PROCESSING', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED'];
const EC = ['GUIDANCE_ONLY', 'INTELLIGENCE_ONLY', 'PARTIAL_ASSIST', 'DOCUMENT_ASSIST', 'APPLICATION_ASSIST', 'END_TO_END', 'UNKNOWN'];
const PRI = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export default function AdminCaseFilters({ filters, onChange, search, onSearch, onReset }) {
  const set = (k, v) => v ? onChange({ ...filters, [k]: v }) : onChange({ ...filters, [k]: undefined });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">Search (case id, traveler name/email)</span>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
            <Search size={14} className="text-slate-400" />
            <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search…" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <span className="mt-1 block text-[10px] text-slate-400">Case id is exact; traveler fields search within the page.</span>
        </label>
        <Sel label="Case state" value={filters.case_state} options={STATES} onChange={(v) => set('case_state', v)} />
        <Sel label="Execution capability" value={filters.execution_capability} options={EC} onChange={(v) => set('execution_capability', v)} />
        <Sel label="Priority" value={filters.ops_priority} options={PRI} onChange={(v) => set('ops_priority', v)} />
        <Sel label="Review status" value={filters.review_status} options={['open', 'approved', 'none']} onChange={(v) => set('review_status', v)} />
        <Sel label="Payment status" value={filters.payment_status} options={['paid', 'pending', 'none']} onChange={(v) => set('payment_status', v)} />
        <Sel label="Action required" value={filters.action_required ? 'yes' : ''} options={['yes']} onChange={(v) => set('action_required', v === 'yes' ? true : undefined)} />
        <Sel label="Overdue (operational)" value={filters.overdue ? 'yes' : ''} options={['yes']} onChange={(v) => set('overdue', v === 'yes' ? true : undefined)} />
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">Destination</span>
          <input value={filters.destination || ''} onChange={(e) => set('destination', e.target.value.toUpperCase())} placeholder="e.g. TH" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">Provider key</span>
          <input value={filters.provider || ''} onChange={(e) => set('provider', e.target.value)} placeholder="e.g. GOV_TH" className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500" />
        </label>
        <label className="col-span-1 flex items-end">
          <button onClick={onReset} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><RotateCcw size={14} /> Reset filters</button>
        </label>
      </div>
    </div>
  );
}

function Sel({ label, value, options, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-emerald-500">
        <option value="">Any</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}