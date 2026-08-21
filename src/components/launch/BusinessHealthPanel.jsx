import { useQuery } from '@tanstack/react-query';
import { Activity, Globe, Search, Users, Bot, Rocket, TrendingUp } from 'lucide-react';
import { launchApi } from '@/lib/launchApi';

const CARDS = [
  { key: 'launch_readiness', label: 'Launch Readiness', icon: Rocket, accent: 'text-emerald-700 bg-emerald-50' },
  { key: 'website_completeness', label: 'Website Completeness', icon: Globe, accent: 'text-sky-700 bg-sky-50' },
  { key: 'seo_readiness', label: 'SEO Readiness', icon: Search, accent: 'text-violet-700 bg-violet-50' },
  { key: 'crm_readiness', label: 'CRM Readiness', icon: Users, accent: 'text-amber-700 bg-amber-50' },
  { key: 'provider_health', label: 'Provider Health', icon: Bot, accent: 'text-slate-700 bg-slate-100' },
];

export default function BusinessHealthPanel({ plan }) {
  const { data, isLoading } = useQuery({ queryKey: ['launch-health', plan.id], queryFn: () => launchApi.health(plan.id) });
  if (isLoading || !data) return <div className="py-20 text-center text-slate-400">Measuring business health…</div>;
  const h = data.health;
  const overall = h.scores.overall;
  const tone = overall >= 80 ? 'emerald' : overall >= 50 ? 'amber' : 'rose';
  return (
    <div className="space-y-5">
      <div className={`rounded-3xl border p-7 ${tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50'}`}>
        <div className="flex items-center gap-4">
          <div className={`flex h-20 w-20 items-center justify-center rounded-2xl ${tone === 'emerald' ? 'bg-emerald-600' : tone === 'amber' ? 'bg-amber-500' : 'bg-rose-500'} text-white`}>
            <span className="text-2xl font-bold">{overall}</span>
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><Activity size={14} /> Overall Business Health</div>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">{overall >= 80 ? 'Healthy & launch-ready' : overall >= 50 ? 'Mostly ready — a few gaps' : 'Needs attention'}</h2>
            <p className="mt-1 text-sm text-slate-600">{h.reasons.launch}</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(({ key, label, icon: Icon, accent }) => {
          const v = h.scores[key];
          return (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}><Icon size={16} /></div>
                <span className="text-2xl font-bold text-slate-900">{v}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-700">{label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{h.reasons[key]}</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${v}%` }} /></div>
            </div>
          );
        })}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <div className="mb-2 flex items-center gap-2 font-semibold text-slate-800"><TrendingUp size={16} /> Why this score</div>
        <ul className="space-y-1">
          {Object.entries(h.reasons).map(([k, v]) => <li key={k} className="flex gap-2"><span className="text-slate-400">•</span><span>{v}</span></li>)}
        </ul>
      </div>
    </div>
  );
}