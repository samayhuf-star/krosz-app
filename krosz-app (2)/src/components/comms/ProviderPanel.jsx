import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, Server } from 'lucide-react';

export default function ProviderPanel({ data, businessId, onRefresh }) {
  const [enabling, setEnabling] = useState(null);
  const catalog = data?.providers?.catalog || [];
  const active = data?.providers?.active || [];

  const enable = useMutation({
    mutationFn: ({ provider_id }) => { setEnabling(provider_id); return commsApi.enableProvider(businessId, provider_id, true); },
    onSuccess: () => onRefresh(),
    onSettled: () => setEnabling(null),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Server size={16} /> Email Provider</CardTitle>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">Provider-agnostic — switch vendors without changing business logic. No SMTP/IMAP server is built; adapters produce provider-shaped, offline responses until live credentials are wired via secrets.</p>
          </div>
          {data?.activeProvider ? <Badge className="bg-emerald-600">Default · {data.activeProvider.name}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Active configurations</p>
        {active.length === 0 ? <p className="mb-4 text-sm text-slate-500">No provider enabled yet. Select one below to provision.</p> : (
          <div className="mb-4 space-y-2">
            {active.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{p.name} {p.is_default ? <Badge className="ml-1 bg-emerald-600">Default</Badge> : null}</p>
                  <p className="text-xs text-slate-500">SMTP {p.transport?.smtp_host}:{p.transport?.smtp_port} · IMAP {p.transport?.imap_host} · {p.provisioning_state}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(p.capabilities || {}).filter(([, v]) => v && v !== 0).map(([k]) => (
                    <Badge key={k} variant="outline" className="capitalize text-[10px]">{k.replace('_', ' ')}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Available providers</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {catalog.map((p) => {
            const isActive = !!active.find((a) => a.provider_id === p.id);
            return (
              <div key={p.id} className={`rounded-xl border p-4 ${isActive ? 'border-emerald-300 bg-emerald-50/40' : 'bg-white'}`}>
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-900">{p.name}</p>
                  {isActive ? (
                    <Badge className="bg-emerald-600 inline-flex items-center"><CheckCircle2 size={11} className="mr-1" /> Enabled</Badge>
                  ) : (
                    <Button size="sm" disabled={enabling === p.id} onClick={() => enable.mutate({ provider_id: p.id })}>
                      {enabling === p.id ? <Loader2 size={12} className="animate-spin" /> : 'Enable'}
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-500 line-clamp-2">{p.docs}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.security.supports_2fa ? <Badge variant="outline" className="text-[10px]">2FA</Badge> : null}
                  {p.security.supports_oauth ? <Badge variant="outline" className="text-[10px]">OAuth</Badge> : null}
                  <Badge variant="outline" className="text-[10px]">{p.security.tls_status} TLS</Badge>
                  <Badge variant="outline" className="text-[10px]">DKIM</Badge>
                  <Badge variant="outline" className="text-[10px]">SPF</Badge>
                  <Badge variant="outline" className="text-[10px]">DMARC</Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}