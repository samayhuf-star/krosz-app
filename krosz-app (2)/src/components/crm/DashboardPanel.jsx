import { UserPlus, BadgeCheck, DollarSign, TrendingUp, CheckSquare, CalendarClock, Filter, GitBranch, Award, LayoutDashboard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const ICONS = { UserPlus, BadgeCheck, DollarSign, TrendingUp, CheckSquare, CalendarClock, Filter, GitBranch, Award };

const SPAN = { sm: 'sm:col-span-2 lg:col-span-1', md: 'sm:col-span-2 lg:col-span-2', lg: 'lg:col-span-3' };

export default function DashboardPanel({ widgets }) {
  const list = widgets || [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600"><LayoutDashboard size={15} className="text-emerald-700" />This is a preview of the dashboard the CRM will render once leads flow through the pipeline.</div>
      {!list.length ? <p className="text-sm text-slate-500">No widgets configured.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((w) => {
            const Icon = ICONS[w.icon_hint] || TrendingUp;
            return (
              <div key={w.id || w.key} className={`rounded-2xl border border-slate-200 bg-white p-5 ${SPAN[w.size] || SPAN.md}`}>
                <div className="flex items-center justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon size={18} /></span><Badge variant="outline" className="border-slate-200 font-mono text-xs uppercase text-slate-400">{w.metric.replace(/_/g, ' ')}</Badge></div>
                <p className="mt-3 font-semibold text-slate-900">{w.title}</p>
                <p className="mt-0.5 font-mono text-xs text-slate-400">{w.data_source}</p>
                {w.config?.unit === 'currency' && <p className="mt-2 text-2xl font-bold text-emerald-700">$—</p>}
                {w.config?.unit === 'percent' && <p className="mt-2 text-2xl font-bold text-emerald-700">—%</p>}
                {(w.config?.stages || w.config?.sources || w.config?.services)?.length ? <p className="mt-2 text-xs text-slate-500">{(w.config.stages || w.config.sources || w.config.services).length} segments tracked</p> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}