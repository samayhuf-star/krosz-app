import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { callDomainEngine } from '@/lib/domainApi';

const statusStyle = {
  selected: 'bg-amber-100 text-amber-800', pending: 'bg-sky-100 text-sky-800',
  registered: 'bg-emerald-100 text-emerald-800', active: 'bg-emerald-600 text-white',
  failed: 'bg-rose-100 text-rose-800', expired: 'bg-slate-200 text-slate-600',
};

export default function DomainDashboard({ business }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['domains', business?.id],
    queryFn: async () => (await callDomainEngine('list', { business_id: business?.id })).domains,
    enabled: !!business,
  });

  const update = useMutation({
    mutationFn: (vars) => callDomainEngine('updateDns', vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', business?.id] }),
  });

  if (isLoading) return <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />;
  if (!data || !data.length) return <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No domains yet. Buy your first domain in the Launch Flow tab.</p>;

  return (
    <div className="space-y-4">
      {data.map((d) => (
        <div key={d.id} className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-lg font-semibold text-slate-900">{d.domain_name}</p>
              <p className="text-xs text-slate-500">Registered {d.registered_at ? new Date(d.registered_at).toLocaleDateString() : '—'} · Expires {d.expires_at ? new Date(d.expires_at).toLocaleDateString() : 'pending'}</p>
            </div>
            <Badge className={statusStyle[d.status] || 'bg-slate-100 text-slate-700'}>{d.status}</Badge>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">Auto-renew</p>
              <div className="mt-1.5"><Switch checked={!!d.auto_renew} onCheckedChange={(v) => update.mutate({ domain_id: d.id, auto_renew: v })} /></div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">Transfer lock</p>
              <div className="mt-1.5"><Switch checked={!!d.transfer_lock} onCheckedChange={(v) => update.mutate({ domain_id: d.id, transfer_lock: v })} /></div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">DNS status</p>
              <p className="mt-1.5 text-sm font-medium text-slate-800">{d.dns_status}<span className="block text-xs font-normal text-slate-400">{(d.nameservers && d.nameservers.length) ? d.nameservers.join(', ') : 'nameservers not set'}</span></p>
            </div>
          </div>
          {update.isPending && <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Saving…</p>}
        </div>
      ))}
    </div>
  );
}