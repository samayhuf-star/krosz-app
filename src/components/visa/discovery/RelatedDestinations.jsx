import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';

// Related destinations (§16). Driven by editorial config + regional fallback.
export default function RelatedDestinations({ related = [], sourceName }) {
  if (!related.length) return null;
  return (
    <section aria-label="Related destinations">
      <div className="mb-3 flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-500" /><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{sourceName ? `You may also need` : 'You may also need'}</h2></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {related.map((r) => (
          <Link key={r.country_code} to={`/visa/${r.slug}`} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-orange-300 hover:bg-orange-50">
            <span className="text-2xl" aria-hidden>{r.flag_emoji}</span>
            <span className="text-sm font-medium text-slate-800">{r.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}