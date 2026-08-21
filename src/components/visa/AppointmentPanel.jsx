import { useEffect, useState, useMemo } from 'react';
import { CalendarDays, MapPin, Clock, RefreshCw, X, CheckCircle2, FileText, ShieldCheck } from 'lucide-react';
import {
  getAppointmentRequirements, checkAppointmentReadiness, listAppointmentLocations,
  findAppointmentSlots, bookAppointment, rescheduleAppointment, cancelAppointment,
  getAppointmentStatusApi, listAppointments,
} from '@/lib/visaApi';

const STATUS_STYLE = {
  REQUIRED: 'bg-amber-50 text-amber-700', BOOKED: 'bg-orange-50 text-orange-700', CANCELLED: 'bg-slate-100 text-slate-500',
  COMPLETED: 'bg-orange-100 text-orange-800', NO_SHOW: 'bg-red-50 text-red-700', RESCHEDULE_REQUIRED: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-50 text-red-700', BOOKING: 'bg-blue-50 text-blue-700', AVAILABLE: 'bg-blue-50 text-blue-700', SEARCHING: 'bg-slate-100 text-slate-600',
};

function fmtInTz(utc, tz) {
  if (!utc) return '—';
  try { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz || 'UTC' }).format(new Date(utc)); }
  catch { return new Date(utc).toUTCString(); }
}

