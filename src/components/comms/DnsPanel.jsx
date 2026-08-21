import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Globe, Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';

export default function DnsPanel({ data, businessId, onRefresh }) {
  const dom = data?.domainConfigs?.[0];
  const [busy, setBusy] = useState(false);
  const rebuild = useMutation({
    mutationFn: () => { setBusy(true); return commsApi.prepareDomainDns(businessId); },
    onSuccess: () => onRefresh(),
    onSettled: () => setBusy(false),
  });

  if (!dom) {
    return (
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Globe size={16} /> DNS Health</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">No domain configured. Enable a provider — DNS records auto-prepare when a registered domain is detected (via the Domain Engine).</p>
          <Button className="mt-3" disabled={busy} onClick={() => rebuild.mutate()}>{busy ? <Loader2 size={14} className="animate-spin mr-2" /> : null}Prepare DNS records</Button>
        </CardContent>
      </Card>
    );
  }

  const r = dom.records || {};
  const checks = dom.health?.checks || [];

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div><CardTitle className="text-base flex items-center gap-2"><Globe size={16} /> DNS Health · {dom.domain_name}</CardTitle>
          <p className="text-xs text-slate-500 mt-1">MX · SPF · DKIM · DMARC · Autodiscover · Return-Path blueprint generated deterministically from the selected provider.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={dom.status === 'healthy' ? 'bg-emerald-600' : dom.status === 'configured' ? 'bg-amber-500' : 'bg-slate-400'}>{dom.status} · {dom.health?.score ?? 0}/100</Badge>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => rebuild.mutate()}><RefreshCw size={14} className={busy ? 'animate-spin mr-2' : 'mr-2'} />Rebuild</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <RecordBlock title="MX records" rows={(r.mx || []).map((m) => [`${m.priority}`, `${m.host} `])} />
          <RecordBlock title="SPF" rows={[['TXT ' + r.spf?.name, r.spf?.value]]} />
          <RecordBlock title="DKIM" rows={Array.isArray(r.dkim) ? r.dkim.map((d) => [`${d.type} ${d.name}`, d.value]) : [[`${r.dkim?.type} ${r.dkim?.name}`, r.dkim?.value]]} />
          <RecordBlock title="DMARC" rows={[['TXT ' + r.dmarc?.name, r.dmarc?.value]]} />
          <RecordBlock title="Autodiscover" rows={[[`${r.autodiscover?.type} ${r.autodiscover?.name}`, r.autodiscover?.value]]} />
          <RecordBlock title="Return-Path" rows={[[`${(r.return_path || {}).type} ${(r.return_path || {}).name}`, (r.return_path || {}).value]]} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Validation checks</p>
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                {c.pass ? <CheckCircle2 size={15} className="text-emerald-600" /> : <XCircle size={15} className="text-red-500" />}
                <span className="text-slate-600 w-48">{c.check}</span>
                <span className="text-slate-400 text-xs">{c.message}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function RecordBlock({ title, rows }) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="text-xs">
            <span className="font-mono text-slate-700">{row[0]}</span>
            <span className="block font-mono text-slate-400 break-all">{row[1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}