import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, SlidersHorizontal, RefreshCw } from 'lucide-react';
import DiscoveryHeader from '@/components/visa/discovery/DiscoveryHeader';
import VisaSearchBar from '@/components/visa/discovery/VisaSearchBar';
import { publishSearch, listNationalities, listTravelPurposes } from '@/lib/visaApi';
import { trackDiscovery, getDiscoveryIntent } from '@/lib/discoveryIntent';
import { useSeo } from '@/lib/seo';

const PURPOSES_FALLBACK = [
  { key: 'tourism', label: 'Tourism' }, { key: 'business', label: 'Business' }, { key: 'study', label: 'Study' }, { key: 'transit', label: 'Transit' },
];

export default function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const purpose = params.get('purpose') || 'tourism';
  const [hits, setHits] = useState(null);
  const [nationalities, setNationalities] = useState([]);
  const [purposes, setPurposes] = useState(PURPOSES_FALLBACK);
  const [searchError, setSearchError] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const nationality = params.get('nationality') || 'IN';

  useSeo({ title: q ? `Search: ${q} — Krosz` : 'Search destinations — Krosz', description: 'Search supported visa destinations by country, abbreviation, or city.', canonical_path: '/search', robots: 'noindex,follow' });

  useEffect(() => {
    listNationalities().then((r) => setNationalities(r.nationalities || [])).catch(() => {});
    listTravelPurposes().then((r) => setPurposes(r.purposes?.length ? r.purposes : PURPOSES_FALLBACK)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!q) { setHits([]); setSearchError(''); return; }
    setHits(null); setSearchError('');
    publishSearch(q, { nationality, purpose })
      .then((r) => { setHits(r.hits || []); trackDiscovery('SEARCH_PERFORMED', { destination: q }); })
      .catch((e) => { setHits([]); setSearchError(e?.message || 'We couldn’t search destinations. Please try again.'); });
  }, [q, nationality, purpose, searchAttempt]);

  const intent = getDiscoveryIntent();
  const set = (k, v) => { const next = new URLSearchParams(params); if (v) next.set(k, v); else next.delete(k); setParams(next, { replace: true }); };

  return (
    <div className="min-h-screen bg-white">
      <DiscoveryHeader />
      <div className="mx-auto max-w-4xl px-5 pt-8">
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">← Back to home</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Visa search</h1>
        <p className="mt-1 text-sm text-slate-500">Search results for “{q || '—'}”.</p>

        {intent && intent.intent === 'start' && (
          <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">You have a pending selection — <Link to={`/visa/${intent.slug}`} className="font-semibold underline">continue to {intent.destinationName || intent.destination}</Link>.</div>
        )}

        <div className="mt-5"><VisaSearchBar defaultValue={q} onSelect={(h) => set('q', h.name)} /></div>

        {/* Filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <SlidersHorizontal className="h-4 w-4 text-slate-400" />
          <label className="flex items-center gap-2 text-sm"><span className="text-slate-500">Passport</span>
            <select value={nationality} onChange={(e) => set('nationality', e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
              {nationalities.length ? nationalities.map((n) => <option key={n.code} value={n.code}>{n.name}</option>) : <option value="IN">Indian</option>}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><span className="text-slate-500">Purpose</span>
            <select value={purpose} onChange={(e) => set('purpose', e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
              {purposes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
        </div>

        {/* Results */}
        <div className="mt-6 space-y-3">
          {hits === null && <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />}
          {searchError && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6" role="alert"><p className="text-sm text-rose-700">{searchError}</p><button type="button" onClick={() => setSearchAttempt((n) => n + 1)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"><RefreshCw size={13} /> Retry search</button></div>}
          {!searchError && hits && hits.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No destinations matched. Try a country name or abbreviation like “USA” or “UK”.</div>}
          {hits && hits.map((h) => (
            <Link key={h.country_code} to={`/visa/${h.slug}`} onClick={() => trackDiscovery('DESTINATION_SELECTED', { destination: h.country_code })} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-orange-300 hover:bg-orange-50/40">
              <span className="text-3xl" aria-hidden>{h.flag_emoji}</span>
              <div className="flex-1">
                <p className="text-base font-semibold text-slate-900">{h.name}</p>
                <p className="text-xs text-slate-400">{h.region}{h.active_visa ? ' · Visa routes available' : ' · Visa data being verified'}{h.badge ? ` · ${h.badge}` : ''}</p>
              </div>
              <Search className="h-4 w-4 text-slate-400" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}