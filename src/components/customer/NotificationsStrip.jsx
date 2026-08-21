import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Bell } from 'lucide-react';

export default function NotificationsStrip({ businessId }) {
  const q = useQuery({
    queryKey: ['home', 'notifications', businessId],
    enabled: !!businessId,
    queryFn: async () => {
      try { const rows = await base44.entities.Notification.filter({ business_id: businessId }); return (rows || []).slice(0, 4); }
      catch { return []; }
    },
    staleTime: 60 * 1000,
  });
  const rows = q.data || [];
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2"><Bell size={14} className="text-amber-500" /><h3 className="text-sm font-semibold text-slate-900">Notifications</h3></div>
      <ul className="space-y-1.5">
        {rows.map((n) => (
          <li key={n.id} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.read ? 'bg-slate-300' : 'bg-emerald-500'}`} />
            <span className="text-slate-700">{n.title || n.message || n.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}