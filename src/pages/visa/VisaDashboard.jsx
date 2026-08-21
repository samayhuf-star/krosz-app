import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderOpen, Plus, AlertTriangle, RefreshCw, Bell } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import ApplicationJourneyCard from '@/components/visa/ApplicationJourneyCard';
import { listApplications } from '@/lib/visaApi';

// Lightweight client-side stage projection for the dashboard grid. The list
// response already carries destination / purpose / visa_type_key / case_state /
// current_step, so we render cards directly from it WITHOUT the per-application
// get-application-journey fan-out (each such call re-resolved readiness,
// documents, appointments, submissions, packages and orders — heavy work the
// grid never needed, and the single biggest source of "My Applications" latency).
const STAGE = {
  DRAFT: { status: 'IN_PROGRESS', title: 'In progress', pct: 10, next: 'Start your application' },
  INTAKE: { status: 'IN_PROGRESS', title: 'In progress', pct: 18, next: 'Continue your application' },
  ELIGIBILITY_REVIEW: { status: 'IN_PROGRESS', title: 'Checking eligibility', pct: 25, next: 'Review eligibility' },
  DOCUMENTS_REQUIRED: { status: 'ACTION_REQUIRED', title: 'Documents required', pct: 40, next: 'Upload required documents' },
  DOCUMENTS_REVIEW: { status: 'IN_PROGRESS', title: 'Documents in review', pct: 55, next: 'Awaiting document review' },
  REVIEW_REQUIRED: { status: 'ACTION_REQUIRED', title: 'Review required', pct: 65, next: 'Review your application' },
  READY_FOR_SUBMISSION: { status: 'ACTION_REQUIRED', title: 'Ready for submission', pct: 75, next: 'Confirm and submit' },
  SUBMISSION_PENDING: { status: 'ACTION_REQUIRED', title: 'Submission pending', pct: 80, next: 'Confirm submission' },
  SUBMITTED: { status: 'IN_PROGRESS', title: 'Submitted', pct: 85, next: 'Awaiting processing' },
  PROCESSING: { status: 'IN_PROGRESS', title: 'Processing', pct: 90, next: 'Awaiting decision' },
  ADDITIONAL_INFORMATION_REQUIRED: { status: 'ACTION_REQUIRED', title: 'Additional info required', pct: 60, next: 'Provide requested information' },
  APPROVED: { status: 'COMPLETED', title: 'Approved', pct: 100, next: null },
  COMPLETED: { status: 'COMPLETED', title: 'Completed', pct: 100, next: null },
  REJECTED: { status: 'BLOCKED', title: 'Rejected', pct: 100, next: null },
  CANCELLED: { status: 'BLOCKED', title: 'Cancelled', pct: 100, next: null },
  EXPIRED: { status: 'BLOCKED', title: 'Expired', pct: 100, next: null },
};

export function toJourney(app) {
  const state = app?.case_state || app?.status || 'DRAFT';
  const cfg = STAGE[state] || STAGE.DRAFT;
  return {
    application: app,
    current_stage: { status: cfg.status, title: cfg.title },
    next_action: cfg.next ? { title: cfg.next } : null,
    progress: { percent: cfg.pct },
    actions: cfg.status === 'ACTION_REQUIRED' && cfg.next ? [{ title: cfg.next }] : [],
    appointment: null,
  };
}

export default function VisaDashboard() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    listApplications()
      .then((r) => { setApps(r.applications || []); setLoading(false); })
      .catch((e) => { setError(e?.message || 'We couldn’t load your applications. Please try again.'); setLoading(false); });
  };

  useEffect(load, []);

  const journeys = apps.map(toJourney);
  const actionRequired = journeys.filter((j) => j.actions && j.actions.length > 0);

  return (
    <div className="px-4 md:px-8">
      <PageHeader title="My Applications" subtitle="Track every visa application in one place." />

      {error && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="text-sm text-rose-700">{error}</p>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"><RefreshCw size={13} /> Retry</button>
        </div>
      )}

      {apps.length === 0 && !loading && !error && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-700"><FolderOpen size={22} /></span>
          <p className="mt-4 text-sm font-medium text-slate-900">No applications yet</p>
          <p className="mt-1 text-sm text-slate-500">Check your eligibility and start your first visa application.</p>
          <Link to="/destinations" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"><Plus size={16} /> Start application</Link>
        </div>
      )}

      {actionRequired.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-800"><AlertTriangle size={16} /><p className="text-sm font-semibold">Action required on {actionRequired.length} {actionRequired.length === 1 ? 'application' : 'applications'}</p></div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {actionRequired.slice(0, 3).map((j) => (
              <Link key={j.application.id} to={`/applications/${j.application.id}`} className="rounded-xl bg-white p-3 text-sm shadow-sm border border-amber-100">
                <p className="font-medium text-slate-800">{j.application.destination}</p>
                <p className="text-xs text-slate-500">{j.next_action && j.next_action.title}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500" role="status" aria-live="polite">Loading your applications…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {apps.map((a) => <ApplicationJourneyCard key={a.id} journey={toJourney(a)} />)}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
        <Bell size={13} /> Updates appear automatically as your application progresses.
      </div>
    </div>
  );
}