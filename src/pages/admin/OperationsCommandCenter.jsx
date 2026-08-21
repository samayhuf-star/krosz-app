import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { operationsCommandCenter, operationsReconciliation } from '@/lib/opsEngineApi';
import PageHeader from '@/components/app/PageHeader';
import { RefreshCw, AlertTriangle, ShieldAlert, Clock, Loader2 } from 'lucide-react';

const SLA_TONE = { HEALTHY: 'bg-emerald-50 text-emerald-700', DUE_SOON: 'bg-amber-50 text-amber-700', OVERDUE: 'bg-orange-50 text-orange-700', CRITICAL: 'bg-rose-50 text-rose-700', 'N/A': 'bg-slate-100 text-slate-500' };
const OWNER_TONE = {
  CUSTOMER: 'bg-blue-50 text-blue-700', KROSZ_AUTOMATION: 'bg-slate-100 text-slate-600',
  KROSZ_REVIEWER: 'bg-orange-50 text-orange-700', KROSZ_SUPPORT: 'bg-violet-50 text-violet-700',
  EXTERNAL_PROVIDER: 'bg-slate-100 text-slate-600', GOVERNMENT: 'bg-indigo-50 text-indigo-700', SYSTEM: 'bg-slate-100 text-slate-500',
};

export default function OperationsCommandCenter() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [recon, setRecon] = useState([]);
  const [filters, setFilters] = useState({ stage: '', owner: '', overdueOnly: false, stuckOnly: false });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [cc, rc] = await Promise.all([operationsCommandCenter(), operationsReconciliation()]);
      setData(cc); setRecon(rc?.mismatches || []);
    } catch (e) { setErr(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (user?.role === 'admin') load(); }, [user]);

  if (user?.role !== 'admin') return <div className="px-6 py-12 text-sm text-slate-500">Operations access required.</div>;

  const rows = (data?.rows || []).filter((r) => {
    if (filters.stage && r.stage !== filters.stage) return false;
    if (filters.owner && r.action_owner !== filters.owner) return false;
    if (filters.overdueOnly && !(r.sla?.state === 'OVERDUE' || r.sla?.state === 'CRITICAL')) return false;
    if (filters.stuckOnly && !r.stuck?.flag) return false;
    return true;
  });
  const b = data?.buckets || {};

  return (
    <div>
      <PageHeader eyebrow="Operations" title="Command Center" description="One deterministic view of every active application — stage, next action, owner, SLA, stuck and payment reconciliation. No AI credits used."
        action={<button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh</button>} />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        {err && <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}

        {/* Bucket strip (§7) */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-7">
          <Buck label="Customer action" value={b.customer_action_required} tone="blue" />
          <Buck label="Krosz action" value={b.krosz_action_required} tone="orange" />
          <Buck label="Human reviews" value={b.human_reviews_pending} tone="amber" />
          <Buck label="Ready to submit" value={b.ready_for_submission} tone="emerald" />
          <Buck label="Gov't processing" value={b.government_processing} tone="indigo" />
          <Buck label="Overdue" value={b.overdue} tone="rose" />
          <Buck label="Stuck" value={b.stuck} tone="rose" />
          <Buck label="Add'l info" value={b.additional_information_required} tone="amber" />
          <Buck label="Submission in progress" value={b.submission_in_progress} tone="slate" />
          <Buck label="Refund cases" value={b.refund_cases} tone="violet" />
          <Buck label="Support escalations" value={b.support_escalations} tone="violet" />
          <Buck label="Payment mismatches" value={b.payment_mismatches} tone="rose" />
          <Buck label="Critical" value={b.critical} tone="rose" />
          <Buck label="Total" value={b.total} tone="slate" />
        </div>

        {/* Payment reconciliation alerts (§19) */}
        {recon.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/60">
            <div className="flex items-center gap-2 border-b border-rose-200/70 px-4 py-2.5 text-sm font-semibold text-rose-800"><ShieldAlert size={15} /> Payment reconciliation — {recon.length} mismatch{recon.length > 1 ? 'es' : ''}</div>
            <div className="divide-y divide-rose-100">
              {recon.map((m, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{m.type.replace(/_/g, ' ')}</span>
                  <span className="text-slate-700">{m.detail}</span>
                  <Link to={`/admin/operations/${m.application_id}`} className="ml-auto font-medium text-orange-700 hover:underline">APP-{String(m.application_id).slice(-6).toUpperCase()}</Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters (§8) */}
        <div className="mt-5 flex flex-wrap items-end gap-2">
          <Filt label="Stage" value={filters.stage} onChange={(v) => setFilters({ ...filters, stage: v })} options={["DRAFT","PROFILE_INCOMPLETE","DOCUMENTS_REQUIRED","DOCUMENTS_UPLOADED","AUTOMATED_CHECKS_RUNNING","ACTION_REQUIRED","READY_FOR_PAYMENT","PAYMENT_PENDING","PAID","HUMAN_REVIEW","READY_FOR_SUBMISSION","SUBMISSION_IN_PROGRESS","SUBMITTED","GOVERNMENT_PROCESSING","ADDITIONAL_INFORMATION_REQUIRED","REFUND_REVIEW"]} />
          <Filt label="Owner" value={filters.owner} onChange={(v) => setFilters({ ...filters, owner: v })} options={["CUSTOMER","KROSZ_AUTOMATION","KROSZ_REVIEWER","KROSZ_SUPPORT","EXTERNAL_PROVIDER","GOVERNMENT","SYSTEM"]} />
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><input type="checkbox" checked={filters.overdueOnly} onChange={(e) => setFilters({ ...filters, overdueOnly: e.target.checked })} /> Overdue only</label>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><input type="checkbox" checked={filters.stuckOnly} onChange={(e) => setFilters({ ...filters, stuckOnly: e.target.checked })} /> Stuck only</label>
        </div>

        {/* Unified queue (§8) */}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full">
            <thead className="bg-slate-50"><tr>{['Priority','Application','Destination','Stage','Next Action','Owner','SLA','Remaining','Blocker','Last Update','Action'].map((h) => <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={11} className="px-4 py-6 text-sm text-slate-400">No applications match these filters.</td></tr>}
              {rows.map((r) => (
                <tr key={r.application_id} className={`hover:bg-slate-50 ${r.stuck?.flag ? 'bg-rose-50/40' : ''}`}>
                  <td className="px-3 py-2.5"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{r.priority_score}</span></td>
                  <td className="px-3 py-2.5"><Link to={`/admin/operations/${r.ops_case_id || r.application_id}`} className="font-medium text-orange-700 hover:underline">{r.order_number || `APP-${String(r.application_id).slice(-6).toUpperCase()}`}</Link></td>
                  <td className="px-3 py-2.5 text-sm text-slate-700">{r.destination}</td>
                  <td className="px-3 py-2.5 text-sm"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{r.stage_label}</span></td>
                  <td className="px-3 py-2.5 text-sm text-slate-700">{r.next_action}</td>
                  <td className="px-3 py-2.5 text-sm"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OWNER_TONE[r.action_owner] || OWNER_TONE.SYSTEM}`}>{r.action_owner.replace(/_/g,' ')}</span></td>
                  <td className="px-3 py-2.5 text-sm"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SLA_TONE[r.sla?.state] || SLA_TONE['N/A']}`}>{r.sla?.state || 'N/A'}</span></td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{r.sla?.remaining_hours ? `${Math.round(r.sla.remaining_hours)}h` : '—'}</td>
                  <td className="px-3 py-2.5 text-xs">{r.stuck?.flag ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-rose-700"><AlertTriangle size={11} /> {r.stuck.reasons[0].replace(/_/g,' ')}</span> : (r.blocked ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">Blocked</span> : '—')}</td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-400">{r.last_update ? new Date(r.last_update).toLocaleString('en-IN') : '—'}</td>
                  <td className="px-3 py-2.5 text-sm"><Clock size={13} className="text-slate-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Stages, next actions, SLA and stuck flags are deterministic projections of authoritative records — no AI, no credit use. SLA targets are internal and never shown to customers.</p>
      </div>
    </div>
  );
}

function Buck({ label, value, tone = 'slate' }) {
  const tones = { blue: 'text-blue-700 bg-blue-50', orange: 'text-orange-700 bg-orange-50', amber: 'text-amber-700 bg-amber-50', emerald: 'text-emerald-700 bg-emerald-50', indigo: 'text-indigo-700 bg-indigo-50', rose: 'text-rose-700 bg-rose-50', violet: 'text-violet-700 bg-violet-50', slate: 'text-slate-700 bg-slate-50' };
  return <div className={`rounded-xl border border-slate-200 p-2.5 ${tones[tone] || tones.slate}`}><p className="text-[10px] font-medium opacity-80">{label}</p><p className="text-lg font-bold">{value ?? 0}</p></div>;
}
function Filt({ label, value, onChange, options }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All</option>{options.map((o) => <option key={o} value={o}>{o.replace(/_/g,' ')}</option>)}</select></label>;
}