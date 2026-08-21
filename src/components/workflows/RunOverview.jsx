import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Play, XCircle, ShieldCheck, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RUN_STATUS_META, prettyKey, fmtDateTime, ACTIVE_RUN_STATES } from './statusMeta';

export default function RunOverview({ run, onStep, onCancel, busy }) {
  const { data: business } = useQuery({
    queryKey: ['business', run?.business_id],
    queryFn: () => base44.entities.Business.get(run.business_id),
    enabled: !!run?.business_id,
    staleTime: 60000,
  });
  if (!run) return null;
  const meta = RUN_STATUS_META[run.status] || RUN_STATUS_META.pending;
  const active = ACTIVE_RUN_STATES.has(run.status);
  const done = run.completed_steps || 0;
  const total = run.total_steps || 1;
  const approvals = run.status === 'awaiting_approval' || run.status === 'paused_approval';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Rocket size={16} className="text-emerald-600" />
            <h2 className="truncate text-lg font-semibold text-slate-900">{run.goal || prettyKey(run.plan_template_id)}</h2>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">{business?.name || 'Business'} · template <span className="font-mono text-xs">{run.plan_template_id}</span> v{run.plan_version}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Started {fmtDateTime(run.started_at)} · requested by {run.requested_by || 'system'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${meta.color}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${run.status === 'running' ? 'animate-pulse' : ''}`} /> {meta.label}
          </span>
          {active && (
            <Button size="sm" variant="outline" onClick={onCancel} disabled={busy} className="text-slate-600 hover:bg-slate-50">
              <XCircle size={14} /> Cancel
            </Button>
          )}
          {active && !approvals && (
            <Button size="sm" onClick={onStep} disabled={busy} className="bg-emerald-700 hover:bg-emerald-800">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Advance
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{done} of {total} steps complete</span>
          <span>{run.progress ?? 0}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${approvals ? 'bg-amber-500' : 'bg-emerald-500'} transition-all`} style={{ width: `${run.progress ?? 0}%` }} />
        </div>
      </div>

      {run.status === 'failed' && (
        <p className="mt-3 text-sm text-red-600">This workflow failed. Open a failed step to retry it from where it stopped, or skip it to continue with the rest of the plan.</p>
      )}
      {approvals && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-700"><ShieldCheck size={14} /> Waiting for your approval to continue.</p>
      )}
    </div>
  );
}