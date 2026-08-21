import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { publishPopular } from '@/lib/visaApi';

// Popular destinations rail (§7). Popularity comes from configuration/analytics,
// not hard-coded UI — driven by FeaturedDestination rows. Cards always include
// the country name (never flags alone, §42).

export default function PopularDestinations({ limit = 8 }) {
  const [dests, setDests] = useState(null);
  useEffect(() => { publishPopular(limit).then((r) => setDests(r.destinations || [])).catch(() => setDests([])); }, [limit]);
  if (!dests) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}</div>;
  if (!dests.length) return null;
  return (
    <section aria-label="Popular destinations">
      <div className="mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[#006CEC]" /><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Popular destinations</h2></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {dests.map((d) => (
          <Link key={d.country_code} to={`/visa/${d.slug}`} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-[#006CEC] hover:shadow-md">
            <span className="text-3xl" aria-hidden>{d.country?.flag_emoji}</span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-slate-900 group-hover:text-[#003580]">{d.country?.name}</span>
              {d.badge && <span className="mt-1 inline-block rounded-full bg-[#D6E4FF] px-2 py-0.5 text-[11px] font-medium text-[#003580]">{d.badge}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}