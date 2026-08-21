import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

const time = (s) => (s ? new Date(s).toLocaleString() : '—');
const money = (n) => (n == null ? '—' : `$${Number(n).toFixed(4)}`);

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="break-all text-right text-sm font-medium text-slate-800">{value ?? '—'}</span>
    </div>
  );
}

export default function ExecutionDetailDialog({ open, onOpenChange }) {
  const r = open;
  return (
    <Dialog open={Boolean(open)} onOpenChange={(o) => !o && onOpenChange(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Execution details</DialogTitle>
        </DialogHeader>
        {r ? (
          <div className="space-y-1">
            <div className="mb-2 flex items-center gap-2">
              <Badge className={r.success ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}>{r.success ? 'success' : 'failed'}</Badge>
              <span className="font-mono text-xs text-slate-500">{r.id?.slice(-8)}</span>
            </div>
            <Row label="Provider" value={r.provider} />
            <Row label="Adapter" value={r.adapter_key} />
            <Row label="Model" value={r.model} />
            <Row label="Capability" value={r.capability} />
            <Row label="Stage / operation" value={r.stage || r.operation} />
            <Row label="Attempt" value={r.attempt} />
            <Row label="Fallback used" value={r.fallback_used ? 'Yes' : 'No'} />
            <Row label="Retry count" value={r.retry_count} />
            <Row label="Tokens" value={r.tokens} />
            <Row label="Estimated cost" value={money(r.estimated_cost)} />
            <Row label="Actual cost" value={money(r.actual_cost)} />
            <Row label="Latency" value={r.latency_ms != null ? `${r.latency_ms}ms` : '—'} />
            <Row label="Duration" value={r.duration_ms != null ? `${r.duration_ms}ms` : '—'} />
            <Row label="Run ID" value={r.run_id} />
            <Row label="LaunchTask ID" value={r.task_id} />
            <Row label="Business ID" value={r.business_id} />
            {r.error_code && <Row label="Error code" value={r.error_code} />}
            {r.error_detail && <Row label="Error detail" value={r.error_detail} />}
            <Row label="Timestamp" value={time(r.created_date || r.time)} />
            <p className="pt-2 text-[11px] text-slate-400">Provenance is recorded truthfully from the runtime. No credential values are ever present in execution records.</p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}