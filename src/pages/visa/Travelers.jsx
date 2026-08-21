import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Star, Archive, Save, X, ShieldCheck, Plane } from 'lucide-react';
import { accountListTravelers, accountCreateTraveler, accountUpdateTraveler, accountArchiveTraveler, accountSetPrimary, accountGetTraveler, listTravelerApplications, addPassport } from '@/lib/visaApi';
import TravelerSwitcher from '@/components/visa/travelers/TravelerSwitcher';

const RELATIONSHIPS = ['SELF', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'FAMILY', 'FRIEND', 'OTHER'];

export default function Travelers() {
  const [travelers, setTravelers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setErr('');
    return accountListTravelers()
      .then((r) => {
        const list = r.travelers || [];
        setTravelers(list);
        if (!selectedId && list.length) setSelectedId(list[0].id);
        if (selectedId && !list.some((t) => t.id === selectedId)) setSelectedId(list[0]?.id || '');
      })
      .catch((e) => setErr(e?.message || 'We couldn’t load your travelers.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const loadDetail = () => {
    if (!selectedId) return Promise.resolve();
    setDetail(null);
    return Promise.all([accountGetTraveler(selectedId), listTravelerApplications(selectedId)])
      .then(([td, ad]) => setDetail({ traveler: td.traveler, passports: td.passports || [], applications: ad.applications || [] }))
      .catch((e) => setErr(e?.message));
  };
  useEffect(() => { loadDetail(); }, [selectedId]);

  const selected = travelers.find((t) => t.id === selectedId);

  return (
    <div className="px-4 md:px-8 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-950">Travelers</h1>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={15} /> Add traveler</button>
      </div>
      <p className="text-sm text-slate-500">Manage profiles for yourself and family members. Each application belongs to exactly one traveler.</p>

      {/* Traveler switcher (§42) — whose data is shown */}
      {travelers.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Viewing</p>
          <TravelerSwitcher travelers={travelers} selectedId={selectedId} onSelect={setSelectedId} />
          <p className="mt-2 text-[11px] text-slate-500">Documents, applications, and passports below belong to the selected traveler.</p>
        </div>
      )}
      {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{err}</p>}
      {loading && <p className="mt-5 text-sm text-slate-500" role="status">Loading travelers…</p>}
      {!loading && travelers.length === 0 && !adding && (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">No traveler profiles yet</p>
          <p className="mt-1 text-sm text-slate-500">Add yourself or a family member to start an application and store documents.</p>
          <button type="button" onClick={() => setAdding(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"><Plus size={15} /> Add your first traveler</button>
        </div>
      )}

      {/* Add form (§43 — explicit applying-for) */}
      {adding && <TravelerForm existingTravelers={travelers} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}

      {/* Selected traveler detail */}
      {detail?.traveler && (
        <div className="mt-5 space-y-4">
          <DetailCard traveler={detail.traveler} passports={detail.passports} applications={detail.applications}
            onEdit={() => setEditing(true)}
            onArchive={() => accountArchiveTraveler(selectedId).then(load).catch((e) => setErr(e?.message || 'Could not archive this traveler.'))}
            onPrimary={() => accountSetPrimary(selectedId).then(load).catch((e) => setErr(e?.message || 'Could not update the primary traveler.'))}
            onPassportSaved={loadDetail} />
        </div>
      )}

      {editing && detail?.traveler && (
        <TravelerForm traveler={detail.traveler} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}
    </div>
  );
}

function DetailCard({ traveler, passports, applications, onEdit, onArchive, onPrimary, onPassportSaved }) {
  const [showPassport, setShowPassport] = useState(false);
  return (
    <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{traveler.first_name} {traveler.last_name} {traveler.is_primary && <span className="ml-1 text-[11px] font-semibold text-orange-600">★ Primary</span>}</h2>
          <p className="text-sm text-slate-500">{traveler.relationship || '—'} · {traveler.nationality} · {traveler.email || 'No email'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onPrimary} disabled={traveler.is_primary} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Star size={13} /> Set primary</button>
          <button onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Edit</button>
          <button onClick={onArchive} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"><Archive size={13} /> Archive</button>
        </div>
      </div>
      <Completeness traveler={traveler} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><ShieldCheck size={13} /> Passports</h3>
            <button type="button" onClick={() => setShowPassport(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"><Plus size={12} /> Add passport</button>
          </div>
          <div className="mt-2 space-y-1.5">
            {passports.length === 0 && <p className="text-xs text-slate-400">No passport records yet — add one below.</p>}
            {passports.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{p.passport_number} · {p.country}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${p.expiry_status === 'VALID' ? 'bg-orange-100 text-orange-700' : p.expiry_status === 'EXPIRING_SOON' ? 'bg-amber-100 text-amber-700' : p.expiry_status === 'EXPIRED' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{p.expiry_status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Plane size={13} /> Applications</h3>
            <Link to="/destinations" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"><Plus size={12} /> Start application</Link>
          </div>
          <div className="mt-2 space-y-1.5">
            {applications.length === 0 && <p className="text-xs text-slate-400">No applications for this traveler yet.</p>}
            {applications.map((a) => (
              <Link key={a.id} to={`/applications/${a.id}`} className="flex items-center justify-between rounded-lg border border-slate-100 p-2 text-sm hover:bg-slate-50">
                <span className="text-slate-700">{a.destination} · <span className="capitalize">{a.purpose}</span></span>
                <span className="text-xs text-slate-500">{a.status}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {showPassport && (
        <PassportForm traveler={traveler} onClose={() => setShowPassport(false)} onSaved={() => { setShowPassport(false); onPassportSaved?.(); }} />
      )}
    </div>
  );
}

function Completeness({ traveler }) {
  const score = traveler.profile_completeness || 0;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs"><span className="font-medium text-slate-600">Profile completeness</span><span className="text-slate-500">{score}%</span></div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-orange-500" style={{ width: `${score}%` }} /></div>
      <p className="mt-1 text-[10px] text-slate-400">Convenience indicator — not visa eligibility.</p>
    </div>
  );
}

export function TravelerForm({ traveler = null, existingTravelers = [], onClose, onSaved }) {
  const hasSelf = existingTravelers.some((t) => t.relationship === 'SELF' && !t.archived_at);
  const [form, setForm] = useState(traveler || { first_name: '', last_name: '', date_of_birth: '', gender: '', nationality: 'IN', relationship: hasSelf ? 'FAMILY' : 'SELF', email: '', phone: '', residence_country: 'IN' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!form.first_name?.trim() || !form.last_name?.trim() || !form.date_of_birth || !form.nationality?.trim()) {
      setErr('First name, last name, date of birth, and nationality are required.');
      return;
    }
    const dob = new Date(form.date_of_birth);
    if (Number.isNaN(dob.getTime()) || dob >= new Date()) { setErr('Enter a valid date of birth in the past.'); return; }
    if (form.relationship === 'SELF' && hasSelf && !traveler?.id) { setErr('Your own traveler profile already exists. Choose the existing profile or select another relationship.'); return; }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setErr('Enter a valid email address.'); return; }
    if (!/^[A-Z]{2}$/.test(form.nationality || '') || !/^[A-Z]{2}$/.test(form.residence_country || '')) { setErr('Choose valid countries for nationality and residence.'); return; }
    setBusy(true);
    try {
      if (traveler?.id) await accountUpdateTraveler(traveler.id, form);
      else await accountCreateTraveler(form);
      onSaved();
    } catch (e) { setErr(e?.message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="traveler-form-title">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between"><h2 id="traveler-form-title" className="text-lg font-semibold text-slate-950">{traveler ? 'Edit traveler' : 'Add traveler'}</h2><button type="button" onClick={onClose} aria-label="Close traveler form"><X size={18} className="text-slate-400" /></button></div>
        {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
        {traveler ? null : (
          // Wrong-traveler safeguard (§43): show applying-for context before creating.
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">You're creating a profile for: <span className="font-semibold">{form.first_name || 'New traveler'}</span> · <span className="font-semibold">{form.relationship}</span>. This profile will be reusable for future applications.</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="First name" value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })} />
          <Field label="Last name" value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })} />
          <Field label="Date of birth" type="date" value={form.date_of_birth} onChange={(v) => setForm({ ...form, date_of_birth: v })} />
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Gender</span><select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">Prefer not to say</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
          <Field label="Nationality" value={form.nationality} onChange={(v) => setForm({ ...form, nationality: v.toUpperCase() })} />
          <Field label="Residence country" value={form.residence_country} onChange={(v) => setForm({ ...form, residence_country: v.toUpperCase() })} />
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">Relationship</span><select value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">{RELATIONSHIPS.map((r) => <option key={r} value={r} disabled={r === 'SELF' && hasSelf && !traveler?.id}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}</select></label>
          <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        </div>
        <button onClick={submit} disabled={busy} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><Save size={15} /> {busy ? 'Saving…' : 'Save traveler'}</button>
      </div>
    </div>
  );
}

function PassportForm({ traveler, onClose, onSaved }) {
  const [form, setForm] = useState({ passport_number: '', country: (traveler?.nationality || 'IN').toUpperCase(), nationality: (traveler?.nationality || 'IN').toUpperCase(), issue_date: '', expiry_date: '', surname: traveler?.last_name || '', given_names: traveler?.first_name || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setErr('');
    if (!form.passport_number?.trim() || !form.country?.trim()) { setErr('Passport number and issuing country are required.'); return; }
    if (!/^[A-Z]{2}$/.test(form.country)) { setErr('Country must be a 2-letter code (e.g. IN).'); return; }
    if (form.expiry_date && form.issue_date && form.expiry_date < form.issue_date) { setErr('Expiry date must be after the issue date.'); return; }
    setBusy(true);
    try { await addPassport(traveler.id, form); onSaved(); }
    catch (e) { setErr(e?.message || 'Could not save the passport.'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="passport-form-title">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between"><h2 id="passport-form-title" className="text-lg font-semibold text-slate-950">Add passport</h2><button type="button" onClick={onClose} aria-label="Close passport form"><X size={18} className="text-slate-400" /></button></div>
        <p className="mt-1 text-xs text-slate-500">For {traveler.first_name} {traveler.last_name}. Used to pre-fill visa application forms.</p>
        {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Passport number" value={form.passport_number} onChange={(v) => set('passport_number', v.toUpperCase())} />
          <Field label="Issuing country" value={form.country} onChange={(v) => set('country', v.toUpperCase())} />
          <Field label="Surname (as on passport)" value={form.surname} onChange={(v) => set('surname', v)} />
          <Field label="Given names" value={form.given_names} onChange={(v) => set('given_names', v)} />
          <Field label="Issue date" type="date" value={form.issue_date} onChange={(v) => set('issue_date', v)} />
          <Field label="Expiry date" type="date" value={form.expiry_date} onChange={(v) => set('expiry_date', v)} />
        </div>
        <button onClick={submit} disabled={busy} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><Save size={15} /> {busy ? 'Saving…' : 'Save passport'}</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span><input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>;
}