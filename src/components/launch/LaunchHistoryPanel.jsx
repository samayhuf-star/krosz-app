import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle, Pause } from 'lucide-react';
import { launchApi } from '@/lib/launchApi';

const STATUS_ICON = { completed: CheckCircle2, running: Clock, paused_approval: Pause, failed: XCircle, ready: Clock, cancelled: XCircle, draft: Clock };

export default function LaunchHistoryPanel({ businessId }) {
  const { data, isLoading } = useQuery({ queryKey: ['launch-history', businessId], queryFn: () => launchApi.history(businessId) });
  if (isLoading) return <div className="py-16 text-center text-slate-400">Loading launches…</div>;
  const plans = data?.plans || [];
  if (!plans.length) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">This is your first launch for this business. Future launches will be tracked here.</div>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Every launch is recorded for audit and rollback.</p>
      {plans.map((p) => {
        const Icon = STATUS_ICON[p.status] || Clock;
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Icon size={17} /></div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold text-slate-900">{p.goal || 'Untitled launch'}</h3>
              <p className="text-xs text-slate-500">{new Date(p.created_date).toLocaleString()} · {p.completed_steps}/{p.total_steps} steps · {p.status}</p>
            </div>
            <div className="flex-none text-right">
              <p className="text-lg font-bold text-slate-800">{p.progress}%</p>
              <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.progress}%` }} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}