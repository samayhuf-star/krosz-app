import { ListChecks, Phone, Calendar, Bell, RefreshCw, AlertCircle, CheckSquare, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const TYPE_ICON = { daily: CheckSquare, follow_up: RefreshCw, call: Phone, meeting: Calendar, renewal: RefreshCw, reminder: Bell, escalation: AlertCircle, review_request: MessageSquare };
const PRIORITY_TONE = { urgent: 'border-rose-200 bg-rose-50/50 text-rose-700', high: 'border-amber-200 bg-amber-50/50 text-amber-700', medium: 'border-sky-200 bg-sky-50/50 text-sky-700', low: 'border-slate-300 text-slate-600' };

export default function TaskTemplatesPanel({ tasks }) {
  const list = tasks || [];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700"><ListChecks size={16} className="text-emerald-700" />Task Templates · {list.length}</h3>
      {!list.length ? <p className="text-sm text-slate-500">No task templates.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2">Task</th><th className="pb-2">Type</th><th className="pb-2">Trigger</th><th className="pb-2">Owner</th><th className="pb-2">Due</th><th className="pb-2">Priority</th><th className="pb-2">Escalation</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((t) => {
                const Icon = TYPE_ICON[t.type] || CheckSquare;
                return (
                  <tr key={t.id}>
                    <td className="py-2.5"><div className="flex items-center gap-2"><Icon size={14} className="text-emerald-600" /><div><p className="font-medium text-slate-800">{t.name}</p><p className="text-xs text-slate-500">{t.description}</p></div></div></td>
                    <td className="py-2.5"><Badge variant="outline" className="border-slate-300 text-slate-600">{t.type.replace(/_/g, ' ')}</Badge></td>
                    <td className="py-2.5 font-mono text-xs text-slate-600">{t.trigger || '—'}</td>
                    <td className="py-2.5 text-slate-600">{t.owner_role || '—'}</td>
                    <td className="py-2.5 text-slate-600">{t.due_offset_hours != null ? `+${t.due_offset_hours}h` : '—'}</td>
                    <td className="py-2.5"><Badge variant="outline" className={(PRIORITY_TONE[t.priority] || PRIORITY_TONE.medium) + ' capitalize'}>{t.priority}</Badge></td>
                    <td className="py-2.5 text-slate-600">{t.escalation_hours ? `${t.escalation_hours}h` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}