import { useEffect, useState } from 'react';
import { Shield, Bell, Lock, Trash2, AlertTriangle, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { accountSettings, requestDeletion, cancelDeletion, deletionStatus, accountAudit } from '@/lib/visaApi';
import { useAuth } from '@/lib/AuthContext';

const DELETION_LABELS = { PENDING: 'Requested', RETENTION_CHECKED: 'Checks complete', PROCESSING: 'Processing', COMPLETED: 'Completed', CANCELLED: 'Cancelled', BLOCKED: 'Action required' };

function normalizeDeletion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value.deletion_request && typeof value.deletion_request === 'object' ? value.deletion_request : value;
  const status = typeof source.status === 'string' && !/^\d{3}$/.test(source.status) ? source.status.toUpperCase() : null;
  if (!status) return null;
  return { ...source, status, active_applications: Number(source.active_applications) || 0, active_orders: Number(source.active_orders) || 0 };
}

function humanizeAction(value = '') {
  const labels = { PASSPORT_ADDED: 'Passport added', TRAVELER_UPDATED: 'Traveler profile updated', DOCUMENT_ADDED: 'Document added', APPLICATION_CREATED: 'Application started' };
  const key = String(value).toUpperCase().replace(/\s+/g, '_');
  return labels[key] || String(value).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

function dedupeAudit(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.action || ''}:${event.summary || ''}:${String(event.created_date || '').slice(0, 16)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function AccountSettings() {
  const { logout } = useAuth();
  const [tab, setTab] = useState('profile');
  const [settings, setSettings] = useState(null);
  const [deletion, setDeletion] = useState(null);
  const [audit, setAudit] = useState([]);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState('');

  const load = () => {
    accountSettings().then(setSettings).catch((e) => setErr(e?.message));
    deletionStatus().then((r) => setDeletion(normalizeDeletion(r))).catch(() => setDeletion(null));
    accountAudit().then((r) => setAudit(r.events || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const TABS = [
    { key: 'profile', label: 'Profile', icon: Shield },
    { key: 'security', label: 'Security', icon: Lock },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'privacy', label: 'Privacy & data', icon: Trash2 },
  ];

  return (
    <div className="px-4 md:px-8 pb-16">
      <h1 className="text-2xl font-semibold text-slate-950">Account settings</h1>
      <p className="text-sm text-slate-500">Account-level settings are distinct from any single application.</p>

      <div className="mt-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${tab === t.key ? 'bg-[#003580] text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}><t.icon size={14} /> {t.label}</button>)}
      </div>

      {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}

      {tab === 'profile' && settings?.profile && (
        <div className="mt-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <p className="text-sm text-slate-700"><span className="font-medium">Name:</span> {settings.profile.full_name || '—'}</p>
          <p className="text-sm text-slate-700"><span className="font-medium">Email:</span> {settings.profile.email}</p>
          <Link to="/travelers" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#003580] hover:underline">Manage travelers →</Link>
        </div>
      )}

      {tab === 'security' && (
        <div className="mt-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-slate-900"><Lock size={16} /> Security</h2>
          <p className="mt-1 text-sm text-slate-600">Manage your password and sign-in security.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/forgot-password" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Reset password</Link>
            <button type="button" onClick={() => { if (confirm('Sign out?')) logout(true); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Sign out</button>
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="mt-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-slate-900"><Bell size={16} /> Notification preferences</h2>
          <p className="mt-1 text-sm text-slate-600">Choose how you receive important visa and application updates.</p>
          <Link to="/profile/notifications" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#003580] hover:underline">Open preferences →</Link>
        </div>
      )}

      {tab === 'privacy' && (
        <div className="mt-4 space-y-4">
          <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-slate-900"><Shield size={16} /> Privacy controls</h2>
            <p className="mt-1 text-sm text-slate-600">You control your account, traveler, document, and communication data. Some application and payment records may need to be retained for legal or operational reasons.</p>
          </div>

          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <h3 className="flex items-center gap-1.5 text-base font-semibold text-rose-900"><AlertTriangle size={16} /> Delete account</h3>
            {deletion ? (
              <div className="mt-2">
                <p className="text-sm text-rose-800">Deletion request: <span className="font-semibold">{DELETION_LABELS[deletion.status] || 'Under review'}</span>.</p>
                {deletion.retention_note && <p className="mt-1 text-xs text-rose-700">{deletion.retention_note}</p>}
                {(deletion.active_applications > 0 || deletion.active_orders > 0) && <p className="text-xs text-rose-700">Before deletion can continue: {deletion.active_applications || 0} active application(s) and {deletion.active_orders || 0} active order(s) must be resolved.</p>}
                {['PENDING', 'RETENTION_CHECKED', 'PROCESSING'].includes(deletion.status) && (
                  <button onClick={() => cancelDeletion().then(load)} className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50">Cancel deletion request</button>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-sm text-rose-800">We’ll check for active applications and orders, anonymize eligible data, and then deactivate the account. You can cancel until processing begins.</p>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="mt-2 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm" rows={2} />
                <button onClick={() => requestDeletion(reason).then(load).catch((e) => setErr(e?.message))} className="mt-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">Request account deletion</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Customer-visible account activity */}
      <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><History size={15} /> Account activity</h2>
        <div className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto">
          {audit.length === 0 && <p className="text-sm text-slate-400">No recorded activity yet.</p>}
          {dedupeAudit(audit).map((a) => <div key={a.id} className="py-2 text-xs"><span className="font-medium text-slate-800">{humanizeAction(a.action)}</span> {a.summary && <span className="text-slate-500">· {a.summary}</span>}<div className="text-slate-400">{new Date(a.created_date).toLocaleString()}</div></div>)}
        </div>
      </div>
    </div>
  );
}