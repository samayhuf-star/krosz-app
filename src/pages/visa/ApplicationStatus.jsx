import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { travelerStatus } from '@/lib/visaApi';

const MILESTONE = {
  APPLICATION_CREATED: { label: 'Application started', icon: CheckCircle2 },
  DOCUMENTS_COMPLETED: { label: 'Documents completed', icon: CheckCircle2 },
  PAYMENT_COMPLETED: { label: 'Payment received', icon: CheckCircle2 },
  SUBMISSION_COMPLETED: { label: 'Application submitted', icon: CheckCircle2 },
  APPLICATION_PROCESSING: { label: 'Government processing', icon: Loader2 },
  ADDITIONAL_INFORMATION_REQUIRED: { label: 'Additional information required', icon: AlertCircle },
  APPOINTMENT_REQUIRED: { label: 'Appointment required', icon: AlertCircle },
  PASSPORT_SUBMITTED: { label: 'Passport requested', icon: AlertCircle },
  VISA_APPROVED: { label: 'Visa approved', icon: CheckCircle2 },
  VISA_REFUSED: { label: 'Visa refused', icon: XCircle },
  APPLICATION_CANCELLED: { label: 'Application cancelled', icon: XCircle },
};

export default function ApplicationStatus() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = () => travelerStatus(id).then((r) => setData(r)).catch((e) => setErr(e?.message));
  useEffect(() => { load(); }, [id]);

  if (err && !data) return <div className="px-4 md:px-8 py-8"><p className="text-sm text-rose-600">{err}</p><Link to="/applications" className="mt-2 inline-flex items-center gap-1 text-sm text-orange-700"><ArrowLeft size={14} /> Back</Link></div>;
  if (!data) return <div className="px-4 md:px-8 py-12 text-sm text-slate-500">Loading application status…</div>;

  const { application: app, decision, decision_date, tracking_events, outstanding_actions, timeline } = data;
  const isApproved = decision === 'APPROVED';
  const isRefused = decision === 'REFUSED';

  return (
    <div className="px-4 md:px-8 pb-20">
      <Link to="/applications" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> My applications</Link>

      {/* Approval / refusal experience (§27/§28) */}
      {isApproved && (
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-5">
          <CheckCircle2 className="text-orange-600" size={22} />
          <div><h1 className="text-xl font-semibold text-orange-900">Visa application approved</h1><p className="text-sm text-orange-700">Application APP-{String(app.id).slice(-6).toUpperCase()} · {app.destination} {app.purpose} visa</p><p className="mt-1 text-xs text-orange-600">Decision date: {decision_date || '—'}</p></div>
        </div>
      )}
      {isRefused && (
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <XCircle className="text-rose-600" size={22} />
          <div><h1 className="text-xl font-semibold text-rose-900">Visa decision: Refused</h1><p className="text-sm text-rose-700">Application APP-{String(app.id).slice(-6).toUpperCase()}</p><p className="mt-1 text-xs text-rose-600">Decision date: {decision_date || '—'}</p><p className="mt-1 text-[11px] text-rose-500">Reason is shown only if officially provided. We do not invent a refusal reason.</p></div>
        </div>
      )}
      {!isApproved && !isRefused && (
        <div className="mt-3 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <h1 className="text-xl font-semibold text-slate-950">{app.destination} <span className="capitalize text-slate-500">{app.purpose}</span> visa</h1>
          <p className="text-sm text-slate-500">Application #APP-{String(app.id).slice(-6).toUpperCase()}</p>
          <p className="mt-2 text-sm"><span className="text-slate-500">Current status:</span> <span className="font-semibold text-slate-900">{normalize(data.current_status)}</span></p>
          <p className="text-xs text-slate-400">Last updated: {timeline[0] ? new Date(timeline[0].occurred_at).toLocaleDateString() : '—'}</p>
        </div>
      )}

      {/* Applicant Action Center (§13) */}
      {outstanding_actions?.length > 0 && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">Your application needs attention</h2>
          <ul className="mt-2 space-y-2">
            {outstanding_actions.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white p-3">
                <div><p className="text-sm font-medium text-slate-800">{a.title}</p><p className="text-xs text-slate-500">{a.description}</p></div>
                <Link to={a.cta_link || `/applications/${app.id}/workspace`} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">Resolve</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Unified timeline (§29) */}
      <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <h2 className="text-base font-semibold text-slate-900">Timeline</h2>
        <ol className="mt-3 space-y-3">
          {(timeline || []).map((ev) => {
            const m = MILESTONE[ev.event_type] || { label: ev.event_type.replace(/_/g, ' '), icon: CheckCircle2 };
            const Icon = m.icon;
            const tone = ev.event_type === 'VISA_REFUSED' || ev.event_type === 'APPLICATION_CANCELLED' ? 'text-rose-500' : ev.event_type.includes('REQUIRED') ? 'text-amber-500' : 'text-orange-600';
            return (
              <li key={ev.id} className="flex gap-3">
                <Icon size={16} className={`mt-0.5 ${tone} ${ev.event_type === 'APPLICATION_PROCESSING' ? 'animate-spin' : ''}`} />
                <div className="flex-1"><p className="text-sm text-slate-800">{m.label}</p><p className="text-[11px] text-slate-400">{new Date(ev.occurred_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{ev.description && ` · ${ev.description}`}</p></div>
              </li>
            );
          })}
          {timeline?.length === 0 && <li className="text-sm text-slate-400">No events yet.</li>}
        </ol>
      </div>

      {/* Tracking events (§21) */}
      {tracking_events?.length > 0 && (
        <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <h2 className="text-base font-semibold text-slate-900">Government tracking</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {tracking_events.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between py-2 text-sm"><span className="text-slate-700"><span className="font-medium">{normalize(ev.normalized_status)}</span> <span className="text-slate-400">· {ev.raw_status}</span></span><span className="text-xs text-slate-400">{new Date(ev.occurred_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-4 text-[11px] text-amber-700">Some requirements are still being verified. A tracking status of "processing" does not predict approval.</p>
    </div>
  );
}

function normalize(s) { return String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()); }