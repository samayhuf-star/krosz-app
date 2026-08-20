import { cn } from '@/lib/utils';

const STATUS_TEXT = {
  healthy: 'text-emerald-600',
  unhealthy: 'text-rose-600',
  invalid_key: 'text-amber-600',
  rate_limited: 'text-amber-600',
  quota_exceeded: 'text-amber-600',
  unconfigured: 'text-slate-400',
  disabled: 'text-slate-400',
  unknown: 'text-slate-400',
};
const STATUS_DOT = {
  healthy: 'bg-emerald-500',
  unhealthy: 'bg-rose-500',
  invalid_key: 'bg-amber-500',
  rate_limited: 'bg-amber-500',
  quota_exceeded: 'bg-amber-500',
  unconfigured: 'bg-slate-300',
  disabled: 'bg-slate-300',
  unknown: 'bg-slate-300',
};

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
function Tag({ children, muted }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', muted ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200')}>{children}</span>;
}

export default function ProviderMonitorCard({ p }) {
  const status = p.health_status || 'unknown';
  const success = p.success_rate == null ? null : `${Math.round(p.success_rate * 100)}%`;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{p.name}</p>
          <p className="truncate font-mono text-xs text-slate-500">{p.adapter_key}{p.default_model ? ` · ${p.default_model}` : ''}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_DOT[status])} />
          <span className={cn('text-xs font-medium capitalize', STATUS_TEXT[status])}>{status.replace('_', ' ')}</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Requests" value={p.requests} />
        <Stat label="Errors" value={p.errors} />
        <Stat label="Success" value={success ?? '—'} />
        <Stat label="Tokens" value={p.tokens || 0} />
        <Stat label="Est. cost" value={`$${(p.cost || 0).toFixed(4)}`} />
        <Stat label="Test latency" value={p.last_test_latency != null ? `${Math.round(p.last_test_latency)}ms` : '—'} />
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {p.enabled ? <Tag>enabled</Tag> : <Tag muted>disabled</Tag>}
        {p.is_default && <Tag>default</Tag>}
        {p.environment && <Tag muted>{p.environment}</Tag>}
        {p.capabilities?.vision && <Tag muted>vision</Tag>}
        {p.capabilities?.function_calling && <Tag muted>tools</Tag>}
      </div>
    </div>
  );
}