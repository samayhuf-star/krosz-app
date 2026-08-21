import { Loader2, CheckCircle2, Circle, XCircle, ShieldCheck, Lock } from 'lucide-react';

const TASK_LABEL = {
  collect_documents: 'Collect documents',
  review_application: 'Review application',
  application_approval: 'Your approval',
  submit_application: 'Submit to government',
  track_status: 'Track status',
};

const STATUS_STYLE = {
  completed: { icon: CheckCircle2, cls: 'text-orange-600' },
  skipped: { icon: CheckCircle2, cls: 'text-slate-400' },
  running: { icon: Loader2, cls: 'text-blue-600 animate-spin' },
  ready: { icon: Circle, cls: 'text-blue-500' },
  awaiting_approval: { icon: ShieldCheck, cls: 'text-amber-600 fill-amber-100' },
  pending: { icon: Circle, cls: 'text-slate-300' },
  blocked: { icon: XCircle, cls: 'text-red-500' },
  failed: { icon: XCircle, cls: 'text-red-500' },
  rejected: { icon: XCircle, cls: 'text-red-500' },
  cancelled: { icon: XCircle, cls: 'text-slate-400' },
};

export default function VisaRunProgress({ status, onApprove, approving }) {
  if (!status || !status.tasks || !status.tasks.length) return null;
  const run = status.run || {};
  const hasAwaiting = status.tasks.some((t) => t.status === 'awaiting_approval');
  return (
    <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Orchestration run</p>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
          {run.progress != null && <>{run.progress}%</>}
          <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] capitalize ${run.status === 'completed' ? 'bg-orange-50 text-orange-700' : run.status === 'awaiting_approval' ? 'bg-amber-50 text-amber-700' : run.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{(run.status || 'pending').replace(/_/g, ' ')}</span>
        </span>
      </div>

      <ol className="mt-3 space-y-2">
        {status.tasks.map((t) => {
          const s = STATUS_STYLE[t.status] || STATUS_STYLE.pending;
          const Icon = s.icon;
          return (
            <li key={t.id || t.task_key} className="flex items-center gap-2.5 text-sm">
              <Icon size={16} className={`shrink-0 ${s.cls}`} />
              <span className={t.status === 'completed' ? 'text-slate-600' : 'text-slate-800'}>{TASK_LABEL[t.task_key] || t.task_key}</span>
              {t.error_code && <span className="ml-auto text-xs text-red-600">{t.error_code}</span>}
            </li>
          );
        })}
      </ol>

      {hasAwaiting && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900"><ShieldCheck size={15} /> Your approval is required</p>
          <p className="mt-0.5 text-xs text-amber-800">Review your documents and confirm to submit this application to the government channel.</p>
          <button onClick={onApprove} disabled={approving} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
            {approving ? <><Loader2 size={15} className="animate-spin" /> Approving…</> : <><ShieldCheck size={15} /> Approve & submit</>}
          </button>
        </div>
      )}
      {!hasAwaiting && run.status === 'completed' && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-orange-700"><Lock size={14} /> Run sealed — your application is decided.</p>
      )}
    </div>
  );
}