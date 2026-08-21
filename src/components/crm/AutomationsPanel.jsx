import { Zap, Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const TRIGGER_TONE = {
  lead_created: 'border-emerald-200 bg-emerald-50/50 text-emerald-800',
  stage_changed: 'border-sky-200 bg-sky-50/50 text-sky-800',
  lead_scored: 'border-violet-200 bg-violet-50/50 text-violet-800',
  form_submitted: 'border-amber-200 bg-amber-50/50 text-amber-800',
  task_overdue: 'border-rose-200 bg-rose-50/50 text-rose-800',
  appointment_scheduled: 'border-cyan-200 bg-cyan-50/50 text-cyan-800',
  appointment_missed: 'border-rose-200 bg-rose-50/50 text-rose-800',
  inactivity: 'border-slate-300 bg-slate-100 text-slate-700',
  no_progress: 'border-slate-300 bg-slate-100 text-slate-700',
};

export default function AutomationsPanel({ automations }) {
  const list = automations || [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/40 p-3"><Mail size={15} className="text-amber-700" /><p className="text-sm text-amber-800">Definitions only — no messages are sent. Automations describe the workflow the CRM will run once leads flow in.</p></div>
      {!list.length ? <p className="text-sm text-slate-500">No automations generated.</p> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((a) => (
            <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2"><h4 className="font-semibold text-slate-900">{a.name}</h4><Badge variant="outline" className={(TRIGGER_TONE[a.trigger] || TRIGGER_TONE.inactivity) + ' font-mono'}>{a.trigger.replace(/_/g, ' ')}</Badge></div>
              {a.trigger_stage && <p className="mt-1 text-xs text-slate-500">Trigger stage: <span className="font-medium text-slate-700">{a.trigger_stage}</span></p>}
              {a.conditions?.length ? <div className="mt-2"><p className="text-xs font-semibold uppercase text-slate-400">When</p><ul className="mt-1 space-y-0.5 text-sm text-slate-600">{a.conditions.map((c, i) => <li key={i} className="flex gap-1.5"><Zap size={12} className="mt-0.5 text-slate-400" />{typeof c === 'string' ? c : JSON.stringify(c)}</li>)}</ul></div> : null}
              <div className="mt-2"><p className="text-xs font-semibold uppercase text-slate-400">Then</p><ul className="mt-1 space-y-1">{a.actions?.map((ac, i) => <li key={i} className="flex gap-2 text-sm"><span className="text-emerald-600">→</span><div><p className="font-medium text-slate-800">{ac.action.replace(/_/g, ' ')}</p>{ac.detail && <p className="text-xs text-slate-500">{ac.detail}</p>}</div></li>)}</ul></div>
              {a.owner_role && <p className="mt-2 text-xs text-slate-500">Owner: <span className="font-medium text-slate-700">{a.owner_role}</span></p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}