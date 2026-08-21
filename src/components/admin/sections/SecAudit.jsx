import { useQuery } from '@tanstack/react-query';
import { adminAuditLog } from '@/lib/adminCaseApi';
import { Loader2 } from 'lucide-react';

export default function SecAudit({ caseId }) {
  const q = useQuery({ queryKey: ['admin-audit', caseId], queryFn: () => adminAuditLog(caseId) });
  const rows = q.data?.audit || [];
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {q.isLoading ? <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div> :
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr>{['Actor', 'Action', 'Occurred at', 'Prev state', 'New state', 'Reason', 'Source', 'Idempotency key'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No audit events.</td></tr>}
            {rows.map((r, i) => <tr key={i}>
              <td className="px-3 py-2 text-slate-700">{r.actor}</td>
              <td className="px-3 py-2 font-medium text-slate-800">{r.action}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{new Date(r.occurred_at).toLocaleString()}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{r.previous_state || '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{r.new_state || '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-600">{r.reason || '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{r.source || '—'}</td>
              <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{r.idempotency_key || '—'}</td>
            </tr>)}
          </tbody>
        </table></div>}
    </div>
  );
}