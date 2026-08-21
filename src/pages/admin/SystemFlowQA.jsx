import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw, Loader2, AlertTriangle, ShieldAlert, FileX2, Wallet, Send, HardHat, Activity, ChevronRight } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { base44 } from '@/api/base44Client';

// Canonical application status model (§2/§13). Maps the existing internal
// case_state (Phase 27 case engine) to a customer-friendly label + lifecycle
// group. The engine remains the source of truth; this is a presentation map.
const STATUS = {
  DRAFT: { label: 'Draft', group: 'pre' },
  INTAKE: { label: 'Intake', group: 'pre' },
  ELIGIBILITY_REVIEW: { label: 'Eligibility review', group: 'pre' },
  DOCUMENTS_REQUIRED: { label: 'Documents required', group: 'pre' },
  DOCUMENTS_REVIEW: { label: 'Documents in review', group: 'pre' },
  REVIEW_REQUIRED: { label: 'Review required', group: 'pre' },
  ADDITIONAL_INFORMATION_REQUIRED: { label: 'Additional info required', group: 'pre' },
  READY_FOR_SUBMISSION: { label: 'Ready for submission', group: 'ready' },
  SUBMISSION_PENDING: { label: 'Submission pending', group: 'ready' },
  SUBMITTED: { label: 'Submitted', group: 'submitted' },
  PROCESSING: { label: 'Processing', group: 'submitted' },
  APPROVED: { label: 'Approved', group: 'terminal' },
  REJECTED: { label: 'Rejected', group: 'terminal' },
  CANCELLED: { label: 'Cancelled', group: 'terminal' },
  EXPIRED: { label: 'Expired', group: 'terminal' },
  COMPLETED: { label: 'Completed', group: 'terminal' },
};
const TERMINAL = new Set(['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED']);
const SUBMITTED_STATES = new Set(['SUBMITTED', 'PROCESSING', 'APPROVED', 'REJECTED', 'COMPLETED']);
const PRE_STATES = new Set(['DRAFT', 'INTAKE', 'ELIGIBILITY_REVIEW', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_REVIEW', 'REVIEW_REQUIRED', 'ADDITIONAL_INFORMATION_REQUIRED']);

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : '—');

export default function SystemFlowQA() {
  const [filter, setFilter] = useState('all');
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['system-flow-qa'],
    queryFn: async () => {
      const safe = (p, fallback = []) => p.then((r) => (Array.isArray(r) ? r : (r?.items || r?.list || fallback))).catch(() => fallback);
      const [apps, exceptions, rejectedDocs, blockingFindings, orders] = await Promise.all([
        safe(base44.entities.VisaApplication.list('-updated_date', 500)),
        safe(base44.entities.CaseException.filter({ status: 'OPEN' }, '-created_date', 500)),
        safe(base44.entities.ApplicationDocument.filter({ status: 'rejected' }, '-updated_date', 500)),
        safe(base44.entities.ReviewFinding.filter({ severity: 'BLOCKING', status: 'OPEN' }, '-created_date', 500)),
        safe(base44.entities.Order.list('-updated_date', 500)),
      ]);
      return { apps, exceptions, rejectedDocs, blockingFindings, orders };
    },
    refetchInterval: 60_000,
  });

  const summary = useMemo(() => computeSummary(data), [data]);

  const problemApps = useMemo(() => {
    const rows = Object.values(summary.problems).sort((a, b) => a.app.updated_date < b.app.updated_date ? 1 : -1);
    if (filter === 'all') return rows;
    return rows.filter((r) => r.flags.includes(filter));
  }, [summary, filter]);

  return (
    <div>
      <PageHeader
        eyebrow="Reliability · Operations"
        title="System / Visa Flow QA"
        description="Live operational reliability of the visa application pipeline. Surfaces blockers, document issues, payment inconsistencies, and stuck applications so nothing requires manual database inspection."
        action={
          <button onClick={() => refetch()} disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {isFetching ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </button>
        }
      />

      <div className="px-5 py-6 sm:px-8 lg:px-10">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total applications" value={summary.total} tone="slate" icon={Activity} />
              <StatCard label="Open blockers" value={summary.openBlockers} tone={summary.openBlockers ? 'amber' : 'slate'} icon={AlertTriangle} />
              <StatCard label="Rejected documents" value={summary.rejectedCount} tone={summary.rejectedCount ? 'rose' : 'slate'} icon={FileX2} />
              <StatCard label="Inconsistent states" value={summary.inconsistentCount} tone={summary.inconsistentCount ? 'rose' : 'emerald'} icon={ShieldAlert} />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Pre-submission" value={summary.groupCounts.pre} tone="slate" icon={HardHat} />
              <StatCard label="Ready to submit" value={summary.groupCounts.ready} tone="blue" icon={Send} />
              <StatCard label="Submitted / processing" value={summary.groupCounts.submitted} tone="blue" icon={Send} />
              <StatCard label="Paid not yet submitted" value={summary.paidNotSubmitted.length} tone={summary.paidNotSubmitted.length ? 'amber' : 'slate'} icon={Wallet} />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Panel title="Applications by status">
                <div className="space-y-1.5">
                  {Object.keys(STATUS).map((st) => (
                    <div key={st} className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm odd:bg-slate-50/60">
                      <span className="text-slate-700">{STATUS[st].label}</span>
                      <span className="font-semibold text-slate-900">{summary.statusCounts[st] || 0}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Reliability checks">
                <ul className="space-y-2 text-sm">
                  <Check ok={!summary.paidNotSubmitted.length} label="Paid applications all advanced past payment" detail={`${summary.paidNotSubmitted.length} stuck`} />
                  <Check ok={!summary.submittedUnpaid.length} label="Submitted applications have a recorded payment" detail={`${summary.submittedUnpaid.length} unpaid`} />
                  <Check ok={!summary.approachingTravel.length} label="No imminent travel without submission" detail={`${summary.approachingTravel.length} approaching`} />
                  <Check ok={!summary.rejectedAdvancing.length} label="No rejected documents on advancing applications" detail={`${summary.rejectedAdvancing.length} flagged`} />
                  <Check ok={!summary.terminalUnpaid.length} label="Terminal decisions reconciled with payment" detail={`${summary.terminalUnpaid.length} unresolved`} />
                </ul>
              </Panel>
            </div>

            <Panel title="Applications needing attention" className="mt-6">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {[
                  { k: 'all', l: 'All' },
                  { k: 'blocker', l: 'Blockers' },
                  { k: 'rejected_doc', l: 'Rejected docs' },
                  { k: 'blocking_finding', l: 'Open review findings' },
                  { k: 'paid_not_submitted', l: 'Paid not submitted' },
                  { k: 'submitted_unpaid', l: 'Submitted unpaid' },
                  { k: 'approaching', l: 'Imminent travel' },
                ].map((f) => (
                  <button key={f.k} onClick={() => setFilter(f.k)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.k ? 'bg-[#003580] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {f.l}
                  </button>
                ))}
              </div>
              {problemApps.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No applications need attention. The visa flow is in a consistent state.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-3 font-medium">Application</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Travel date</th>
                        <th className="py-2 pr-3 font-medium">What's stopping it</th>
                        <th className="py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {problemApps.map((r) => {
                        const st = STATUS[r.app.case_state || r.app.status] || { label: r.app.case_state || r.app.status };
                        return (
                          <tr key={r.app.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 pr-3">
                              <p className="font-medium text-slate-900">{r.app.destination} · {r.app.visa_type_key}</p>
                              <p className="text-[11px] text-slate-400">{r.app.id}</p>
                            </td>
                            <td className="py-2.5 pr-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{st.label}</span></td>
                            <td className="py-2.5 pr-3 text-slate-600">{fmtDate(r.app.travel_start)}</td>
                            <td className="py-2.5 pr-3">
                              <div className="flex flex-wrap gap-1">
                                {r.flags.map((f) => <span key={f} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{FLAG_LABEL[f] || f}</span>)}
                              </div>
                              {r.detail && <p className="mt-1 text-[11px] text-slate-500">{r.detail}</p>}
                            </td>
                            <td className="py-2.5 text-right">
                              <Link to={`/admin/cases/${r.app.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#006CEC] hover:underline">Open <ChevronRight size={13} /></Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

const FLAG_LABEL = {
  blocker: 'Open blocker',
  rejected_doc: 'Rejected document',
  blocking_finding: 'Open blocking finding',
  paid_not_submitted: 'Paid — not advanced',
  submitted_unpaid: 'Submitted — no payment',
  approaching: 'Imminent travel',
  rejected_advancing: 'Rejected doc on advancing case',
  terminal_unpaid: 'Terminal — payment unresolved',
};

function computeSummary(data) {
  const { apps = [], exceptions = [], rejectedDocs = [], blockingFindings = [], orders = [] } = data || {};
  const statusCounts = {};
  const groupCounts = { pre: 0, ready: 0, submitted: 0, terminal: 0 };
  for (const a of apps) {
    const st = a.case_state || a.status || 'DRAFT';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    const g = STATUS[st]?.group || (TERMINAL.has(st) ? 'terminal' : 'pre');
    groupCounts[g] = (groupCounts[g] || 0) + 1;
  }
  const blockersByApp = groupBy(exceptions, 'case_id');
  const rejectedByApp = groupBy(rejectedDocs, 'application_id');
  const blockingByApp = groupBy(blockingFindings, 'application_id');
  const paidOrdersByApp = new Map();
  for (const o of orders) {
    if (o.status === 'PAID' || o.status === 'COMPLETED') {
      const prev = paidOrdersByApp.get(o.application_id);
      if (!prev || (o.paid_at || '') > (prev.paid_at || '')) paidOrdersByApp.set(o.application_id, o);
    }
  }

  const problems = {};
  const flag = (app, key, detail) => {
    const id = app.id;
    if (!problems[id]) problems[id] = { app, flags: [] };
    if (!problems[id].flags.includes(key)) problems[id].flags.push(key);
    if (detail) problems[id].detail = detail;
  };

  const today = new Date();
  for (const a of apps) {
    const st = a.case_state || a.status || 'DRAFT';
    if (blockersByApp.has(a.id)) flag(a, 'blocker', `${blockersByApp.get(a.id).length} open exception(s)`);
    if (rejectedByApp.has(a.id)) flag(a, 'rejected_doc', `${rejectedByApp.get(a.id).length} rejected document(s)`);
    if (blockingByApp.has(a.id)) flag(a, 'blocking_finding', `${blockingByApp.get(a.id).length} open blocking finding(s)`);

    const paid = paidOrdersByApp.get(a.id);
    if (paid && PRE_STATES.has(st)) flag(a, 'paid_not_submitted', 'Payment recorded but case still in pre-submission');
    if (SUBMITTED_STATES.has(st) && !paid) flag(a, 'submitted_unpaid', 'Case submitted/processing without a recorded payment');
    if (TERMINAL.has(st) && !paid) flag(a, 'terminal_unpaid', 'Terminal decision with no recorded payment');

    if (rejectedByApp.has(a.id) && (st === 'DOCUMENTS_REVIEW' || st === 'READY_FOR_SUBMISSION' || st === 'SUBMISSION_PENDING')) flag(a, 'rejected_advancing');

    if (a.travel_start && PRE_STATES.has(st)) {
      const days = (new Date(a.travel_start).getTime() - today.getTime()) / 86400000;
      if (days >= 0 && days <= 14) flag(a, 'approaching', `Travel in ${Math.ceil(days)} day(s)`);
    }
  }

  const paidNotSubmitted = apps.filter((a) => paidOrdersByApp.has(a.id) && PRE_STATES.has(a.case_state || a.status));
  const submittedUnpaid = apps.filter((a) => SUBMITTED_STATES.has(a.case_state) && !paidOrdersByApp.has(a.id));
  const approachingTravel = apps.filter((a) => a.travel_start && PRE_STATES.has(a.case_state) && (new Date(a.travel_start).getTime() - today.getTime()) / 86400000 <= 14 && (new Date(a.travel_start).getTime() - today.getTime()) / 86400000 >= 0);
  const rejectedAdvancing = apps.filter((a) => rejectedByApp.has(a.id) && ['DOCUMENTS_REVIEW', 'READY_FOR_SUBMISSION', 'SUBMISSION_PENDING'].includes(a.case_state));
  const terminalUnpaid = apps.filter((a) => TERMINAL.has(a.case_state) && !paidOrdersByApp.has(a.id));

  return {
    total: apps.length,
    statusCounts, groupCounts,
    openBlockers: exceptions.length,
    rejectedCount: rejectedDocs.length,
    paidNotSubmitted, submittedUnpaid, approachingTravel, rejectedAdvancing, terminalUnpaid,
    inconsistentCount: paidNotSubmitted.length + submittedUnpaid.length + terminalUnpaid.length,
    problems,
  };
}

const groupBy = (arr, key) => {
  const m = new Map();
  for (const x of arr) {
    const k = x[key];
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

function StatCard({ label, value, tone, icon: Icon }) {
  const tones = {
    slate: 'border-slate-200 text-slate-900',
    amber: 'border-amber-200 text-amber-700',
    rose: 'border-rose-200 text-rose-700',
    emerald: 'border-emerald-200 text-emerald-700',
    blue: 'border-blue-200 text-blue-700',
  };
  return (
    <div className={`rounded-2xl border bg-white p-5 ${tones[tone] || tones.slate}`}>
      <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span><Icon size={18} className="opacity-70" /></div>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function Panel({ title, children, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`}>
      <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-900">{title}</h2></div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Check({ ok, label, detail }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{ok ? '✓' : '!'}</span>
      <span className="text-slate-700">{ok ? label : <span className="text-rose-700">{label}</span>} <span className="ml-1 text-xs text-slate-400">({detail})</span></span>
    </li>
  );
}