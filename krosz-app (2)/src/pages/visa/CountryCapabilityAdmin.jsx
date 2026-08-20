// Worldz Visa (Phase 23) — Country x Provider x Execution Capability Matrix admin.
// Tabs: Matrix (§28) · Research Queue (§31) · Providers (§23/§37).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageHeader from '@/components/app/PageHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, RefreshCw, FileCheck2, FlaskConical, CheckCircle2, AlertTriangle, Ban, Users, CalendarClock, Radar } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useState } from 'react';
import {
  entryValidationReport, adminEntryList, adminEntryPublish, adminEntrySuspend,
  adminResearchSetStatus, adminEntryExport, seedEntryCatalog, runEntryContractTests,
  adminSecondSourceBatch, adminFreshnessRecompute, adminChangeReviewList,
  adminChangeAccept, adminChangeReject,
} from '@/lib/visaApi';
import MatrixTab from '@/components/visa/matrix/MatrixTab';
import QueueTab from '@/components/visa/matrix/QueueTab';
import ProvidersTab from '@/components/visa/matrix/ProvidersTab';
import ChangeDetectionTab from '@/components/visa/matrix/ChangeDetectionTab';
import ChangeReviewDrawer from '@/components/visa/matrix/ChangeReviewDrawer';
import CountryDetailDrawer from '@/components/visa/matrix/CountryDetailDrawer';
import ProviderDetailDrawer from '@/components/visa/matrix/ProviderDetailDrawer';