export default function AppointmentPanel({ applicationId }) {
  const [requirements, setRequirements] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeReqId, setActiveReqId] = useState(null);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [rescheduleFrom, setRescheduleFrom] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await getAppointmentRequirements(applicationId);
      setRequirements(r.requirements || []);
      setReadiness(await checkAppointmentReadiness(applicationId));
      const a = await listAppointments(applicationId);
      setAppointments(a.appointments || []);
    } catch (e) { setError(e?.message || 'Failed to load appointments'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [applicationId]);

  const requiredReqs = useMemo(() => (requirements || []).filter((r) => r.required), [requirements]);
  const noAppointment = !!requirements && requiredReqs.length === 0;

  const openBooking = async (req) => {
    setActiveReqId(req.id); setSelectedLocation(null); setSlots([]); setRescheduleFrom(null); setError('');
    try { const lr = await listAppointmentLocations(applicationId, req.id); setLocations(lr.locations || []); }
    catch (e) { setError(e?.message || 'Could not load locations'); }
  };

  const loadSlots = async (loc) => {
    setSelectedLocation(loc); setLoadingSlots(true); setSlots([]);
    try {
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 14 * 86400000).toISOString();
      const r = await findAppointmentSlots({ id: applicationId, requirement_id: activeReqId, external_location_id: loc.external_location_id, date_from: from, date_to: to });
      setSlots(r.slots || []);
    } catch (e) { setError(e?.message || 'Could not load slots'); }
    finally { setLoadingSlots(false); }
  };

  const refreshSlots = async () => { if (selectedLocation) await loadSlots(selectedLocation); };

  const book = async (slot) => {
    setBusy(true); setError('');
    try { await bookAppointment({ id: applicationId, requirement_id: activeReqId, slot_id: slot.id }); await load(); setActiveReqId(null); setSlots([]); }
    catch (e) { setError(e?.message || 'Booking failed'); }
    finally { setBusy(false); }
  };

  const cancel = async (appointmentId) => {
    if (!confirm('Cancel this appointment?')) return;
    setBusy(true); try { await cancelAppointment(appointmentId); await load(); } catch (e) { setError(e?.message || 'Cancel failed'); } finally { setBusy(false); }
  };

  const rescheduleFlow = async (appointmentId) => {
    const apt = appointments.find((a) => a.id === appointmentId);
    if (!apt) return;
    const req = (requirements || []).find((r) => r.id === apt.appointment_requirement_id);
    if (!req) { setError('Cannot resolve requirement for reschedule'); return; }
    setActiveReqId(req.id); setSlots([]); setRescheduleFrom(appointmentId);
    try { const lr = await listAppointmentLocations(applicationId, req.id); setLocations(lr.locations || []); }
    catch (e) { setError(e?.message || 'Could not load locations'); }
  };

  const rescheduleTo = async (slot) => {
    setBusy(true); setError('');
    try { await rescheduleAppointment({ appointment_id: rescheduleFrom, new_slot_id: slot.id }); await load(); setActiveReqId(null); setSlots([]); setRescheduleFrom(null); }
    catch (e) { setError(e?.message || 'Reschedule failed'); }
    finally { setBusy(false); }
  };

  const refreshStatus = async (appointmentId) => {
    setBusy(true); try { await getAppointmentStatusApi(appointmentId); await load(); } catch (e) { setError(e?.message || 'Status failed'); } finally { setBusy(false); }
  };

  if (loading) return <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]"><p className="text-sm text-slate-500">Loading appointments…</p></div>;

  return (
    <div className="mt-6 space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><CalendarDays size={16} /> Appointments</p>
          {readiness && readiness.required && !readiness.ready && <span className="text-xs text-amber-700">Action required: {readiness.blocking_items.map((b) => b.code).join(', ')}</span>}
        </div>

        {noAppointment && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-orange-50 p-3 text-sm text-orange-800">
            <CheckCircle2 size={16} /> No appointment required — your application will proceed directly to processing.
          </div>
        )}

        {requiredReqs.filter((r) => r.status === 'REQUIRED').map((r) => (
          <div key={r.id} className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">{r.type.replace(/_/g, ' ')} appointment required</p>
                <p className="text-xs text-slate-500">Source: {r.source.replace(/_/g, ' ').toLowerCase()}{r.version ? ` · ${r.version}` : ''}</p>
              </div>
              <button onClick={() => openBooking(r)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
                <CalendarDays size={13} /> Book
              </button>
            </div>
          </div>
        ))}
      </div>

      {appointments.length > 0 && (
        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <p className="text-sm font-semibold text-slate-900">Your appointments</p>
          <div className="mt-3 space-y-3">
            {appointments.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <p className="font-semibold text-slate-900 capitalize">{a.appointment_type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1"><Clock size={12} /> {fmtInTz(a.scheduled_at_utc, a.location_timezone)} <span className="text-slate-400">· {a.location_timezone}</span></p>
                    {a.external_reference && <p className="text-xs text-slate-500">Ref: <span className="font-mono">{a.external_reference}</span></p>}
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status] || 'bg-slate-100 text-slate-600'}`}>{a.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.confirmation_document_id && <span className="text-xs text-orange-700 inline-flex items-center gap-1"><FileText size={12} /> Confirmation stored</span>}
                  <button onClick={() => refreshStatus(a.id)} disabled={busy} className="text-xs text-slate-600 inline-flex items-center gap-1 hover:text-slate-900"><RefreshCw size={12} /> Refresh status</button>
                  {a.status === 'BOOKED' && <button onClick={() => rescheduleFlow(a.id)} disabled={busy} className="text-xs text-slate-600 inline-flex items-center gap-1 hover:text-slate-900"><CalendarDays size={12} /> Reschedule</button>}
                  {['BOOKED', 'RESCHEDULE_REQUIRED'].includes(a.status) && <button onClick={() => cancel(a.id)} disabled={busy} className="text-xs text-red-600 inline-flex items-center gap-1 hover:text-red-700"><X size={12} /> Cancel</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeReqId && (
        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">{rescheduleFrom ? 'Reschedule appointment' : 'Select appointment'}</p>
            <button onClick={() => { setActiveReqId(null); setSlots([]); setRescheduleFrom(null); }} className="text-xs text-slate-500 hover:text-slate-900">Close</button>
          </div>

          {!selectedLocation && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500">Location</p>
              {locations.map((l) => (
                <button key={l.external_location_id} onClick={() => loadSlots(l)} className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-slate-400">
                  <p className="text-sm font-medium text-slate-900 flex items-center gap-1"><MapPin size={13} /> {l.name}</p>
                  <p className="text-xs text-slate-500">{[l.city, l.state, l.country].filter(Boolean).join(', ')}</p>
                </button>
              ))}
            </div>
          )}

          {selectedLocation && (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Location: <span className="font-medium text-slate-700">{selectedLocation.name}</span></p>
                <button onClick={refreshSlots} disabled={loadingSlots} className="text-xs text-slate-600 inline-flex items-center gap-1 hover:text-slate-900"><RefreshCw size={12} className={loadingSlots ? 'animate-spin' : ''} /> Refresh</button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {loadingSlots && <p className="text-xs text-slate-500">Loading slots…</p>}
                {!loadingSlots && slots.length === 0 && <p className="text-xs text-slate-500">No slots available in the next 14 days. Try another location.</p>}
                {slots.filter((s) => s.availability_status === 'AVAILABLE' && (!s.expires_at || new Date(s.expires_at) > new Date())).map((s) => (
                  <button key={s.id} onClick={() => (rescheduleFrom ? rescheduleTo(s) : book(s))} disabled={busy}
                    className="rounded-lg border border-slate-200 p-2 text-left text-xs hover:border-orange-500 hover:bg-orange-50 disabled:opacity-50">
                    <p className="font-medium text-slate-900">{fmtInTz(s.start_at_utc, s.location_timezone)}</p>
                    <p className="text-slate-400">{s.duration_minutes} min</p>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400 flex items-center gap-1"><ShieldCheck size={11} /> Slots are revalidated before booking.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}