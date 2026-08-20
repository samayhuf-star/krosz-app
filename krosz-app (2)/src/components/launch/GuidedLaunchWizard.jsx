import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import confetti from 'canvas-confetti';
import { workflowsApi } from '@/lib/workflowsApi';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Sparkles, Rocket, CheckCircle2, AlertTriangle, ArrowRight, Settings2 } from 'lucide-react';
import { ACTIVE_RUN_STATES } from '@/components/workflows/statusMeta';
import { systemOf } from './systemMap';
import LiveLaunchProgress from './LiveLaunchProgress';
import LaunchReviewGate from './LaunchReviewGate';

// The guided, end-to-end launch experience. The workflow engine is invisible:
// the customer sees "let's launch your business" → a blueprint review → live
// progress as each system comes online → "your business is ready." All state
// is real — it reads/writes the actual LaunchPlan / LaunchTask via the engine.
export default function GuidedLaunchWizard({ businessId, goal }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [runId, setRunId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState('');
  const startedRef = useRef(false);

  const bizQ = useQuery({
    queryKey: ['business', businessId],
    queryFn: () => base44.entities.Business.get(businessId),
    enabled: !!businessId,
    staleTime: 60000,
  });

  // Find an existing launch_business run for this business, or start one (once).
  useEffect(() => {
    let live = true;
    (async () => {
      if (startedRef.current) return;
      startedRef.current = true;
      setStarting(true);
      try {
        const rows = await base44.entities.LaunchPlan.filter({ business_id: businessId, plan_template_id: 'launch_business' }, '-created_date', 20).catch(() => []);
        // Prefer the newest ACTIVE run (resume); else fall back to the latest run.
        let run = (rows || []).find((r) => ACTIVE_RUN_STATES.has(r.status)) || (rows || [])[0] || null;
        if (!run) {
          const res = await workflowsApi.launch(businessId, 'launch_business', goal);
          run = res.run;
        }
        if (live) setRunId(run.id);
      } catch (e) {
        if (live) setStartErr(e?.message || String(e));
      } finally {
        if (live) setStarting(false);
      }
    })();
    return () => { live = false; };
  }, [businessId, goal]);

  const q = useQuery({
    queryKey: ['launch-wizard', runId],
    queryFn: async () => {
      const [run, tasks] = await Promise.all([
        base44.entities.LaunchPlan.get(runId),
        base44.entities.LaunchTask.filter({ launch_id: runId }),
      ]);
      return { run, tasks: tasks || [] };
    },
    enabled: !!runId,
    refetchInterval: (qq) => (qq.state.data?.run && ACTIVE_RUN_STATES.has(qq.state.data.run.status)) ? 3000 : false,
  });

  const run = q.data?.run;
  const tasks = q.data?.tasks || [];
  const gate = tasks.find((t) => t.status === 'awaiting_approval');
  const runDone = run && ['completed', 'failed', 'cancelled'].includes(run.status) && !gate;
  const building = run && !gate && !runDone;
  const runningTask = tasks.find((t) => t.status === 'running' || t.status === 'retrying');

  useEffect(() => {
    if (runDone) confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors: ['#10b981', '#34d399', '#a3e635'] });
  }, [runDone]);

  const approve = async (g) => {
    setBusy(true);
    try {
      await workflowsApi.approve(runId, g.id, g.approval_payload?.recommended_option);
      await q.refetch();
    } catch (e) {
      toast({ title: 'Could not approve', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  // -------- hero copy --------
  let headline = "Let's launch your business.";
  let sub = 'I will get everything ready for you — your website, domain, email, CRM and marketing. Just sit back and watch.';
  if (building) {
    headline = 'Building your business…';
    sub = runningTask ? systemOf(runningTask.task_key).blurb + '…' : 'Working through the first steps…';
  } else if (gate) {
    headline = gate.task_key === 'blueprint_approval' ? 'Review your plan' : 'A quick review';
    sub = 'Approve to let me keep building everything for you.';
  } else if (runDone) {
    headline = 'Your business is ready 🎉';
    sub = 'Everything is set up. You can start operating right away.';
  } else if (startErr) {
    headline = 'We hit a snag';
    sub = startErr;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-16">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"><Sparkles size={22} /></span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-600">Launch OS</p>
            <h1 className="text-xs font-medium text-slate-500">{bizQ.data?.name || 'New business'}</h1>
          </div>
        </div>

        <h2 className="mt-8 text-3xl font-semibold tracking-tight text-slate-900">{headline}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">{sub}</p>

        <div className="mt-8">
          {startErr && !run ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{
              startErr.includes('TEMPLATE') ? 'Workflows are still warming up. Open the Workflow Center to seed them.' : startErr
            }</div>
          ) : starting || !run ? (
            <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Starting your launch…</div>
          ) : gate ? (
            <LaunchReviewGate gate={gate} run={run} businessId={businessId} busy={busy} onApprove={approve} />
          ) : runDone ? (
            <ReadyCard tasks={tasks} onEnter={() => navigate('/')} onAdvanced={() => navigate('/workflows')} />
          ) : (
            <LiveLaunchProgress tasks={tasks} />
          )}
        </div>

        {building && gate == null && run && (
          <p className="mt-6 flex items-center gap-1.5 text-[11px] text-slate-400">
            <Settings2 size={12} /> Prefer the technical view?
            <button onClick={() => navigate('/workflows')} className="font-medium text-emerald-700 hover:underline">Advanced Mode</button>
          </p>
        )}
      </div>
    </div>
  );
}

function ReadyCard({ tasks, onEnter, onAdvanced }) {
  const systems = tasks.filter((t) => t.type !== 'approval_gate');
  const anyWarn = systems.some((t) => ['failed', 'blocked'].includes(t.status));
  return (
    <div className="rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50/70 to-white p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="grid w-full grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-2">
          {systems.map((t) => {
            const sys = systemOf(t.task_key);
            const Icon = sys.icon;
            const ok = t.status === 'completed' || t.status === 'approved';
            const warn = t.status === 'failed' || t.status === 'blocked';
            return (
              <div key={t.id} className="flex items-center gap-2.5">
                <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-xl ${warn ? 'bg-amber-50 text-amber-600' : ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {ok ? <CheckCircle2 size={17} /> : warn ? <AlertTriangle size={15} /> : <Icon size={16} />}
                </span>
                <span className="text-sm font-medium text-slate-800">{sys.label}</span>
                <span className="ml-auto text-[11px] font-medium">{ok ? <span className="text-emerald-600">Ready</span> : warn ? <span className="text-amber-600">Needs setup</span> : <span className="text-slate-400">—</span>}</span>
              </div>
            );
          })}
        </div>
      </div>

      {anyWarn && (
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">A couple of systems need a tiny bit of setup (like connecting a domain provider). You can finish those anytime from the Workflow Center.</p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={onEnter} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-800"><Rocket size={16} /> Enter your Business OS <ArrowRight size={16} /></button>
        <button onClick={onAdvanced} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Settings2 size={15} /> Open in Advanced Mode</button>
      </div>
    </div>
  );
}