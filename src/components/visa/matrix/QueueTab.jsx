// Worldz Visa (Phase 23 §31/§40D) — Research queue for non-published countries.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { STATUS_TONE, JOURNEY_LABEL, AUTOMATION_LABEL, CLASS_LABEL, CONF_LABEL, Chip } from './matrixShared';

const QUEUE_STATES = ['NOT_STARTED', 'RESEARCHING', 'DATA_FOUND', 'CROSS_CHECKING', 'CONFLICT', 'READY_FOR_REVIEW', 'VERIFIED', 'PUBLISHED'];
const CONF = ['VERIFIED', 'CROSS_CHECKED', 'SINGLE_SOURCE', 'CONFLICT', 'STALE', 'UNKNOWN'];
const CLASS = ['A', 'B', 'C', 'D', 'E', 'UNKNOWN'];

export default function QueueTab({ report, idMap, busy, onSave, onSelect }) {
  const [filter, setFilter] = useState('');
  const [state, setState] = useState('');
  const rows = useMemo(() => {
    if (!report?.rows) return [];
    return report.rows.filter((r) => r.research_status !== 'PUBLISHED')
      .filter((r) => !state || r.research_status === state)
      .filter((r) => !filter || r.country_code.includes(filter.toUpperCase()));
  }, [report, state, filter]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by country…" className="w-56 rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm" />
        </div>
        <select value={state} onChange={(e) => setState(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm">
          <option value="">All queue states</option>
          {QUEUE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-slate-400">{rows.length} destinations in research</span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.country_code} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between">
              <button onClick={() => onSelect(r)} className="text-left">
                <p className="font-semibold text-slate-900">{r.country_code}</p>
                <p className="text-[11px] text-slate-500">{JOURNEY_LABEL[r.journey_type] || r.journey_type || '—'} · {AUTOMATION_LABEL[r.automation] || r.automation}</p>
              </button>
              <Chip value={r.research_status} items={STATUS_TONE} />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Source: {r.source_name || 'pending'} · Conf: <Chip value={r.data_confidence} items={STATUS_TONE} /> · {CLASS_LABEL[r.final_classification] || r.final_classification}
            </div>
            <ResearchForm id={idMap[r.country_code]} disabled={busy} onSave={onSave} defaultState={r.research_status} defaultClass={r.final_classification} defaultConf={r.data_confidence} />
          </div>
        ))}
        {!rows.length && <p className="col-span-full py-10 text-center text-slate-400">The research queue is empty — all inventoried destinations are published.</p>}
      </div>
      <p className="mt-4 text-xs text-slate-400">Use this queue to systematically reach 100+ verified destinations. Set a status → verify source → publish. Conflict rows never auto-publish (§6/§26).</p>
    </div>
  );
}

function ResearchForm({ id, disabled, onSave, defaultState, defaultClass, defaultConf }) {
  const [state, setState] = useState(defaultState || 'RESEARCHING');
  const [conf, setConf] = useState(defaultConf || 'UNKNOWN');
  const [cls, setCls] = useState(defaultClass || 'UNKNOWN');
  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ capability_id: id, research_status: state, data_confidence: conf, final_classification: cls, research_assignee: assignee, research_notes: notes }); setAssignee(''); setNotes(''); }}
      className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2"
    >
      <div className="flex flex-wrap gap-1.5">
        <select value={state} onChange={(e) => setState(e.target.value)} className="rounded border border-slate-200 px-1.5 py-1 text-[11px]">
          {QUEUE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={conf} onChange={(e) => setConf(e.target.value)} className="rounded border border-slate-200 px-1.5 py-1 text-[11px]">
          {CONF.map((s) => <option key={s} value={s}>{CONF_LABEL[s]}</option>)}
        </select>
        <select value={cls} onChange={(e) => setCls(e.target.value)} className="rounded border border-slate-200 px-1.5 py-1 text-[11px]">
          {CLASS.map((s) => <option key={s} value={s}>{CLASS_LABEL[s]}</option>)}
        </select>
      </div>
      <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Assignee (email)" className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]" />
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Research note" className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]" />
      <button disabled={disabled} className="w-full rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50">Save research state</button>
    </form>
  );
}