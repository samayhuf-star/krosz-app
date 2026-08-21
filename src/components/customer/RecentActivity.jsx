import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Mail, Send, Sparkles, Globe, Server } from 'lucide-react';

const ICON = { sync: Mail, send: Send, ai: Sparkles, dns: Globe, provision: Server };
const TONE = { success: 'text-emerald-600', failure: 'text-red-500', info: 'text-slate-400', warning: 'text-amber-600' };

export default function RecentActivity({ businessId }) {
  const q = useQuery({
    queryKey: ['home', 'activity', businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const [logs, execs] = await Promise.all([
        base44.entities.CommunicationLog.filter({ business_id: businessId }).catch(() => []),
        base44.entities.AIExecution.filter({ business_id: businessId }).catch(() => []),
      ]);
      const merged = [
        ...(logs || []).map((l) => ({ id: 'log' + l.id, kind: l.kind, status: l.status, title: l.metadata?.action || l.metadata?.ai_action || l.metadata?.provider || l.metadata?.domain || l.kind, ts: l.created_date })),
        ...(execs || []).map((e) => ({ id: 'ai' + e.id, kind: 'ai', status: e.success ? 'success' : 'failure', title: e.capability || e.prompt_id, ts: e.created_date })),
      ].sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || ''))).slice(0, 7);
      return merged;
    },
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Recent activity</h3>
      {q.isLoading ? <div className="flex items-center gap-2 text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        : q.data && q.data.length === 0 ? <p className="text-sm text-slate-500">Nothing yet.</p>
        : <ul className="space-y-2.5">
            {(q.data || []).map((a) => {
              const Icon = ICON[a.kind] || Sparkles;
              return (
                <li key={a.id} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500"><Icon size={14} /></span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700 capitalize">{a.title}</span>
                  <span className={`text-xs font-medium ${TONE[a.status] || 'text-slate-400'}`}>{a.status}</span>
                  <span className="text-xs text-slate-400">{a.ts ? new Date(a.ts).toLocaleDateString() : ''}</span>
                </li>
              );
            })}
          </ul>}
    </div>
  );
}