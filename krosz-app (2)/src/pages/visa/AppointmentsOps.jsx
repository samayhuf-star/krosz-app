import { useEffect, useState } from 'react';
import { CalendarDays, RefreshCw, CheckCircle2, XCircle, X, AlertTriangle } from 'lucide-react';
import { opsListAppointments, confirmAttendance, cancelAppointment, runAppointmentContractTests, seedAppointmentCatalog } from '@/lib/visaApi';

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'This week' },
  { key: 'unconfirmed', label: 'Unconfirmed', status: 'BOOKING' },
  { key: 'failed', label: 'Failed', status: 'FAILED' },
  { key: 'reschedule', label: 'Reschedule required', status: 'RESCHEDULE_REQUIRED' },
  { key: 'noshow', label: 'No-show', status: 'NO_SHOW' },
];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function rangeFor(key) {
  const now = new Date();
  if (key === 'today') return { from: startOfDay(now).toISOString(), to: new Date(startOfDay(now).getTime() + 86400000).toISOString() };
  if (key === 'tomorrow') { const t = startOfDay(now.getTime() + 86400000); return { from: t.toISOString(), to: new Date(t.getTime() + 86400000).toISOString() }; }
  if (key === 'week') return { from: startOfDay(now).toISOString(), to: new Date(startOfDay(now).getTime() + 7 * 86400000).toISOString() };
  return {};
}

export default function AppointmentsOps() {
  const [filter, setFilter] = useState('today');
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const f = FILTERS.find((x) => x.key === filter);
      const r = await opsListAppointments({ status: f?.status, ...rangeFor(filter) });
      setAppointments(r.appointments || []);
    } catch (e) { setError(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const act = async (fn) => { setBusy(true); try { await fn(); await load(); } catch (e) { setError(e?.message || 'Action failed'); } finally { setBusy(false); } };

  const runTests = async () => {
    setBusy(true); setTestResult(null);
    try { setTestResult(await runAppointmentContractTests()); } catch (e) { setError(e?.message || 'Tests failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="px-4 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">Appointment Operations</p>
          <p className="text-sm text-slate-500">Manage bookings, no-shows, and reschedules across all applications.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => act(seedAppointmentCatalog)} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Seed catalog</button>
          <button onClick={runTests} disabled={busy} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">Run contract tests</button>
          <button onClick={load} disabled={busy} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === f.key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{f.label}</button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-slate-500">Loading…</p>}
        {!loading && appointments.length === 0 && <p className="text-sm text-slate-500">No appointments in this view.</p>}
        {appointments.map((a) => (
          <div key={a.id} className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <p className="font-semibold text-slate-900 capitalize flex items-center gap-1.5"><CalendarDays size={14} /> {a.appointment_type.replace(/_/g, ' ')}</p>
                <p className="text-xs text-slate-500">{a.scheduled_at_utc ? new Date(a.scheduled_at_utc).toUTCString() : '—'} · {a.location_timezone || 'UTC'}</p>
                <p className="text-xs text-slate-400">App #{(a.application_id || '').slice(-6).toUpperCase()} · Ref {a.external_reference || '—'}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{a.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => act(() => confirmAttendance(a.id, 'COMPLETED'))} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-orange-200 px-2.5 py-1 text-xs text-orange-700 hover:bg-orange-50"><CheckCircle2 size={12} /> Completed</button>
              <button onClick={() => act(() => confirmAttendance(a.id, 'NO_SHOW'))} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"><XCircle size={12} /> No-show</button>
              <button onClick={() => act(() => confirmAttendance(a.id, 'ISSUE'))} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50"><AlertTriangle size={12} /> Issue</button>
              <button onClick={() => act(() => cancelAppointment(a.id))} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"><X size={12} /> Cancel</button>
            </div>
          </div>
        ))}
      </div>

      {testResult && (
        <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <p className="text-sm font-semibold text-slate-900">Contract tests: {testResult.allPassed ? 'ALL PASSED' : `${testResult.passed}/${testResult.total} passed`}</p>
          {testResult.failed?.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-red-600">{testResult.failed.map((f) => <li key={f}>{f}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}