import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import HealthRing from '@/components/customer/HealthRing';

const EMOJI = { Fitness: '🏋️', Health: '🏋️', Dental: '🦷', Healthcare: '🦷', 'B2B SaaS': '🚀', 'Real Estate': '🏢', Estate: '🏢', Hostel: '🏠', Hotel: '🏨', Agency: '🎯', Marketing: '🎯', 'Food & Drink': '🍽️', Restaurant: '🍽️' };
const emojiFor = (i = '') => {
  if (EMOJI[i]) return EMOJI[i];
  const k = Object.keys(EMOJI).find((kk) => i.includes(kk));
  return k ? EMOJI[k] : '🔹';
};

function Pill({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />{label}
    </span>
  );
}

export default function BusinessCard({ business, health, counts, isActive }) {
  const navigate = useNavigate();
  return (
    <div className={`flex flex-col rounded-3xl border bg-white p-5 shadow-sm transition-all hover:shadow-md ${isActive ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl">{emojiFor(business.industry)}</span>
          <div>
            <h3 className="text-lg font-semibold leading-tight text-slate-900">{business.name}</h3>
            <p className="text-xs text-slate-500">{business.industry}{business.city ? ` · ${business.city}` : ''}</p>
          </div>
        </div>
        {isActive && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">Active</span>}
      </div>

      <div className="mt-4 flex items-center gap-4">
        <HealthRing score={health?.scores?.overall ?? 0} size={80} label={null} />
        <div className="flex-1">
          <div className="flex flex-wrap gap-1.5">
            <Pill ok={counts?.domainActive} label="Domain" />
            <Pill ok={counts?.websitePublished || counts?.websiteDrafted} label="Website" />
            <Pill ok={(counts?.seoPages || 0) > 0} label="SEO" />
            <Pill ok={(counts?.leads || 0) > 0} label="CRM" />
            <Pill ok={(counts?.messages || 0) > 0} label="Email" />
            <Pill ok={(counts?.aiExecs || 0) > 0} label="AI" />
          </div>
          <p className="mt-2 text-xs text-slate-400">{health?.reasons?.overall}</p>
        </div>
      </div>

      <button
        onClick={() => navigate('/')}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
      >
        Open <ArrowRight size={15} />
      </button>
    </div>
  );
}