import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { RefreshCw, SkipForward, ShieldCheck, Check, X, Cpu, Coins } from 'lucide-react';
import { STATUS_META, prettyKey, fmtDuration, fmtDateTime } from './statusMeta';

// Drawer for a single node: full status, duration, retries, dependencies,
// logs, input context, output, error, and the per-execution history (provider,
// model, stage, tokens, cost). Actions: Retry / Skip (failed), Approve / Reject
// (approval gate). All read straight from persisted task + AIExecution data.
export default function NodeDetailSheet({ task, executions = [], busy, onRetry, onSkip, onApprove, onReject, onClose }) {
  const open = !!task;
  const meta = task ? STATUS_META[task.status] || STATUS_META.pending : null;
  const taskExecs = task ? executions.filter((e) => e.task_id === task.id) : [];
  const tokens = taskExecs.reduce((s, e) => s + (Number(e.tokens) || 0), 0);
  const cost = taskExecs.reduce((s, e) => s + (Number(e.estimated_cost) || 0), 0);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {task && (
          <>
            <SheetHeader>
              <SheetDescription>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.color}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                </span>
              </SheetDescription>
              <SheetTitle className="text-xl">{task.name || prettyKey(task.task_key)}</SheetTitle>
              <SheetDescription className="font-mono text-[11px]">{task.task_key} · {task.type}</SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Duration" value={task.duration_ms ? fmtDuration(task.duration_ms) : '—'} />
                <Stat label="Retries" value={`${task.retry_count || 0} / ${task.max_retries || 3}`} />
                <Stat label="Started" value={fmtDateTime(task.started_at) || '—'} />
                <Stat label="Finished" value={fmtDateTime(task.completed_at) || '—'} />
              </div>

              {!!(task.depends_on && task.depends_on.length) && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dependencies</p>
                  <div className="flex flex-wrap gap-1.5">
                    {task.depends_on.map((d) => (
                      <span key={d} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{prettyKey(d)}</span>
                    ))}
                  </div>
                </div>
              )}

              {task.error_code && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
                  <p className="font-semibold text-red-700">{task.error_code}</p>
                  {task.error_detail && <p className="mt-1 text-red-600">{task.error_detail}</p>}
                </div>
              )}

              {/* execution history */}
              {taskExecs.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Execution history</p>
                  <div className="space-y-2">
                    {taskExecs.slice().reverse().map((e) => (
                      <div key={e.id} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700">{e.stage}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${e.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {e.success ? 'ok' : e.error_code || 'fail'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-slate-500">
                          {e.provider && <span className="inline-flex items-center gap-1"><Cpu size={11} /> {e.provider}</span>}
                          {e.model && <span className="font-mono text-[10px]">· {e.model}</span>}
                          {e.attempt > 0 && <span>attempt {e.attempt}</span>}
                        </div>
                        <div className="mt-1 flex gap-x-3 text-slate-500">
                          {e.tokens > 0 && <span className="inline-flex items-center gap-1"><Cpu size={11} /> {e.tokens} tok</span>}
                          {cost > 0 && <span className="inline-flex items-center gap-1"><Coins size={11} /> ${Number(e.estimated_cost).toFixed(4)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {tokens > 0 && (
                    <p className="mt-2 text-[11px] text-slate-400">Total: {tokens.toLocaleString()} tokens · ${cost.toFixed(4)}</p>
                  )}
                </div>
              )}

              {/* logs */}
              {Array.isArray(task.logs) && task.logs.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Logs</p>
                  <pre className="max-h-44 overflow-y-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-5 text-slate-200">
                    {task.logs.map((l) => `[${l.level || 'info'}] ${l.message || ''}`).join('\n')}
                  </pre>
                </div>
              )}

              {/* output */}
              {task.output && Object.keys(task.output).length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Output</p>
                  <pre className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-slate-700">
                    {JSON.stringify(task.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <SheetFooter>
              {task.status === 'failed' && (
                <div className="flex w-full gap-2">
                  <Button variant="outline" size="sm" onClick={() => onSkip(task)} disabled={busy} className="flex-1"><SkipForward size={14} /> Skip</Button>
                  <Button size="sm" onClick={() => onRetry(task)} disabled={busy} className="flex-1 bg-amber-600 hover:bg-amber-700"><RefreshCw size={14} /> Retry from here</Button>
                </div>
              )}
              {task.status === 'awaiting_approval' && (
                <div className="flex w-full gap-2">
                  <Button variant="outline" size="sm" onClick={() => onReject(task)} disabled={busy} className="flex-1 border-rose-200 text-rose-700 hover:bg-rose-50"><X size={14} /> Reject</Button>
                  <Button size="sm" onClick={() => onApprove(task)} disabled={busy} className="flex-1 bg-emerald-700 hover:bg-emerald-800"><Check size={14} /> Approve</Button>
                </div>
              )}
              {task.status !== 'failed' && task.status !== 'awaiting_approval' && (
                <p className="w-full text-center text-[11px] text-slate-400">
                  {task.needs_approval || task.type === 'approval_gate' ? <ShieldCheck size={11} className="mr-1 inline" /> : null}
                  {task.status === 'completed' ? 'This step is complete.' : 'This step has no pending action.'}
                </p>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 font-medium text-slate-800">{value}</p>
    </div>
  );
}