import HealthRing from '@/components/customer/HealthRing';

const EMOJI = { Fitness: '🏋️', Health: '🏋️', Dental: '🦷', Healthcare: '🦷', 'B2B SaaS': '🚀', 'Real Estate': '🏢', Estate: '🏢', Hostel: '🏠', Hotel: '🏨', Agency: '🎯', Marketing: '🎯', 'Food & Drink': '🍽️', Restaurant: '🍽️' };
const emojiFor = (i = '') => { if (EMOJI[i]) return EMOJI[i]; const k = Object.keys(EMOJI).find((kk) => i.includes(kk)); return k ? EMOJI[k] : '🔹'; };

// A status dot: green = active/ready, slate = none.
function Dot({ ok, title }) {
  return (
    <span className="flex flex-col items-center gap-0.5" title={title}>
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-200'}`} />
      <span className="text-[9px] uppercase tracking-wide text-slate-400">{title}</span>
    </span>
  );
}

export default function BusinessMiniCard({ business, health, counts, isActive, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className={`flex w-full flex-col rounded-2xl border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${isActive ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-slate-200'}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-lg">{emojiFor(business.industry)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{business.name}</p>
          <p className="truncate text-[11px] text-slate-400">{business.industry}{business.city ? ` · ${business.city}` : ''}</p>
        </div>
        <HealthRing score={health?.scores?.overall ?? 0} size={42} label={null} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <Dot ok={counts?.domainActive} title="Web" />
        <Dot ok={counts?.websitePublished || counts?.websiteDrafted} title="Site" />
        <Dot ok={(counts?.messages || 0) > 0} title="Mail" />
        <Dot ok={(counts?.leads || 0) > 0} title="Leads" />
        <Dot ok={(counts?.seoPages || 0) > 0} title="Growth" />
        <Dot ok={(counts?.aiExecs || 0) > 0} title="AI" />
      </div>
    </button>
  );
}