import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Calendar, ShieldCheck, RefreshCw } from 'lucide-react';
import { listDestinations } from '@/lib/visaApi';
import PageHeader from '@/components/app/PageHeader';

export default function Destinations() {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = () => {
    setLoading(true); setError('');
    listDestinations().then((r) => setDestinations(r.destinations || []))
      .catch((e) => setError(e?.message || 'We couldn’t load destinations. Please try again.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="px-4 md:px-8">
      <PageHeader title="Destinations" subtitle="Choose a country to check eligibility and start an application." />
      <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
        <ShieldCheck size={13} /> Requirements are estimates until confirmed for your passport and travel details.
      </div>
      {error && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="text-sm text-rose-700">{error}</p>
          <button type="button" onClick={load} disabled={loading} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"><RefreshCw size={13} /> Retry</button>
        </div>
      )}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : !error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map((d) => (
            <div key={d.code} className="flex flex-col rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{d.flag_emoji}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{d.name}</p>
                  <p className="text-xs text-slate-400">{d.region}{d.is_schengen ? ' · Schengen' : ''}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(d.visa_types || []).map((t) => (
                  <span key={t.purpose} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 capitalize">{t.name}</span>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1"><MapPin size={12} className="capitalize" /> {d.channel}</span>
                <span className="inline-flex items-center gap-1"><Calendar size={12} /> ~{d.typical_duration_days}d</span>
              </div>
              <Link to={`/apply?destination=${encodeURIComponent(d.code)}`} className="mt-4 inline-flex items-center justify-center rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-800 hover:bg-orange-100">Check eligibility</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}