import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, FileText, Plus, ShieldCheck, Users } from 'lucide-react';
import { accountDashboard } from '@/lib/visaApi';
import { useAuth } from '@/lib/AuthContext';

const STATUS_LABEL = {
  draft: 'Getting started', eligibility_confirmed: 'Getting started', documents_pending: 'Documents needed',
  document_review: 'Documents under review', application_ready: 'Application ready', user_approval: 'Your approval needed',
  appointment_pending: 'Appointment pending', appointment_booked: 'Appointment booked', submission_ready: 'Ready to submit',
  submitted: 'Submitted', government_processing: 'Processing', additional_documents: 'More information needed',
  decision: 'Decision pending', approved: 'Approved', refused: 'Refused', cancelled: 'Cancelled', withdrawn: 'Withdrawn', completed: 'Completed',
};

export default function AccountDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  // The dashboard must never hang on "Loading your visa journey…" forever: the
  // accountDashboard() call is wrapped in a timeout race so a slow/stuck request
  // surfaces a friendly error + retry instead of an indefinite spinner.
  const load = () => {
    setErr('');
    setData(null);
    const TIMEOUT_MS = 12000;
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS));
    Promise.race([accountDashboard(), timeout])
      .then((d) => setData(d))
      .catch((e) => setErr(e?.message === 'timeout' ? 'This is taking longer than expected. Please try again.' : (e?.message || 'We couldn’t load your dashboard.')));
  };
  useEffect(load, []);

  if (err) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700" role="alert"><p>{err}</p><button type="button" onClick={load} className="mt-3 rounded-lg border border-rose-200 bg-white px-3 py-2 font-semibold">Try again</button></div>;
  if (!data) return <div className="py-12 text-sm text-slate-500" role="status" aria-live="polite">Loading your visa journey…</div>;

  const firstName = user?.full_name?.split(' ')?.[0] || user?.name?.split(' ')?.[0] || '';
  const active = data.active_applications || [];
  const actions = Array.from(new Map((data.next_actions || []).map((a) => [`${a.application_id || ''}:${a.action_type || a.title || ''}:${a.cta_link || ''}`, a])).values());
  const travelers = data.travelers || [];
  const docs = data.documents || { total: 0, needs_attention: 0 };

  return (
    <div className="pb-8">
      {/* Hero */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Your visa journey</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">{firstName ? `Hi ${firstName}.` : 'Welcome.'} Ready for what’s next?</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">Start a new visa, continue an application, upload documents, or check your latest updates.</p>
        <Link to="/apply" className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"><Plus size={17} /> New application</Link>
      </section>

      {/* KPI summary */}
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi to="/applications" icon={FileText} label="Applications" value={String(active.length)} />
        <Kpi to="/documents" icon={ShieldCheck} label="Documents" value={String(docs.total || 0)} />
        <Kpi to="/travelers" icon={Users} label="Travelers" value={String(travelers.length)} />
        <Kpi to="/notifications" icon={Bell} label="Updates" value={actions.length ? String(actions.length) : 'View'} />
      </section>

      {/* Action needed */}
      {actions.length > 0 && (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-amber-900">Action needed</p>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-amber-800">{actions.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {actions.slice(0, 3).map((a, i) => (
              <Link key={`${a.application_id || 'application'}:${a.action_type || a.title || i}`} to={a.cta_link || `/applications/${a.application_id}/workspace`} className="flex items-center justify-between gap-3 rounded-xl border border-amber-100 bg-white p-3 hover:border-amber-300">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{[a.destination, a.traveler_name, a.description].filter(Boolean).join(' · ')}</p>
                </div>
                <ArrowRight size={15} className="shrink-0 text-slate-400" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* My applications */}
      <section className="mt-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950">My applications</h2>
            <p className="mt-0.5 text-xs text-slate-500">Your active visa journeys at a glance.</p>
          </div>
          <Link to="/applications" className="text-xs font-semibold text-[#B45309] hover:underline">View all</Link>
        </div>

        {active.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-semibold text-slate-900">No active applications yet</p>
            <p className="mt-1 text-sm text-slate-500">Choose your destination and we’ll guide you from there.</p>
            <Link to="/apply" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={15} /> Start your first visa</Link>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {active.slice(0, 4).map((a) => (
              <Link key={a.id} to={`/cases/${a.id}`} className="group rounded-2xl border border-slate-200 bg-white p-5 transition duration-200 hover:border-slate-300 hover:shadow-[0_12px_40px_-30px_rgba(15,23,42,.25)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-950">{countryName(a.destination)}</p>
                    <p className="mt-0.5 text-xs capitalize text-slate-500">{a.purpose || 'tourism'} · {(a.traveler_name || 'Traveler').toUpperCase()}</p>
                  </div>
                  <ArrowRight size={16} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#B45309]" />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-xs font-semibold text-slate-700">{STATUS_LABEL[a.status] || a.status || 'Getting started'}</span>
                  <span className="text-xs text-slate-400">APP-{String(a.id).slice(-6).toUpperCase()}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ to, icon: Icon, label, value }) {
  return (
    <Link to={to} className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-[0_12px_40px_-30px_rgba(15,23,42,.2)]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700"><Icon size={18} /></span>
        <span className="text-2xl font-bold text-slate-900">{value}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-slate-500">{label}</p>
    </Link>
  );
}

function countryName(code) {
  if (!code) return 'Destination not selected';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()) || code; } catch { return code; }
}