import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, ArrowRight, Trash2, MapPin } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { publishListSaved, publishUnsaveDestination } from '@/lib/visaApi';
import { useSeo } from '@/lib/seo';
import { trackDiscovery } from '@/lib/discoveryIntent';

// Saved destinations (§29). Does NOT create applications. Owner-only via RLS.
export default function SavedDestinations() {
  useSeo({ title: 'Saved destinations — Krosz', description: 'Destinations you saved for later.', canonical_path: '/saved', robots: 'noindex,follow' });
  const [rows, setRows] = useState(null);
  const load = () => publishListSaved().then((r) => setRows(r.saved || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const remove = async (code) => { trackDiscovery('SAVED_DESTINATION', { destination: code }); await publishUnsaveDestination(code); load(); };
  return (
    <div>
      <PageHeader eyebrow="Saved for later" title="Saved destinations" description="Destinations you're considering. Saving does not start an application." />
      <div className="mx-auto max-w-4xl px-5 py-8">
        {rows === null && <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />}
        {rows && rows.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <Heart className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">You haven't saved any destinations yet.</p>
            <Link to="/" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">Explore destinations <ArrowRight size={15} /></Link>
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
                <span className="text-3xl" aria-hidden>{r.country?.flag_emoji}</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900">{r.country?.name}</p>
                  <p className="text-xs text-slate-400"><MapPin size={11} className="mr-1 inline" />{r.country?.region}{r.badge ? ` · ${r.badge}` : ''}</p>
                </div>
                <Link to={`/visa/${r.slug}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">View</Link>
                <button onClick={() => remove(r.country_code)} aria-label="Remove saved" className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}