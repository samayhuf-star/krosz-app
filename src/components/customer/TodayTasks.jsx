import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { CheckCircle2, Mail, LifeBuoy, Loader2, AlertCircle } from 'lucide-react';

export default function TodayTasks({ businessId }) {
  const q = useQuery({
    queryKey: ['home', 'today-tasks', businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const [tasks, tickets, messages] = await Promise.all([
        base44.entities.LaunchTask.filter({ business_id: businessId }).catch(() => []),
        base44.entities.Ticket.filter({ business_id: businessId }).catch(() => []),
        base44.entities.EmailMessage.filter({ business_id: businessId }).catch(() => []),
      ]);
      const awaiting = (tasks || []).filter((t) => t.status === 'awaiting_approval' || t.status === 'approved').slice(0, 3).map((t) => ({ id: t.id, kind: 'approval', label: `Approve: ${t.name}`, to: '/launch' }));
      const openTickets = (tickets || []).filter((t) => !['resolved', 'closed', 'cancelled'].includes(t.status)).slice(0, 3).map((t) => ({ id: t.id, kind: 'ticket', label: t.subject || 'Open ticket', to: '/communications' }));
      const reply = (messages || []).filter((m) => m.needs_reply).slice(0, 3).map((m) => ({ id: m.id, kind: 'email', label: m.subject || 'Reply to email', to: '/communications' }));
      return [...awaiting, ...reply, ...openTickets].slice(0, 6);
    },
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Today's tasks</h3>
      {q.isLoading ? <div className="flex items-center gap-2 text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        : q.data && q.data.length === 0 ? <div className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 size={16} /> You're all caught up.</div>
        : <ul className="space-y-2">
            {(q.data || []).map((t) => (
              <li key={t.kind + t.id}>
                <Link to={t.to} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  {t.kind === 'email' ? <Mail size={15} className="text-emerald-600" /> : t.kind === 'ticket' ? <LifeBuoy size={15} className="text-sky-600" /> : <AlertCircle size={15} className="text-amber-600" />}
                  <span className="truncate">{t.label}</span>
                </Link>
              </li>
            ))}
          </ul>}
    </div>
  );
}