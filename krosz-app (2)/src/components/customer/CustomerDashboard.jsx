import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useActiveBusiness } from '@/lib/ActiveBusinessContext';
import { ACTIVE_RUN_STATES } from '@/components/workflows/statusMeta';
import { systemOf } from '@/components/launch/systemMap';
import {
  Sparkles, Send, ArrowRight, CheckCircle2, Loader2, Rocket, Users, Bot, Plus,
} from 'lucide-react';

// The post-launch customer dashboard. Feels like a personal business manager:
// a morning greeting, one Today's Priority, a row of live business systems, and
// an Ask-AI bar. Every status is derived from the real engine run — the customer
// never sees tasks, providers or DAGs (that stays in Advanced Mode).
export default function CustomerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBusiness, activeBusinessId, businesses } = useActiveBusiness();
  const [draft, setDraft] = useState('');

  const firstName = (user?.full_name || user?.data?.full_name || user?.email || 'there').split(/[ @]/)[0];
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Latest launch_business run for this business (the source of truth for status).
  const runQ = useQuery({
    queryKey: ['home', 'latest-run', activeBusinessId],
    queryFn: async () => {
      const rows = await base44.entities.LaunchPlan.filter({ business_id: activeBusinessId, plan_template_id: 'launch_business' }, '-created_date', 5).catch(() => []);
      return (rows || [])[0] || null;
    },
    enabled: !!activeBusinessId,
    staleTime: 15000,
  });

  const run = runQ.data || null;
  const runActive = run && ACTIVE_RUN_STATES.has(run.status);

  const tasksQ = useQuery({
    queryKey: ['home', 'run-tasks', run?.id],
    queryFn: async () => base44.entities.LaunchTask.filter({ launch_id: run.id }).catch(() => []),
    enabled: !!run?.id,
    staleTime: 8000,
  });
  const tasks = tasksQ.data || [];
  const awaitingGate = tasks.find((t) => t.status === 'awaiting_approval') || null;

  // New leads count for Today's Priority.
  const leadsQ = useQuery({
    queryKey: ['home', 'new-leads', activeBusinessId],
    queryFn: async () => base44.entities.Lead.filter({ business_id: activeBusinessId, status: 'new' }, '-created_date', 50).catch(() => []),
    enabled: !!activeBusinessId && !runActive,
    staleTime: 30000,
  });
  const newLeads = (leadsQ.data || []).length;

  // ----- empty state: no business yet -----
  if (!businesses || !activeBusiness) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-5 py-20 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"><Rocket size={28} /></span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">Let&apos;s build your first business</h1>
        <p className="mt-2 max-w-md text-sm text-slate-500">Tell me about it and I&apos;ll set up everything — your website, domain, CRM and marketing — in one guided launch.</p>
        <button onClick={() => navigate('/onboarding')} className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-7 py-4 text-base font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-700"><Rocket size={20} /> Start</button>
      </div>
    );
  }

  // ----- business with no run yet: prompt to launch -----
  if (!run) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <Greeting greeting={greeting} name={firstName} business={activeBusiness} onLaunch={() => navigate('/onboarding')} />
        <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Rocket size={22} /></span>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">Launch “{activeBusiness.name}”</h2>
          <p className="mt-1 text-sm text-slate-500">I&apos;ll build your website, domain, CRM and marketing so you can start operating.</p>
          <button onClick={() => navigate(`/launching?b=${activeBusinessId}`)} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"><Rocket size={16} /> Launch now <ArrowRight size={16} /></button>
        </div>
      </div>
    );
  }

  const systems = buildSystems(tasks);

  let priority;
  if (runActive && awaitingGate) {
    priority = { title: 'Review your business blueprint', sub: 'I have a blueprint ready — approve it and I will finish building everything.', cta: 'Review & continue', to: `/launching?b=${activeBusinessId}`, icon: CheckCircle2, tone: 'amber' };
  } else if (runActive) {
    priority = { title: 'Your launch is in progress', sub: 'I am building your business systems. Come watch them come online.', cta: 'Watch progress', to: `/launching?b=${activeBusinessId}`, icon: Loader2, tone: 'emerald' };
  } else if (newLeads > 0) {
    priority = { title: `Reply to ${newLeads} new lead${newLeads === 1 ? '' : 's'}`, sub: 'Fresh interest just came in. A quick response keeps momentum high.', cta: 'Open CRM', to: '/crm', icon: Users, tone: 'emerald' };
  } else {
    priority = { title: 'Everything is running smoothly', sub: 'No urgent items. Ask me to run a campaign or find new customers.', cta: 'Ask AI', to: '/assistant', icon: Sparkles, tone: 'violet' };
  }

  const askAi = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    navigate('/assistant', { state: { initial: draft.trim() } });
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:py-12">
      <Greeting greeting={greeting} name={firstName} business={activeBusiness} onLaunch={() => navigate('/onboarding')} />

      {runActive && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-800">
          <Loader2 size={16} className="animate-spin" /> Your launch is in progress — <button onClick={() => navigate(`/launching?b=${activeBusinessId}`)} className="font-semibold underline">watch it live</button>.
        </div>
      )}

      <PriorityCard priority={priority} />

      <section className="mt-6">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Business Status</h2>
        <div className="mt-2 divide-y divide-slate-100 rounded-3xl border border-slate-200 bg-white shadow-sm">
          {systems.map((s) => <SystemRow key={s.key} s={s} />)}
          <SystemRow s={{ key: 'assistant', label: 'AI Assistant', icon: Bot, tone: 'live', detail: 'Online' }} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ask AI</h2>
        <form onSubmit={askAi} className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-100">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Sparkles size={17} /></span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What would you like me to do today?" className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" />
          <button type="submit" disabled={!draft.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"><Send size={15} /></button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {['Run a marketing campaign', 'Find new customers', 'Improve my website', 'Reply to emails'].map((s) => (
            <button key={s} onClick={() => navigate('/assistant', { state: { initial: s } })} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700">{s}</button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Greeting({ greeting, name, business, onLaunch }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-medium text-slate-400">{greeting},</p>
        <h1 className="mt-0.5 text-3xl font-semibold tracking-tight text-slate-900">{name} 👋</h1>
        {business && <p className="mt-1.5 text-sm text-slate-500">Here&apos;s how <span className="font-medium text-slate-700">{business.name}</span> is doing today.</p>}
      </div>
      <button onClick={onLaunch} title="Launch a new business" className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-emerald-700">
        <Plus size={18} />
      </button>
    </div>
  );
}

