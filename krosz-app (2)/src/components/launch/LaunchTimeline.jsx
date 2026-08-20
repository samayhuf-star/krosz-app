import { useState } from 'react';
import { CheckCircle2, Clock, ShieldCheck, Loader2, Play, AlertTriangle, SkipForward, RefreshCw, ChevronRight, Factory, Network, FileText } from 'lucide-react';

const STATUS_META = {
  completed: { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2, label: 'Completed' },
  awaiting_approval: { color: 'text-amber-700 bg-amber-50 border-amber-200', icon: ShieldCheck, label: 'Approval required' },
  approved: { color: 'text-sky-700 bg-sky-50 border-sky-200', icon: ShieldCheck, label: 'Approved' },
  pending: { color: 'text-slate-500 bg-slate-50 border-slate-200', icon: Clock, label: 'Pending' },
  running: { color: 'text-sky-700 bg-sky-50 border-sky-200', icon: Loader2, label: 'Running' },
  failed: { color: 'text-red-700 bg-red-50 border-red-200', icon: AlertTriangle, label: 'Failed' },
  skipped: { color: 'text-slate-400 bg-slate-50 border-slate-200', icon: SkipForward, label: 'Skipped' },
  rejected: { color: 'text-rose-700 bg-rose-50 border-rose-200', icon: AlertTriangle, label: 'Rejected' },
  cancelled: { color: 'text-slate-400 bg-slate-50 border-slate-200', icon: AlertTriangle, label: 'Cancelled' },
};

function ModuleIcon({ owner }) {
  if (owner === 'knowledgeGraph' || owner === 'launchAssistant') return owner === 'launchAssistant' ? <FileText size={15} /> : <Network size={15} />;
  return <Factory size={15} />;
}

export default function LaunchTimeline({ plan, tasks, next, runTask, onSkip, onRetry, invalidate }) {
  const [busy, setBusy] = useState(null);
  const runnable = (t) => next && t.id === next.id && (t.status === 'pending' || t.status === 'approved' || t.status === 'running');

  const handleRun = async (t) => {
    setBusy(t.step_id);
    try { await runTask(t); } finally { setBusy(null); invalidate(); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">The assistant runs each step in order. Approval gates pause the workflow until you decide. Steps already satisfied in your Knowledge Graph are auto-completed.</p>
      {tasks.map((t) => {
        const meta = STATUS_META[t.status] || STATUS_META.pending;
        const Icon = meta.icon;
        const canRun = runnable(t) && t.status !== 'running';
        return (
          <div key={t.id} className={`rounded-2xl border bg-white p-4 shadow-sm transition-shadow ${canRun ? 'ring-2 ring-emerald-300' : 'border-slate-200'}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl border ${meta.color}`}>
                {t.status === 'running' || busy === t.step_id ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">{String(t.order).padStart(2, '0')}</span>
                  <h3 className="font-semibold text-slate-900">{t.name}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.color}`}>{meta.label}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500"><ModuleIcon owner={t.owner} /> {t.module_label}</span>
                  {t.needs_approval && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"><ShieldCheck size={11} /> Gate</span>}
                </div>
                {t.summary && <p className="mt-1.5 text-sm text-slate-600">{t.summary}</p>}
                {t.error_message && <p className="mt-1.5 text-sm text-red-600">⚠ {t.error_message}</p>}
                {t.result && !t.error_message && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                    {t.result.blueprint && <span>Blueprint v{t.result.blueprint.version}</span>}
                    {t.result.website && <span>Website v{t.result.website.version} · {t.result.website.pages ?? 0} pages</span>}
                    {t.result.version && <span>Version #{t.result.version.version ?? t.result.version.id} {t.result.version.health ? `· health ${t.result.version.health}` : ''}</span>}
                    {t.result.kg_version != null && <span>KG v{t.result.kg_version}</span>}
                    {t.result.best?.domain && <span>Best domain: {t.result.best.domain}</span>}
                    {t.result.domain?.domain_name && <span>Registered: {t.result.domain.domain_name}</span>}
                  </div>
                )}
                {(t.logs || []).slice(-2).map((l, i) => <p key={i} className="mt-1 font-mono text-[11px] text-slate-400">{l.message}</p>)}
              </div>
              <div className="flex-none">
                {canRun ? (
                  <button onClick={() => handleRun(t)} disabled={busy === t.step_id} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {busy === t.step_id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run
                  </button>
                ) : t.status === 'failed' ? (
                  <div className="flex gap-1.5">
                    <button onClick={() => onRetry(t)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><RefreshCw size={13} /></button>
                    <button onClick={() => onSkip(t)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><SkipForward size={13} /></button>
                  </div>
                ) : <ChevronRight size={16} className="text-slate-300" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}