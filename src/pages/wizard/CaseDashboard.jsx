import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, ArrowRight, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { applicationCaseList } from '@/lib/applicationCaseApi';
import { CASE_STATE_LABELS, NEXT_ACTIONS } from '@/lib/wizardLabels';

const TERMINAL = ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED'];

export default function CaseDashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['case-list'], queryFn: () => applicationCaseList() });
  const cases = data?.cases || [];
  const active = cases.filter((c) => !TERMINAL.includes(c.state));
  const completed = cases.filter((c) => TERMINAL.includes(c.state));
  const actionRequired = cases.filter((c) => c.state === 'ADDITIONAL_INFORMATION_REQUIRED' || c.state === 'REVIEW_REQUIRED');

  if (isLoading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;

  return (
    <div>
      <PageHeader
        eyebrow="My Cases"
        title="Your visa applications"
        description="Every case is saved on our servers — resume any time, from any device."
        action={<Link to="/apply" className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700"><Plus size={16} /> Start a visa</Link>}
      />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        {actionRequired.length > 0 && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-rose-800"><AlertCircle size={16} /> {actionRequired.length} application(s) need your attention.</p>
          </div>
        )}
        {cases.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            <Section title="Active">
              {active.length === 0 ? <p className="text-sm text-slate-400">No active applications.</p> : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {active.map((c) => <CaseCard key={c.id} c={c} />)}
                </div>
              )}
            </Section>
            {completed.length > 0 && (
              <Section title="Completed">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {completed.map((c) => <CaseCard key={c.id} c={c} muted />)}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CaseCard({ c, muted = false }) {
  const label = CASE_STATE_LABELS[c.state] || c.state;
  const next = NEXT_ACTIONS[c.state] || 'Continue';
  const pct = muted ? 100 : estimatedPct(c.state);
  return (
    <Link to={`/cases/${c.id}`} className={`block rounded-2xl border bg-white p-4 shadow-sm transition-colors hover:border-orange-300 ${muted ? 'border-slate-200' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">{c.destination}{c.journey ? ` · ${c.journey}` : ''}</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${muted ? 'bg-slate-100 text-slate-500' : 'bg-orange-50 text-orange-700'}`}>{label}</span>
      </div>
      <div className="mt-3">
        <div className="h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-orange-500" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-[11px] text-slate-400">Progress {pct}%</p>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-slate-500">Next: <span className="font-medium text-slate-700">{next}</span></p>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700">View <ArrowRight size={12} /></span>
      </div>
    </Link>
  );
}

function Section({ title, children }) {
  return (<div><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>{children}</div>);
}
function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <p className="text-sm text-slate-500">You haven’t started any applications yet.</p>
      <Link to="/apply" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"><Plus size={16} /> Explore visas</Link>
    </div>
  );
}
const PCT = { DRAFT: 10, INTAKE: 20, ELIGIBILITY_REVIEW: 35, DOCUMENTS_REQUIRED: 50, DOCUMENTS_REVIEW: 60, READY_FOR_SUBMISSION: 70, REVIEW_REQUIRED: 70, SUBMISSION_PENDING: 80, SUBMITTED: 88, PROCESSING: 94, ADDITIONAL_INFORMATION_REQUIRED: 50 };
function estimatedPct(s) { return PCT[s] ?? 60; }