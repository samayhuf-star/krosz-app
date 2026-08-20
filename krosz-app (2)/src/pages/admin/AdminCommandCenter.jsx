import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Activity, AlertTriangle, ArrowRight, BriefcaseBusiness, CircleDollarSign, Clock3, Headset, RefreshCw, ShieldAlert, Users } from 'lucide-react';

const loadEntity = async (name, sort = '-created_date', limit = 250) => {
  try {
    const rows = await base44.entities[name].list(sort, limit);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

function Stat({ label, value, note, tone = 'slate', icon: Icon }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700', orange: 'bg-orange-50 text-orange-700', red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', emerald: 'bg-emerald-50 text-emerald-700',
  };
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}><Icon size={17}/></span><span className="text-2xl font-bold tracking-tight text-slate-950">{value}</span></div><p className="mt-3 text-sm font-semibold text-slate-800">{label}</p><p className="mt-1 text-xs text-slate-500">{note}</p></div>;
}

function QueueRow({ label, count, to, tone = 'slate' }) {
  const dot = { red:'bg-red-500', amber:'bg-amber-500', emerald:'bg-emerald-500', blue:'bg-blue-500', slate:'bg-slate-400' }[tone];
  return <Link to={to} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50"><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${dot}`}/><span className="text-sm font-medium text-slate-700">{label}</span></div><div className="flex items-center gap-2"><span className="text-sm font-bold text-slate-950">{count}</span><ArrowRight size={14} className="text-slate-400"/></div></Link>;
}

export default function AdminCommandCenter() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    const [users, cases, tasks, tickets, payments, refunds, attempts, providers] = await Promise.all([
      loadEntity('User'), loadEntity('VisaApplication'), loadEntity('OperationsTask'), loadEntity('SupportTicket'),
      loadEntity('Payment'), loadEntity('Refund'), loadEntity('ExecutionAttempt'), loadEntity('Provider'),
    ]);
    setData({ users, cases, tasks, tickets, payments, refunds, attempts, providers });
    setUpdatedAt(new Date());
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const m = useMemo(() => {
    if (!data) return {};
    const openTasks = data.tasks.filter(t => !['COMPLETED','CANCELLED'].includes(t.status));
    const activeCases = data.cases.filter(c => !['APPROVED','REJECTED','CANCELLED','EXPIRED','COMPLETED'].includes(c.case_state));
    const failedAttempts = data.attempts.filter(a => a.status === 'FAILED');
    const urgentTickets = data.tickets.filter(t => t.priority === 'URGENT' && !['RESOLVED','CLOSED'].includes(t.status));
    const overdueTasks = openTasks.filter(t => t.due_at && new Date(t.due_at).getTime() < Date.now());
    const paymentFailures = data.payments.filter(p => p.status === 'FAILED');
    const refundQueue = data.refunds.filter(r => !['COMPLETED','REJECTED'].includes(r.status));
    const unhealthyProviders = data.providers.filter(p => p.enabled && ['degraded','down'].includes(p.health_status));
    const paidCases = data.cases.filter(c => c.paid_at);
    return { activeCases, openTasks, failedAttempts, urgentTickets, overdueTasks, paymentFailures, refundQueue, unhealthyProviders, paidCases };
  }, [data]);

  return <div className="px-5 py-6 sm:px-8 lg:px-10">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-orange-600">Owner control plane</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Krosz Command Center</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">What needs attention right now across customers, applications, operations, support, payments and execution reliability.</p></div>
      <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={15} className={loading?'animate-spin':''}/> Refresh</button>
    </div>

    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={Users} label="Users" value={data?.users?.length ?? '—'} note="Registered accounts loaded" tone="blue"/>
      <Stat icon={BriefcaseBusiness} label="Active visa cases" value={m.activeCases?.length ?? '—'} note="Non-terminal applications" tone="orange"/>
      <Stat icon={Clock3} label="Open ops tasks" value={m.openTasks?.length ?? '—'} note={`${m.overdueTasks?.length ?? 0} currently overdue`} tone={m.overdueTasks?.length ? 'amber':'emerald'}/>
      <Stat icon={ShieldAlert} label="Execution failures" value={m.failedAttempts?.length ?? '—'} note="Provider/government execution attempts" tone={m.failedAttempts?.length ? 'red':'emerald'}/>
      <Stat icon={Headset} label="Urgent tickets" value={m.urgentTickets?.length ?? '—'} note="Unresolved urgent support" tone={m.urgentTickets?.length ? 'red':'emerald'}/>
      <Stat icon={CircleDollarSign} label="Paid cases" value={m.paidCases?.length ?? '—'} note="Cases with verified payment" tone="emerald"/>
      <Stat icon={AlertTriangle} label="Payment failures" value={m.paymentFailures?.length ?? '—'} note={`${m.refundQueue?.length ?? 0} refunds pending`} tone={m.paymentFailures?.length ? 'red':'slate'}/>
      <Stat icon={Activity} label="Provider incidents" value={m.unhealthyProviders?.length ?? '—'} note="Enabled providers degraded/down" tone={m.unhealthyProviders?.length ? 'red':'emerald'}/>
    </div>

    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-base font-bold text-slate-950">Needs attention</h2><span className="text-xs text-slate-400">live queues</span></div><div className="mt-4 space-y-2"><QueueRow label="Overdue operations tasks" count={m.overdueTasks?.length ?? 0} to="/admin/tasks" tone={m.overdueTasks?.length?'red':'emerald'}/><QueueRow label="Failed execution attempts" count={m.failedAttempts?.length ?? 0} to="/admin/failures" tone={m.failedAttempts?.length?'red':'emerald'}/><QueueRow label="Urgent customer tickets" count={m.urgentTickets?.length ?? 0} to="/admin/support" tone={m.urgentTickets?.length?'amber':'emerald'}/><QueueRow label="Payment failures" count={m.paymentFailures?.length ?? 0} to="/admin/finance" tone={m.paymentFailures?.length?'red':'emerald'}/><QueueRow label="Refunds pending action" count={m.refundQueue?.length ?? 0} to="/admin/finance" tone={m.refundQueue?.length?'amber':'emerald'}/></div></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-base font-bold text-slate-950">Run the business</h2><span className="text-xs text-slate-400">primary dashboards</span></div><div className="mt-4 grid grid-cols-2 gap-2">{[
        ['/admin/users','Users & customers'],['/admin/cases','Visa cases & status'],['/admin/tasks','Operations queue'],['/admin/engine-health','Engine health'],['/admin/failures','Failures & incidents'],['/admin/support','Tickets & support'],['/admin/finance','Payments & refunds'],['/admin/country-capabilities','Country coverage']
      ].map(([to,label])=><Link key={to} to={to} className="rounded-xl border border-slate-100 p-3 text-sm font-semibold text-slate-700 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-800">{label}<ArrowRight size={14} className="mt-3 text-slate-400"/></Link>)}</div></section>
    </div>
    <p className="mt-4 text-[11px] text-slate-400">{updatedAt ? `Last refreshed ${updatedAt.toLocaleTimeString()}.` : ''} Counts reflect the latest records loaded into this admin session.</p>
  </div>;
}