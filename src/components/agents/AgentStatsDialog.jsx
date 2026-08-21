import { useQuery } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertTriangle, Activity, DollarSign, Clock, Timer, GitBranch, ExternalLink } from 'lucide-react';
import { getAgentStats } from '@/lib/agentApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

const LIFECYCLE_TONE = {
  draft: 'bg-slate-100 text-slate-600', ready: 'bg-sky-100 text-sky-700', running: 'bg-sky-100 text-sky-700',
  waiting_approval: 'bg-amber-100 text-amber-700', completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700', paused: 'bg-slate-100 text-slate-500',
};

// Admin-only inspection of one agent (spec step 17): version, lifecycle,
// capabilities/tool permissions, budget/approval policy, recent executions,
// success rate, average latency, cost, last error, Langfuse trace.
export default function AgentStatsDialog({ agentId, open, onOpenChange }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-stats', agentId],
    queryFn: () => getAgentStats(agentId),
    enabled: !!agentId && open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{data?.agent?.name || 'Agent'}</span>
            {data && <Badge className={LIFECYCLE_TONE[data.lifecycle] || 'bg-slate-100 text-slate-600'}>{data.lifecycle}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading inspection…</div>}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {data && !isLoading && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Stat icon={GitBranch} label="Version" value={`v${data.version}`} />
              <Stat icon={CheckCircle2} label="Success rate" value={`${data.stats.success_rate}%`} />
              <Stat icon={Timer} label="Avg latency" value={data.stats.avg_latency_ms ? `${data.stats.avg_latency_ms}ms` : '—'} />
              <Stat icon={DollarSign} label="Total cost" value={data.stats.total_cost ? `$${data.stats.total_cost.toFixed(6)}` : '$0'} />
              <Stat icon={Activity} label="Total runs" value={data.stats.total_runs} />
              <Stat icon={CheckCircle2} label="Completed" value={data.stats.completed} />
              <Stat icon={AlertTriangle} label="Failed" value={data.stats.failed} />
              <Stat icon={Clock} label="Tokens" value={data.stats.total_tokens} />
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
              <p><span className="font-medium">Tools:</span> {(data.agent?.config?.tools || []).join(', ') || 'none'}</p>
              <p><span className="font-medium">Model:</span> {data.agent?.config?.model || 'automatic'} · Max iter: {data.agent?.config?.max_iterations || 2} · Max tool calls: {data.agent?.config?.max_tool_calls || 5} · Budget: {data.agent?.config?.budget_limit || 0} · Approval: {data.agent?.config?.approval_required ? 'required' : 'auto'}</p>
              {data.last_error && <p className="text-rose-600"><span className="font-medium">Last error:</span> {data.last_error.code} — {data.last_error.message}</p>}
            </div>
            {data.langfuse?.url && (
              <a href={data.langfuse.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-violet-700 hover:underline"><ExternalLink size={13} /> View Langfuse trace</a>
            )}
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs font-semibold mb-2">Recent executions</p>
              <div className="space-y-1.5">
                {(data.recent || []).length === 0 && <p className="text-xs text-muted-foreground">No runs yet.</p>}
                {(data.recent || []).map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <span className={`h-1.5 w-1.5 rounded-full ${r.status === 'completed' ? 'bg-emerald-500' : r.status === 'failed' ? 'bg-rose-500' : 'bg-slate-400'}`} />
                    <span className="font-mono text-[10px] text-muted-foreground">{(r.run_id || '').slice(-8)}</span>
                    <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                    {r.error_code && <span className="text-rose-600">{r.error_code}</span>}
                    {r.answer && <span className="truncate text-muted-foreground">{r.answer}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <div className="flex items-center gap-1 text-muted-foreground"><Icon size={12} /><span>{label}</span></div>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}