import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Plane, X, Save } from 'lucide-react';
import { listTrips, createTrip, getTripProgress } from '@/lib/visaApi';

export default function Trips() {
  const [trips, setTrips] = useState([]);
  const [progress, setProgress] = useState({});
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  const load = () => {
    listTrips().then((r) => setTrips(r.trips || [])).catch((e) => setErr(e?.message));
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    trips.forEach((g) => getTripProgress(g.id).then((p) => setProgress((prev) => ({ ...prev, [g.id]: p }))).catch(() => {}));
  }, [trips.length]);

  return (
    <div className="px-4 md:px-8 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-slate-950">Trips</h1><p className="text-sm text-slate-500">Keep family or group applications organized around the same journey.</p></div>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={15} /> New trip</button>
      </div>
      {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}

      {adding && <TripForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        {trips.length === 0 && <p className="text-sm text-slate-400">No trips yet. Create one to group family applications.</p>}
        {trips.map((g) => {
          const p = progress[g.id];
          return (
            <div key={g.id} className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
              <div className="flex items-center justify-between">
                <div><h2 className="text-base font-semibold text-slate-950">{g.name}</h2><p className="text-xs text-slate-500">{g.destination || 'Any'} · <span className="capitalize">{g.purpose}</span> · {g.travel_start ? `${g.travel_start}${g.travel_end ? ` → ${g.travel_end}` : ''}` : 'Dates TBD'}</p></div>
                <Plane size={18} className="text-slate-300" />
              </div>
              {p ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs"><span className="text-slate-600">Applications ready</span><span className="font-medium text-slate-900">{p.summary.ready} / {p.summary.total}</span></div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-orange-500" style={{ width: `${p.summary.total ? (p.summary.ready / p.summary.total) * 100 : 0}%` }} /></div>
                  <div className="mt-3 space-y-1">
                    {p.applications.map((a) => (
                      <Link key={a.id} to={`/applications/${a.id}`} className="flex items-center justify-between rounded-lg border border-slate-100 p-2 text-sm hover:bg-slate-50">
                        <span className="text-slate-700">{a.traveler_name}</span>
                        {a.ready ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">Ready</span> : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" title={a.issue}>{a.issue}</span>}
                      </Link>
                    ))}
                    {p.applications.length === 0 && <p className="text-xs text-slate-400">No applications linked yet.</p>}
                  </div>
                </div>
              ) : <p className="mt-3 text-xs text-slate-400">Loading progress…</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TripForm({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', destination: '', purpose: 'tourism', travel_start: '', travel_end: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!form.name.trim() || !form.destination.trim()) {
      setErr('Trip name and destination are required.');
      return;
    }
    if (form.travel_start && form.travel_end && form.travel_end < form.travel_start) {
      setErr('End date must be after the start date.');
      return;
    }
    setBusy(true);
    try { await createTrip(form); onSaved(); } catch (e) { setErr(e?.message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-950">New trip</h2><button onClick={onClose}><X size={18} className="text-slate-400" /></button></div>
        {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
        <div className="mt-4 space-y-3">
          <L label="Trip name" v={form.name} on={(v) => setForm({ ...form, name: v })} />
          <L label="Destination" v={form.destination} on={(v) => setForm({ ...form, destination: v.toUpperCase() })} />
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Purpose</span><select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="tourism">Tourism</option><option value="business">Business</option><option value="study">Study</option><option value="transit">Transit</option></select></label>
          <div className="grid grid-cols-2 gap-3"><L label="Start date" type="date" v={form.travel_start} on={(v) => setForm({ ...form, travel_start: v })} /><L label="End date" type="date" v={form.travel_end} on={(v) => setForm({ ...form, travel_end: v })} /></div>
        </div>
        <button onClick={submit} disabled={busy} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><Save size={15} /> {busy ? 'Creating…' : 'Create trip'}</button>
      </div>
    </div>
  );
}
function L({ label, v, on, type = 'text' }) { return <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span><input type={type} value={v || ''} onChange={(e) => on(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>; }