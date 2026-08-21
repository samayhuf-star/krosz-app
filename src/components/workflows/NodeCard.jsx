import { ShieldCheck, BadgeDollarSign, RefreshCw, Ban, ChevronRight } from 'lucide-react';
import { STATUS_META, prettyKey, fmtDuration } from './statusMeta';

// A single DAG node card — status, type, duration, retries, dependencies,
// approval/money badges. Clicking opens the node detail drawer.
export default function NodeCard({ task, onSelect, selected }) {
  const meta = STATUS_META[task.status] || STATUS_META.pending;
  const Icon = meta.icon;
  const deps = task.depends_on || [];
  const isGateway = task.type === 'approval_gate';

  return (
    <button
      onClick={() => onSelect(task)}
      className={`group relative flex w-full flex-col rounded-2xl border bg-white p-3.5 text-left shadow-sm transition-all hover:shadow-md ${
        selected ? 'border-emerald-400 ring-2 ring-emerald-300' : 'border-slate-200'
      } ${meta.pulse && task.status === 'running' ? 'ring-2 ring-sky-300/40' : ''}`}
    >
      {/* status dot */}
      <div className="absolute -left-1.5 top-5">
        <span className={`block h-3 w-3 rounded-full ${meta.dot} ${meta.spin ? 'animate-spin' : ''} ${meta.pulse ? 'animate-pulse' : ''}`} />
      </div>

      <div className="flex items-center gap-2 pl-1.5">
        <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg border ${meta.color}`}>
          <Icon size={15} className={meta.spin ? 'animate-spin' : ''} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
          {task.name || prettyKey(task.task_key)}
        </span>
        <ChevronRight size={15} className="flex-none text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400" />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.color}`}>
          {meta.label}
        </span>
        {isGateway && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            <ShieldCheck size={10} /> Gate
          </span>
        )}
        {task.money_spending && !isGateway && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700">
            <BadgeDollarSign size={10} /> Spend
          </span>
        )}
        {task.retry_count > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            <RefreshCw size={10} /> {task.retry_count}/{task.max_retries || 3}
          </span>
        )}
      </div>

      {task.status !== 'blocked' && (
        <p className="mt-1.5 pl-1.5 text-[10px] text-slate-400">
          {task.duration_ms ? fmtDuration(task.duration_ms) : deps.length ? `after ${deps.map(prettyKey).join(', ')}` : 'first step'}
        </p>
      )}
      {task.status === 'blocked' && (
        <p className="mt-1.5 inline-flex items-center gap-1 pl-1.5 text-[10px] font-medium text-rose-600">
          <Ban size={10} /> blocked by {(task.error_detail || '').replace('Blocked by: ', '')}
        </p>
      )}
    </button>
  );
}