import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Loader2, Sparkles } from 'lucide-react';
import { publishSearch } from '@/lib/visaApi';
import { trackDiscovery } from '@/lib/discoveryIntent';

// Atlys-style primary visa search (§3/§5/§6). Smart: tolerates partial names,
// aliases, abbreviations, and typos. Never silently selects an ambiguous
// destination — shows the ranked list.

// Curated "Top 10 from India" quick-start suggestions. Shown the moment the
// traveler focuses the search box (before they type), so discovery starts
// instantly. All entries resolve to a real destination page route.
const TOP_DESTINATIONS_FROM_INDIA = [
  { country_code: 'AE', name: 'United Arab Emirates', slug: 'united-arab-emirates', flag_emoji: '🇦🇪', region: 'Middle East', badge: 'MVP route' },
  { country_code: 'TH', name: 'Thailand', slug: 'thailand', flag_emoji: '🇹🇭', region: 'Southeast Asia', badge: 'MVP route' },
  { country_code: 'VN', name: 'Vietnam', slug: 'vietnam', flag_emoji: '🇻🇳', region: 'Southeast Asia', badge: 'MVP route' },
  { country_code: 'ID', name: 'Indonesia', slug: 'indonesia', flag_emoji: '🇮🇩', region: 'Southeast Asia', badge: 'MVP route' },
  { country_code: 'MY', name: 'Malaysia', slug: 'malaysia', flag_emoji: '🇲🇾', region: 'Southeast Asia', badge: 'MVP route' },
  { country_code: 'SA', name: 'Saudi Arabia', slug: 'saudi-arabia', flag_emoji: '🇸🇦', region: 'Middle East', badge: 'MVP route' },
  { country_code: 'LK', name: 'Sri Lanka', slug: 'sri-lanka', flag_emoji: '🇱🇰', region: 'South Asia', badge: 'MVP route' },
  { country_code: 'TR', name: 'Turkey', slug: 'turkey', flag_emoji: '🇹🇷', region: 'Europe / Asia', badge: 'MVP route' },
  { country_code: 'OM', name: 'Oman', slug: 'oman', flag_emoji: '🇴🇲', region: 'Middle East', badge: 'MVP route' },
  { country_code: 'KH', name: 'Cambodia', slug: 'cambodia', flag_emoji: '🇰🇭', region: 'Southeast Asia', badge: 'MVP route' },
];

export default function VisaSearchBar({ defaultValue = '', onSelect = null, autoFocus = false, placeholder = 'Where are you travelling? Search a country…' }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(defaultValue);
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const boxRef = useRef(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (autoFocus && boxRef.current) boxRef.current.focus();
  }, [autoFocus]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setOpen(false); return; }
    setShowTop(false);
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    const t = setTimeout(() => {
      publishSearch(term).then((r) => {
        if (id !== reqId.current) return;
        setHits(r.hits || []);
        setOpen(true);
        trackDiscovery('SEARCH_PERFORMED', { destination: term });
      }).catch(() => { if (id === reqId.current) { setHits([]); setOpen(true); setError('Search is temporarily unavailable. Please try again.'); } }).finally(() => id === reqId.current && setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => {
      if (!e.target.closest('[data-searchbox]')) { setOpen(false); setShowTop(false); }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (hit) => {
    setOpen(false);
    setShowTop(false);
    setQ(hit.name);
    trackDiscovery('DESTINATION_SELECTED', { destination: hit.country_code });
    if (onSelect) onSelect(hit);
    else navigate(`/visa/${hit.slug}`);
  };

  const showSuggestions = showTop && q.trim().length < 2 && hits.length === 0;

  return (
    <div data-searchbox className="relative w-full">
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm focus-within:border-[#006CEC] focus-within:ring-4 focus-within:ring-[#D6E4FF]">
        <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        <input
          ref={boxRef}
          type="text"
          value={q}
          onFocus={() => { if (q.trim().length < 2) setShowTop(true); }}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label="Search a destination country"
          className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden />}
        {q && !loading && (
          <button onClick={() => { setQ(''); setHits([]); setOpen(false); setShowTop(true); }} aria-label="Clear search" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        )}
      </div>

      {showSuggestions && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <Sparkles className="h-4 w-4 text-[#006CEC]" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Top destinations from India</p>
          </div>
          <ul role="listbox" className="max-h-80 w-full overflow-y-auto p-1.5">
            {TOP_DESTINATIONS_FROM_INDIA.map((h) => (
              <li key={h.country_code}>
                <button
                  onClick={() => choose(h)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#E7F0FE]"
                  role="option"
                  aria-selected="false"
                >
                  <span className="text-2xl" aria-hidden>{h.flag_emoji}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{h.name}</span>
                    <span className="block text-xs text-slate-400">{h.region}</span>
                  </span>
                  {h.badge && <span className="rounded-full bg-[#D6E4FF] px-2 py-0.5 text-[11px] font-medium text-[#003580]">{h.badge}</span>}
                  <span className="sr-only">{h.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && hits.length > 0 && (
        <ul role="listbox" className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {hits.map((h) => (
            <li key={h.country_code + h.match_type}>
              <button
                onClick={() => choose(h)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#E7F0FE]"
                role="option"
                aria-selected="false"
              >
                <span className="text-2xl" aria-hidden>{h.flag_emoji}</span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{h.name}</span>
                  <span className="block text-xs text-slate-400">{h.region}{h.alias ? ` · matched "${h.alias}"` : ''}</span>
                </span>
                {h.badge && <span className="rounded-full bg-[#D6E4FF] px-2 py-0.5 text-[11px] font-medium text-[#003580]">{h.badge}</span>}
                <span className="sr-only">{h.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && hits.length === 0 && (
        <div className="absolute z-30 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-xl">
          {error || <>No destination found for “{q}”. Try a country name or abbreviation.</>}
        </div>
      )}
    </div>
  );
}