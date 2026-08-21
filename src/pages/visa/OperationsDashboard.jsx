import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { opsDashboard, opsListQueue } from '@/lib/visaApi';
import PageHeader from '@/components/app/PageHeader';
import { RefreshCw } from 'lucide-react';

const STATE_LABEL = {
  PREPARING: 'Preparing', READY_FOR_REVIEW: 'Ready for review', UNDER_REVIEW: 'Under review',
  READY_TO_SUBMIT: 'Ready to submit', SUBMISSION_IN_PROGRESS: 'Submitting', SUBMITTED: 'Submitted',
  SUBMISSION_CONFIRMED: 'Submission confirmed', PROCESSING: 'Processing', DECISION_RECEIVED: 'Decision received',
  COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled',
};

export default function OperationsDashboard() {
  const { user } = useAuth();
  const [dash, setDash] = useState(null);
  const [cases, setCases] = useState([]);
  const [filters, setFilters] = useState({ state: '', destination: '', review_state: '', priority: '' });
  const [err, setErr] = useState('');

  const load = () => {
    opsDashboard().then((r) => setDash(r)).catch((e) => setErr(e?.message));
    opsListQueue(filters).then((r) => setCases(r.cases || [])).catch((e) => setErr(e?.message));
  };
  useEffect(() => { if (user?.role === 'admin') load(); }, [user, JSON.stringify(filters)]);

  if (user?.role !== 'admin') return <div className="px-4 md:px-8 py-12 text-sm text-slate-500">Operations access required.</div>;

  const m = dash?.metrics || {};
  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Operations"
        description="Submission preparation, review queue, and tracking. Internal-only."
        action={<button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><RefreshCw size={14} /> Refresh</button>}
      />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
      {err && <p className="mb-4 text-sm text-rose-600">{err}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Metric label="Awaiting review" value={m.awaiting_review || 0} tone="amber" />
        <Metric label="Needs user action" value={m.needs_user_action || 0} tone="rose" />
        <Metric label="Ready to submit" value={m.ready_to_submit || 0} tone="emerald" />
        <Metric label="Submitting" value={m.submission_in_progress || 0} />
        <Metric label="Submitted" value={m.submitted || 0} tone="blue" />
        <Metric label="Processing" value={m.processing || 0} tone="indigo" />
        <Metric label="Decisions" value={m.decisions_received || 0} tone="violet" />
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-2">
        <Filter label="State" value={filters.state} onChange={(v) => setFilters({ ...filters, state: v })} options={Object.keys(STATE_LABEL)} />
        <Filter label="Review" value={filters.review_state} onChange={(v) => setFilters({ ...filters, review_state: v })} options={['UNASSIGNED', 'ASSIGNED', 'IN_REVIEW', 'REVIEWED', 'ESCALATED']} />
        <Filter label="Priority" value={filters.priority} onChange={(v) => setFilters({ ...filters, priority: v })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT']} />
        <input placeholder="Destination" value={filters.destination} onChange={(e) => setFilters({ ...filters, destination: e.target.value.toUpperCase() })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <button onClick={load} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Refresh</button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full">
          <thead className="bg-slate-50"><tr>{['Application', 'Destination', 'State', 'Review', 'QC', 'Score', 'Priority', 'Assigned'].map((h) => <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {cases.length === 0 && <tr><td className="px-4 py-6 text-sm text-slate-400" colSpan={8}>No cases match these filters.</td></tr>}
            {cases.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td><Link to={`/admin/operations/${c.id}`} className="font-medium text-orange-700 hover:underline">APP-{String(c.application_id).slice(-6).toUpperCase()}</Link></td>
                <td className="px-4 py-3 text-sm text-slate-700">{c.destination}</td>
                <td className="px-4 py-3 text-sm"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{STATE_LABEL[c.state] || c.state}</span></td>
                <td className="px-4 py-3 text-sm text-slate-600">{c.review_state}</td>
                <td className="px-4 py-3 text-sm"><QcBadge status={c.qc_status} /></td>
                <td className="px-4 py-3 text-sm text-slate-700">{c.quality_score != null ? `${c.quality_score}/100` : '—'}</td>
                <td className="px-4 py-3 text-sm"><PriorityBadge p={c.priority} /></td>
                <td className="px-4 py-3 text-sm text-slate-500">{c.assigned_to ? `User ${String(c.assigned_to).slice(-4)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-amber-700">Scores are internal submission-quality indicators, not visa-approval probabilities.</p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = '' }) {
  const tones = { amber: 'text-amber-700 bg-amber-50', rose: 'text-rose-700 bg-rose-50', emerald: 'text-orange-700 bg-orange-50', blue: 'text-blue-700 bg-blue-50', indigo: 'text-indigo-700 bg-indigo-50', violet: 'text-violet-700 bg-violet-50' };
  return <div className={`rounded-xl border border-slate-200 p-3 ${tone ? (tones[tone] || '') : ''}`}><p className="text-[11px] font-medium text-slate-500">{label}</p><p className="text-xl font-semibold text-slate-900">{value}</p></div>;
}
function Filter({ label, value, onChange, options }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">All</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
}
function QcBadge({ status }) {
  const tone = status === 'PASS' ? 'bg-orange-100 text-orange-700' : status === 'WARNING' ? 'bg-amber-100 text-amber-700' : status === 'BLOCKER' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status || '—'}</span>;
}
function PriorityBadge({ p }) {
  const tone = p === 'URGENT' ? 'bg-rose-100 text-rose-700' : p === 'HIGH' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{p}</span>;
}