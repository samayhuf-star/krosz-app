import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { adminCaseDetail, adminAllowedTransitions } from '@/lib/adminCaseApi';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { stateTone, ecTone, priorityTone, Chip } from '@/components/admin/adminChips';
import SecOverview from '@/components/admin/sections/SecOverview';
import SecDocuments from '@/components/admin/sections/SecDocuments';
import SecReviews from '@/components/admin/sections/SecReviews';
import SecPayment from '@/components/admin/sections/SecPayment';
import SecProvider from '@/components/admin/sections/SecProvider';
import SecTimeline from '@/components/admin/sections/SecTimeline';
import SecOwnership from '@/components/admin/sections/SecOwnership';
import SecNotes from '@/components/admin/sections/SecNotes';
import SecExceptions from '@/components/admin/sections/SecExceptions';
import SecAudit from '@/components/admin/sections/SecAudit';
import SecTransitions from '@/components/admin/sections/SecTransitions';

export default function AdminCaseDetail() {
  const id = window.location.pathname.split('/').pop();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const detail = useQuery({ queryKey: ['admin-case-detail', id], queryFn: () => adminCaseDetail(id), enabled: !!id });
  const trans = useQuery({ queryKey: ['admin-transitions', id], queryFn: () => adminAllowedTransitions(id), enabled: !!id });
  const reload = () => { qc.invalidateQueries({ queryKey: ['admin-case-detail', id] }); qc.invalidateQueries({ queryKey: ['admin-transitions', id] }); qc.invalidateQueries({ queryKey: ['admin-cases'] }); };

  if (detail.isLoading) return <div className="py-20 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
  if (detail.isError || !detail.data) return <div className="py-20 text-center text-slate-400">Case not found. <Link to="/admin/cases" className="text-emerald-700 hover:underline">Back to cases</Link></div>;

  const d = detail.data;
  const cv = d.case_view;
  const c = d.case;

  return (
    <div>
      <PageHeader eyebrow="Phase 29 · Admin control plane" title={`Case ${String(id).slice(-8)}`}
        description="Internal case detail. All mutations go through the Phase 27 Application Case Engine."
        action={<Link to="/admin/cases" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><ArrowLeft size={14} /> All cases</Link>} />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        {/* Case header (§6) */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
              <KV label="Traveler" value={`${d.traveler?.first_name || ''} ${d.traveler?.last_name || ''}`.trim() || '—'} />
              <KV label="Destination" value={cv.country} />
              <KV label="Journey" value={cv.journey} />
              <KV label="Nationality" value={cv.nationality || '—'} />
              <KV label="State" chip={<Chip tone={stateTone(cv.state)} label={d.case_view.state} />} />
              <KV label="Normalized" value={cv.normalized_status} />
              <KV label="Execution" chip={<Chip tone={ecTone(cv.execution_capability)} label={(cv.execution_capability || '').replace('_', ' ')} />} />
              <KV label="Provider" value={cv.provider_key || '—'} />
              <KV label="Owner" value={d.case.ops_owner_id ? String(d.case.ops_owner_id).slice(-6) : <span className="text-amber-600">Unassigned</span>} />
              <KV label="Priority" chip={<Chip tone={priorityTone(d.case.ops_priority)} label={d.case.ops_priority || 'NORMAL'} />} />
              <KV label="Created" value={new Date(c.created_date).toLocaleString()} />
              <KV label="Updated" value={new Date(c.updated_date).toLocaleString()} />
            </div>
            <div className="max-w-xs rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Next action (deterministic)</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{d.next_action?.label}</p>
              <p className="text-[11px] text-slate-500">kind: {d.next_action?.kind}{d.next_action?.blocked ? ' · blocked' : ''}</p>
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap">
            {['overview', 'documents', 'reviews', 'payment', 'provider', 'transitions', 'ownership', 'timeline', 'audit', 'notes', 'exceptions'].map((t) => <TabsTrigger key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="overview" className="mt-4"><SecOverview d={d} /></TabsContent>
          <TabsContent value="documents" className="mt-4"><SecDocuments d={d} reload={reload} caseId={id} /></TabsContent>
          <TabsContent value="reviews" className="mt-4"><SecReviews d={d} reload={reload} caseId={id} /></TabsContent>
          <TabsContent value="payment" className="mt-4"><SecPayment d={d} /></TabsContent>
          <TabsContent value="provider" className="mt-4"><SecProvider d={d} /></TabsContent>
          <TabsContent value="transitions" className="mt-4"><SecTransitions d={d} trans={trans.data} reload={reload} caseId={id} /></TabsContent>
          <TabsContent value="ownership" className="mt-4"><SecOwnership d={d} reload={reload} caseId={id} /></TabsContent>
          <TabsContent value="timeline" className="mt-4"><SecTimeline caseId={id} /></TabsContent>
          <TabsContent value="audit" className="mt-4"><SecAudit caseId={id} /></TabsContent>
          <TabsContent value="notes" className="mt-4"><SecNotes d={d} reload={reload} caseId={id} /></TabsContent>
          <TabsContent value="exceptions" className="mt-4"><SecExceptions d={d} reload={reload} caseId={id} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function KV({ label, value = null, chip = null }) {
  return <div><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>{chip || <p className="text-sm font-medium text-slate-800">{value}</p>}</div>;
}