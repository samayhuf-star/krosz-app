import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRound, Mail, Settings, LifeBuoy, ArrowRight } from 'lucide-react';
import { accountSettings } from '@/lib/visaApi';
import { useAuth } from '@/lib/AuthContext';

// Lightweight profile page reachable from the top-right account dropdown.
// Reads the existing accountSettings endpoint; no new backend logic.
export default function Profile() {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { accountSettings().then(setSettings).catch((e) => setErr(e?.message)); }, []);

  const name = settings?.profile?.full_name || user?.full_name || 'Traveler';
  const email = settings?.profile?.email || user?.email || '';
  const initial = String(name).trim().charAt(0).toUpperCase() || 'K';

  return (
    <div className="px-4 md:px-8 pb-16">
      <h1 className="text-2xl font-semibold text-slate-950">Profile</h1>
      <p className="text-sm text-slate-500">Your account details and quick links.</p>

      {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}

      <div className="mt-5 rounded-[26px] border border-slate-200/80 bg-white p-6 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#003580] text-xl font-bold text-white">{initial}</div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-slate-950">{name}</p>
            <p className="truncate text-sm text-slate-500">{email}</p>
          </div>
        </div>

        <div className="mt-5 divide-y divide-slate-100">
          <Row icon={UserRound} label="Full name" value={name} />
          <Row icon={Mail} label="Email" value={email} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Link to="/travelers" className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 hover:border-[#D6E4FF]">
          <div>
            <p className="text-sm font-semibold text-slate-900">Travelers</p>
            <p className="text-xs text-slate-500">Manage traveler profiles</p>
          </div>
          <ArrowRight size={16} className="text-[#006CEC] transition group-hover:translate-x-0.5" />
        </Link>
        <Link to="/account" className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 hover:border-[#D6E4FF]">
          <div>
            <p className="text-sm font-semibold text-slate-900">Settings</p>
            <p className="text-xs text-slate-500">Security, notifications, privacy</p>
          </div>
          <Settings size={16} className="text-[#006CEC]" />
        </Link>
        <Link to="/support" className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 hover:border-[#D6E4FF]">
          <div>
            <p className="text-sm font-semibold text-slate-900">Support</p>
            <p className="text-xs text-slate-500">Get help with your applications</p>
          </div>
          <LifeBuoy size={16} className="text-[#006CEC]" />
        </Link>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E7F0FE] text-[#006CEC]"><Icon size={16} /></span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-sm font-medium text-slate-900">{value || '—'}</p>
      </div>
    </div>
  );
}