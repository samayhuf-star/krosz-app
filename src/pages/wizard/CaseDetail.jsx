import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ArrowLeft, ArrowRight, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import ApplicationProgressSummary from '@/components/visa/ApplicationProgressSummary';
import { applicationCaseContext, applicationCaseTimeline } from '@/lib/applicationCaseApi';
import { customerOps } from '@/lib/opsEngineApi';

const TERMINAL = ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED'];

const OWNER_LABEL = { CUSTOMER: 'You', KROSZ_AUTOMATION: 'Krosz', KROSZ_REVIEWER: 'Krosz review', KROSZ_SUPPORT: 'Krosz support', EXTERNAL_PROVIDER: 'Provider', GOVERNMENT: 'Government', SYSTEM: 'System' };

export default function CaseDetail() {
  const { id } = useParams();
  const ctxQ = useQuery({ queryKey: ['case-detail', id], queryFn: () => applicationCaseContext(id), enabled: !!id });
  const tlQ = useQuery({ queryKey: ['case-timeline', id], queryFn: () => applicationCaseTimeline(id), enabled: !!id });
  const opsQ = useQuery({ queryKey: ['customer-ops', id], queryFn: () => customerOps(id), enabled: !!id, retry: false });
  const ctx = ctxQ.data;
  const cv = ctx?.case_view;
  const ops = opsQ.data;

  if (ctxQ.isLoading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (ctxQ.isError || !ctx) return <div className="mx-auto max-w-md px-5 py-20 text-center"><AlertCircle className="mx-auto h-8 w-8 text-rose-500" /><p className="mt-3 text-sm text-slate-600">This case could not be loaded or you don’t have access.</p><Link to="/cases" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-orange-700">Back to My Cases</Link></div>;

  const state = cv?.state;
  const isTerminal = TERMINAL.includes(state);
  const fee = ctx.fee || {};
  const timeline = tlQ.data?.timeline || [];

  return (
    <div>
      <PageHeader eyebrow="Case" title={`${cv?.snapshot?.country || ctx.case?.destination} · ${cv?.snapshot?.journey || ctx.case?.journey}`} description={ctx.state_label} />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/cases" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeft size={16} /> My Cases</Link>
          {!isTerminal && <Link to={`/wizard/${id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700">Continue <ArrowRight size={14} /></Link>}
        </div>

        {!isTerminal && <ApplicationProgressSummary ctx={ctx} caseId={id} />}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card title="Overview">
              <KV label="Status" value={ctx.state_label} />
              <KV label="Destination" value={cv?.snapshot?.country} />
              <KV label="Journey" value={cv?.snapshot?.journey} />
              <KV label="Nationality" value={cv?.snapshot?.nationality} />
              <KV label="Verification" value={cv?.snapshot?.verification_status} />
              <KV label="Execution route" value={cv?.execution_capability || cv?.snapshot?.execution_capability} />
              <KV label="Created" value={fmtDate(ctx.case?.created_date)} />
              <KV label="Last updated" value={fmtDate(ctx.case?.updated_date)} />
            </Card>

            <Card title="What happens next">
              {ops ? (
                <div className={`rounded-xl p-4 ${ops.blocked ? 'bg-rose-50' : ops.action_owner === 'CUSTOMER' ? 'bg-orange-50' : 'bg-emerald-50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-800">{ops.blocked ? <AlertCircle size={16} className="text-rose-600" /> : ops.action_owner === 'CUSTOMER' ? <Clock size={16} className="text-orange-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />} {ops.stageLabel}</p>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-slate-600">{OWNER_LABEL[ops.action_owner] || ops.action_owner}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-700">{ops.customer_message}</p>
                  {ops.blocked && <p className="mt-1 text-xs text-rose-700">You need to take action to continue.</p>}
                  {!ops.blocked && ops.action_owner !== 'CUSTOMER' && <p className="mt-1 text-xs text-emerald-700">No action required from you right now.</p>}
                </div>
              ) : (
                <div className={`rounded-xl p-4 ${ctx.next_action?.blocked ? 'bg-rose-50' : 'bg-orange-50'}`}>
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800">{ctx.next_action?.blocked ? <AlertCircle size={16} className="text-rose-600" /> : <CheckCircle2 size={16} className="text-orange-600" />} {ctx.next_action?.label}</p>
                  {ctx.next_action?.blocked && <p className="mt-1 text-xs text-rose-700">You need to take action to continue.</p>}
                </div>
              )}
              {!isTerminal && ops?.action_owner === 'CUSTOMER' && <Link to={`/wizard/${id}`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-orange-700">Open wizard <ArrowRight size={14} /></Link>}
            </Card>

            <Card title="Documents">
              {(ctx.required_docs || []).length === 0 ? <p className="text-sm text-slate-400">No documents required for this journey.</p> : (
                <ul className="space-y-1.5 text-sm">
                  {ctx.required_docs.map((d) => <li key={d.code} className="flex items-center justify-between"><span className="text-slate-700">{d.label}</span><span className="text-xs text-slate-400">{d.mandatory ? 'Required' : 'Optional'}</span></li>)}
                </ul>
              )}
              {!isTerminal && <Link to={`/wizard/${id}`} className="mt-3 inline-flex text-xs font-medium text-orange-700">Manage documents in wizard</Link>}
            </Card>

            <Card title="Timeline">
              {timeline.length === 0 ? <p className="text-sm text-slate-400">No events yet.</p> : (
                <ol className="space-y-2">
                  {timeline.map((e, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                      <div><p className="text-slate-700">{e.title}</p><p className="text-[11px] text-slate-400"><Clock size={10} className="inline" /> {fmtDate(e.at)}</p></div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Payment">
              {fee.available ? (
                <div className="space-y-1 text-sm">
                  <KV label="Government fee" value={fmtMinor(fee.government_minor, fee.currency)} />
                  {!!fee.provider_minor && <KV label="Provider fee" value={fmtMinor(fee.provider_minor, fee.currency)} />}
                  {!!fee.service_minor && <KV label="Service fee" value={fmtMinor(fee.service_minor, fee.currency)} />}
                  <div className="border-t border-slate-100 pt-1"><KV label="Total" value={fmtMinor(fee.total_minor, fee.currency)} /></div>
                </div>
              ) : <p className="text-sm text-slate-400">Fee currently unavailable.</p>}
              <p className="mt-2 text-[11px] text-slate-400">Payment is separate from submission.</p>
            </Card>
            <Card title="Execution information">
              <p className="text-sm text-slate-700">{cv?.execution_capability || cv?.snapshot?.execution_capability}</p>
              {ctx.submission_allowed ? <span className="mt-2 inline-block rounded-full bg-orange-50 px-2 py-0.5 text-[10px] text-orange-700">Automated submission available</span>
                : <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">No automated submission</span>}
            </Card>
            <Card title="Support">
              <Link to="/support" className="text-sm font-medium text-orange-700">Get help with this application</Link>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>{children}</div>);
}
function KV({ label, value }) {
  return (<div className="flex items-center justify-between py-1"><span className="text-xs text-slate-400">{label}</span><span className="text-sm font-medium text-slate-800">{String(value ?? '—')}</span></div>);
}
function fmtDate(s) { if (!s) return '—'; try { return new Date(s).toLocaleString(); } catch { return s; } }
function fmtMinor(m, c) { return m ? `${(c || '')} ${(Number(m) / 100).toFixed(2)}`.trim() : '—'; }