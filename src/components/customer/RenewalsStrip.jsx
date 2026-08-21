import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CalendarClock } from 'lucide-react';

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr); if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

export default function RenewalsStrip({ businessId }) {
  const q = useQuery({
    queryKey: ['home', 'renewals', businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const domains = await base44.entities.Domain.filter({ business_id: businessId }).catch(() => []);
      return (domains || []).map((d) => ({ id: d.id, name: d.domain_name || d.name, days: daysUntil(d.expiry_date || d.expires_at || d.renewal_date) }))
        .filter((d) => d.days != null && d.days <= 60);
    },
  });
  const rows = q.data || [];
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="mb-2 flex items-center gap-2"><CalendarClock size={15} className="text-amber-600" /><h3 className="text-sm font-semibold text-slate-900">Upcoming renewals</h3></div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700">{r.name}</span>
            <span className={r.days <= 7 ? 'font-medium text-red-600' : r.days <= 30 ? 'text-amber-700' : 'text-slate-500'}>
              {r.days <= 0 ? 'Expired' : `in ${r.days} days`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}