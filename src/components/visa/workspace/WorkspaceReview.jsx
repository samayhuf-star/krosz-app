import { CheckCircle2, AlertTriangle, ShieldCheck, ArrowRight } from 'lucide-react';
import WorkspaceChecklist from './WorkspaceChecklist';
import WorkspaceFees from './WorkspaceFees';
import WorkspaceAIAssist from './WorkspaceAIAssist';

const STATE_META = {
  READY: { label: 'Ready to review', tone: 'text-orange-700 bg-orange-50 border-orange-200', icon: CheckCircle2 },
  NOT_READY: { label: 'Not ready', tone: 'text-rose-700 bg-rose-50 border-rose-200', icon: AlertTriangle },
  NEEDS_REVIEW: { label: 'Needs your review', tone: 'text-amber-700 bg-amber-50 border-amber-200', icon: ShieldCheck },
};

export default function WorkspaceReview({ ws, onJump, onRefresh }) {
  const readiness = ws.readiness;
  const meta = STATE_META[readiness?.state] || STATE_META.NOT_READY;
  const Icon = meta.icon;

  return (
    <div className="space-y-5">
      <div className={`flex items-start gap-3 rounded-2xl border p-4 ${meta.tone}`}>
        <Icon size={20} className="mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold">{meta.label}</p>
          {readiness?.state === 'READY' ? (
            <p className="mt-0.5 text-xs">All required questions and documents are complete. Your application is ready to move to the next workflow stage.</p>
          ) : readiness?.reasons?.length ? (
            <ul className="mt-1.5 space-y-1">
              {readiness.reasons.map((r, i) => (
                <li key={i} className="text-xs">• {r.message || r.code} <span className="opacity-60 capitalize">({r.category})</span></li>
              ))}
            </ul>
          ) : null}
          {readiness?.needs_review?.length > 0 && (
            <p className="mt-2 text-xs">Items to review: {readiness.needs_review.map((r) => r.title).join(', ')}</p>
          )}
        </div>
        <button onClick={onRefresh} className="text-[11px] font-medium opacity-70 hover:opacity-100">Recheck</button>
      </div>

      {/* Section status grid → jump to edit */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-900">Sections</p>
        <div className="mt-3 space-y-2">
          {ws.progress?.sections?.map((s) => (
            <div key={s.key} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
              {s.complete ? <CheckCircle2 size={16} className="text-orange-600" /> : <div className="h-4 w-4 rounded-full border-2 border-slate-200" />}
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">{s.label}</p>
                <p className="text-[11px] text-slate-400">{s.done}/{s.total} required {s.complete ? 'complete' : s.done > 0 ? 'in progress' : 'pending'}</p>
              </div>
              <button onClick={() => onJump('section', s.key)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                {s.complete ? 'View' : 'Edit'} <ArrowRight size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Dynamic checklist */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Application checklist</p>
          <span className="text-[11px] text-slate-400">{ws.checklist?.complete || 0}/{ws.checklist?.total || 0} complete</span>
        </div>
        <div className="mt-2"><WorkspaceChecklist checklist={ws.checklist} /></div>
      </div>

      <WorkspaceFees quote={ws.quote} />
      <WorkspaceAIAssist readiness={readiness} application={ws.application} />

      <p className="text-[11px] text-slate-400">External visa submission is part of the next workflow stage — nothing is filed yet.</p>
    </div>
  );
}