const PRIORITY_STYLES = {
  emerald: { ring: 'border-emerald-200 from-emerald-50/70', icon: 'bg-emerald-100 text-emerald-700', btn: 'bg-emerald-700 hover:bg-emerald-800' },
  amber: { ring: 'border-amber-200 from-amber-50/70', icon: 'bg-amber-100 text-amber-700', btn: 'bg-amber-600 hover:bg-amber-700' },
  violet: { ring: 'border-violet-200 from-violet-50/70', icon: 'bg-violet-100 text-violet-700', btn: 'bg-violet-600 hover:bg-violet-700' },
};

function PriorityCard({ priority }) {
  const navigate = useNavigate();
  const st = PRIORITY_STYLES[priority.tone] || PRIORITY_STYLES.emerald;
  const Icon = priority.icon;
  const spin = priority.icon === Loader2;
  return (
    <div className={`mt-6 rounded-3xl border bg-gradient-to-b ${st.ring} to-white p-6 shadow-sm`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${st.icon}`}><Icon size={20} className={spin ? 'animate-spin' : ''} /></span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Today&apos;s Priority</p>
          <h2 className="text-lg font-semibold text-slate-900">{priority.title}</h2>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{priority.sub}</p>
      <button onClick={() => navigate(priority.to)} className={`mt-4 inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm ${st.btn}`}>{priority.cta} <ArrowRight size={15} /></button>
    </div>
  );
}

function SystemRow({ s }) {
  const Icon = s.icon;
  const live = s.tone === 'live';
  const warn = s.tone === 'warn';
  const building = s.tone === 'building';
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${warn ? 'bg-amber-50 text-amber-600' : live ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
        {building ? <Loader2 size={16} className="animate-spin" /> : <Icon size={17} />}
      </span>
      <span className="text-sm font-medium text-slate-800">{s.label}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${warn ? 'bg-amber-400' : live ? 'bg-emerald-500' : building ? 'bg-sky-400' : 'bg-slate-300'}`} />
        <span className={`text-xs font-medium ${warn ? 'text-amber-600' : live ? 'text-emerald-600' : building ? 'text-sky-600' : 'text-slate-400'}`}>{s.detail}</span>
      </span>
    </div>
  );
}

// Translate engine task statuses into customer-language systems for the dashboard.
function buildSystems(tasks) {
  const lines = tasks.filter((t) => t.type !== 'approval_gate');
  return lines.map((t) => {
    const sys = systemOf(t.task_key);
    let tone = 'idle', detail = 'Queued';
    if (['completed', 'approved'].includes(t.status)) { tone = 'live'; detail = 'Live'; }
    else if (['failed', 'blocked', 'skipped', 'rejected', 'cancelled'].includes(t.status)) { tone = 'warn'; detail = 'Needs setup'; }
    else if (['running', 'retrying', 'ready'].includes(t.status)) { tone = 'building'; detail = 'Building'; }
    return { key: t.task_key, label: sys.label, icon: sys.icon, tone, detail };
  });
}