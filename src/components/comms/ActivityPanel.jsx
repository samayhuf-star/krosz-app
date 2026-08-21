import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity as ActivityIcon } from 'lucide-react';

export default function ActivityPanel({ businessId, onRefresh }) {
  const q = useQuery({ queryKey: ['comms', 'telemetry', businessId], queryFn: () => commsApi.telemetry(businessId), enabled: !!businessId });
  if (q.isLoading) return <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading telemetry…</div>;
  const t = q.data; if (!t) return null;
  const totals = t.totals || {};
  const kinds = Object.entries(totals.by_kind || {});
  const maxKind = Math.max(1, ...kinds.map(([, v]) => v));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Messages processed" value={totals.messages_processed ?? 0} />
        <StatCard label="Latency (ms)" value={totals.latency_ms ?? 0} />
        <StatCard label="AI cost" value={`$${totals.ai_cost ?? 0}`} />
        <StatCard label="Errors" value={totals.errors ?? 0} tone={(totals.errors || 0) > 0 ? 'bad' : 'good'} />
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ActivityIcon size={16} /> Events by kind</CardTitle></CardHeader>
        <CardContent>
          {kinds.length === 0 ? <p className="text-sm text-slate-500">No events yet.</p> : (
            <div className="space-y-2">
              {kinds.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-24 text-sm capitalize text-slate-600">{k}</span>
                  <div className="h-3 flex-1 rounded-full bg-slate-100"><div className="h-3 rounded-full bg-emerald-500" style={{ width: `${(v / maxKind) * 100}%` }} /></div>
                  <span className="w-10 text-right text-sm text-slate-700">{v}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Mailbox Health</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Metric label="Mailboxes" value={t.mailboxHealth?.mailboxes} />
          <Metric label="Active" value={t.mailboxHealth?.active} />
          <Metric label="Synced OK" value={t.mailboxHealth?.synced_ok} />
          <Metric label="Sync errors" value={t.mailboxHealth?.sync_errors} />
          <Metric label="Shared" value={t.mailboxHealth?.shared} />
          <Metric label="Storage used" value={`${t.mailboxHealth?.storage_used_mb} MB`} />
          <Metric label="Storage quota" value={`${t.mailboxHealth?.storage_quota_mb} MB`} />
          <Metric label="Health score" value={`${t.mailboxHealth?.health_score}/100`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recent communication log</CardTitle></CardHeader>
        <CardContent>
          {(t.recent || []).length === 0 ? <p className="text-sm text-slate-500">No events.</p> : (
            <ul className="space-y-1.5">
              {t.recent.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={l.status === 'failure' ? 'destructive' : 'secondary'} className="capitalize">{l.kind}</Badge>
                    <span className="text-slate-600">{l.metadata?.action || l.metadata?.ai_action || l.metadata?.provider || l.metadata?.domain || l.kind}</span>
                  </div>
                  <span className="text-xs text-slate-400">{new Date(l.created_date).toLocaleTimeString()} · {l.latency_ms}ms</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-slate-400">{label}</p><p className={`mt-1 text-xl font-semibold ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</p></CardContent></Card>;
}
function Metric({ label, value }) { return <div><p className="text-xs text-slate-400">{label}</p><p className="font-semibold text-slate-900">{value}</p></div>; }