export default function CountryCapabilityAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');
  const [country, setCountry] = useState(null);
  const [provider, setProvider] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewCap, setReviewCap] = useState(null);

  const report = useQuery({ queryKey: ['entry-validation-report'], queryFn: () => entryValidationReport() });
  const list = useQuery({ queryKey: ['admin-entry-list'], queryFn: () => adminEntryList() });
  const pending = useQuery({ queryKey: ['admin-change-review-list'], queryFn: () => adminChangeReviewList() });
  const idMap = {};
  for (const c of list.data?.capabilities || []) idMap[c.country_code] = c.id;

  const reload = () => { qc.invalidateQueries({ queryKey: ['entry-validation-report'] }); qc.invalidateQueries({ queryKey: ['admin-entry-list'] }); qc.invalidateQueries({ queryKey: ['admin-provider-list'] }); qc.invalidateQueries({ queryKey: ['admin-change-review-list'] }); };

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); toast({ title: ok }); reload(); }
    catch (e) { toast({ title: 'Failed', description: e?.message, variant: 'destructive' }); }
    finally { setBusy(''); }
  };

  const s = report.data?.summary;

  return (
    <div>
      <PageHeader
        eyebrow="Phase 23 · India-first matrix"
        title="Country × Provider × Execution Capability Matrix"
        description="One Travel Entry Engine + a capability matrix + provider composition across 100+ India→destinations. Only VERIFIED+PUBLISHED surfaces as authoritative. No fake APIs, no fake automation."
        action={<div className="flex flex-wrap gap-2">
          <button onClick={() => run('seed', () => seedEntryCatalog(), 'Pipeline + providers + bindings refreshed')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><RefreshCw size={14} className={busy === 'seed' ? 'animate-spin' : ''} /> Seed pipeline</button>
          <button onClick={() => run('batch', () => adminSecondSourceBatch(), 'Second-source batch prepared')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Users size={14} /> Second-source batch</button>
          <button onClick={() => run('freshness', () => adminFreshnessRecompute(), 'Freshness recomputed from change risk')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><CalendarClock size={14} /> Recompute freshness</button>
          <button onClick={() => run('tests', () => runEntryContractTests(), 'Contract tests executed')} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><FlaskConical size={14} /> Run tests</button>
        </div>}
      />

      <div className="px-5 py-6 sm:px-8 lg:px-10">
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Tile icon={CheckCircle2} label="Ready (published)" value={`${s?.ready ?? '—'} / ${s?.target ?? 100}`} tone="emerald" />
          <Tile icon={AlertTriangle} label="In research queue" value={s?.needs_review ?? '—'} tone="amber" />
          <Tile icon={Ban} label="Blocked" value={s?.blocked ?? '—'} tone="rose" />
          <Tile icon={FileCheck2} label="Inventoried" value={s?.total ?? '—'} tone="slate" />
          <Tile icon={FileCheck2} label="Coverage" value={`${s?.coverage_pct ?? 0}%`} tone="blue" />
          <Tile icon={Radar} label="Pending changes" value={pending.data?.reviews?.length ?? 0} tone="rose" />
        </div>

        {report.isLoading ? <div className="py-20 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div> : (
          <Tabs defaultValue="matrix">
            <TabsList>
              <TabsTrigger value="matrix">Country matrix</TabsTrigger>
              <TabsTrigger value="queue">Research queue</TabsTrigger>
              <TabsTrigger value="providers">Providers</TabsTrigger>
              <TabsTrigger value="changes">Change detection</TabsTrigger>
            </TabsList>
            <TabsContent value="matrix" className="mt-4">
              <MatrixTab
                report={report.data} idMap={idMap} busy={!!busy}
                onSelect={(r) => setCountry(r)}
                onPublish={(id) => run(id, () => adminEntryPublish(id), 'Destination published')}
                onSuspend={(id) => run(id, () => adminEntrySuspend(id), 'Destination suspended')}
                onExport={() => run('export', () => adminEntryExport().then((r) => { const blob = new Blob([r.csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'country-capability-matrix.csv'; a.click(); URL.revokeObjectURL(url); }), 'Matrix exported') }
              />
            </TabsContent>
            <TabsContent value="queue" className="mt-4">
              <QueueTab report={report.data} idMap={idMap} busy={!!busy}
                onSelect={(r) => setCountry(r)}
                onSave={(p) => run(p.capability_id, () => adminResearchSetStatus(p), 'Research state saved')} />
            </TabsContent>
            <TabsContent value="providers" className="mt-4">
              <ProvidersTab onSelect={(p) => setProvider(p)} />
            </TabsContent>
            <TabsContent value="changes" className="mt-4">
              <ChangeDetectionTab
                busy={!!busy}
                onSelect={(s) => { setReview(s); setReviewCap((pending.data?.reviews || []).find((r) => r.snapshot.id === s.id)?.capability || null); }}
                onAccept={(id) => run(id, () => adminChangeAccept(id), 'Change accepted — verification recomputed')}
                onReject={(p) => run(p.snapshot_id, () => adminChangeReject(p), 'Change rejected — previous retained')}
              />
            </TabsContent>
          </Tabs>
        )}
        <p className="mt-6 text-xs text-slate-400">
          India→World MVP. The matrix is intelligence over the existing engine — it never duplicates regulatory rules. Journey types are documented and seeded from reputable sources; vendor eVisa-object APIs/MCPs default to UNKNOWN and are only flipped to YES when a verified integration is recorded (§10/§11/§35).
        </p>
      </div>

      <CountryDetailDrawer country={country} onClose={() => setCountry(null)} />
      <ProviderDetailDrawer provider={provider} onClose={() => setProvider(null)} />
      <ChangeReviewDrawer snapshot={review} capability={reviewCap} busy={!!busy}
        onAccept={(id) => run(id, () => adminChangeAccept(id), 'Change accepted — verification recomputed')}
        onReject={(p) => run(p.snapshot_id, () => adminChangeReject(p), 'Change rejected — previous retained')}
        onClose={() => setReview(null)} />
    </div>
  );
}

function Tile({ icon: Icon, label, value, tone }) {
  const CLS = { emerald: 'text-orange-700', amber: 'text-amber-700', rose: 'text-rose-700', slate: 'text-slate-700', blue: 'text-blue-700' };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500"><Icon size={12} /> {label}</p>
      <p className={`mt-1 text-2xl font-bold ${CLS[tone]}`}>{value}</p>
    </div>
  );
}