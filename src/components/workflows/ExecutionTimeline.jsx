import { CheckCircle2, AlertTriangle, ShieldCheck, Play, SkipForward } from 'lucide-react';
import { STATUS_META, prettyKey, fmtDateTime, fmtDuration } from './statusMeta';

// Build a single sorted audit-trail from run lifecycle + per-task lifecycle +
// every stage checkpoint (AIExecution). Every event is a real persisted fact.
function buildEvents(run, tasks, executions) {
  const events = [];
  if (run?.started_at) events.push({ at: run.started_at, kind: 'run:start', label: `Workflow started — ${prettyKey(run.plan_template_id || 'workflow')}`, tone: 'sky' });
  if (run?.completed_at) events.push({ at: run.completed_at, kind: 'run:done', label: 'Workflow completed', tone: 'emerald' });
  if (run?.cancelled_at) events.push({ at: run.cancelled_at, kind: 'run:cancel', label: 'Workflow cancelled', tone: 'slate' });

  tasks.forEach((t) => {
    if (t.started_at) {
      const tone = STATUS_META[t.status]?.dot?.includes('sky') ? 'sky' : 'slate';
      events.push({ at: t.started_at, kind: 'task:start', label: `${prettyKey(t.task_key)} started`, tone, taskId: t.id });
    }
    if (t.status === 'awaiting_approval' && t.started_at) {
      events.push({ at: t.started_at, kind: 'task:approval', label: `${prettyKey(t.task_key)} — waiting for approval`, tone: 'amber', taskId: t.id });
    }
    if (t.completed_at) {
      const failed = t.status === 'failed';
      events.push({
        at: t.completed_at,
        kind: 'task:done',
        label: `${prettyKey(t.task_key)} ${t.status === 'skipped' ? 'skipped' : failed ? 'failed' : 'completed'}`,
        tone: failed ? 'red' : t.status === 'skipped' ? 'slate' : 'emerald',
        taskId: t.id,
        duration: t.duration_ms,
      });
    }
  });

  executions.forEach((e) => {
    events.push({
      at: e.completed_at || e.created_date,
      kind: 'exec',
      label: `${e.operation || e.stage}${e.provider ? ` · ${e.provider}` : ''}`,
      tone: e.success ? 'sky' : 'red',
      exec: e,
    });
  });

  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  return events;
}

const TONE = {
  sky: { dot: 'bg-sky-500', icon: Play, text: 'text-sky-700' },
  emerald: { dot: 'bg-emerald-500', icon: CheckCircle2, text: 'text-emerald-700' },
  red: { dot: 'bg-red-500', icon: AlertTriangle, text: 'text-red-700' },
  amber: { dot: 'bg-amber-500', icon: ShieldCheck, text: 'text-amber-700' },
  slate: { dot: 'bg-slate-400', icon: SkipForward, text: 'text-slate-500' },
};

export default function ExecutionTimeline({ run, tasks = [], executions = [] }) {
  const events = buildEvents(run, tasks, executions);
  if (!events.length) {
    return <p className="py-8 text-center text-sm text-slate-400">No activity yet.</p>;
  }
  return (
    <ol className="relative space-y-3 pl-6">
      <span className="absolute left-2 top-1 bottom-1 w-px bg-slate-200" />
      {events.map((e, i) => {
        const tone = TONE[e.tone] || TONE.slate;
        const Icon = tone.icon;
        return (
          <li key={i} className="relative">
            <span className={`absolute -left-[18px] top-1 flex h-4 w-4 items-center justify-center rounded-full ${tone.dot} ring-4 ring-white`}>
              <Icon size={9} className="text-white" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[11px] text-slate-400">{fmtDateTime(e.at)}</span>
              <span className={`text-sm font-medium ${tone.text}`}>{e.label}</span>
              {e.duration != null && (
                <span className="text-[11px] text-slate-400">· {fmtDuration(e.duration)}</span>
              )}
              {e.exec && e.exec.estimated_cost ? (
                <span className="text-[11px] text-slate-400">· ${Number(e.exec.estimated_cost).toFixed(4)}</span>
              ) : null}
            </div>
            {e.exec && e.exec.error_code && (
              <p className="mt-0.5 text-xs text-red-600">{e.exec.error_code}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}