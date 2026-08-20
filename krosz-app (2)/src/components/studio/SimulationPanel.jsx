import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play, ShieldCheck, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function SimulationPanel({ canvas, onValidate, onSimulate }) {
  const [loading, setLoading] = useState('');
  const [validation, setValidation] = useState(null);
  const [sim, setSim] = useState(null);

  const validate = async () => {
    setLoading('validate');
    try { const r = await onValidate(canvas); setValidation(r); } finally { setLoading(''); }
  };
  const simulate = async () => {
    setLoading('simulate');
    try { const r = await onSimulate(canvas); setSim(r); } finally { setLoading(''); }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 p-3">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={validate} disabled={!!loading} className="h-7 text-xs">
          {loading === 'validate' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Validate
        </Button>
        <Button size="sm" onClick={simulate} disabled={!!loading} className="h-7 text-xs">
          {loading === 'simulate' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Simulate
        </Button>
      </div>
      {validation && (
        <div className="rounded-lg border border-slate-200 p-2 text-[11px]">
          {validation.ok ? <p className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={12} /> Valid DAG · {validation.task_count} tasks</p> : <p className="flex items-center gap-1 text-rose-600"><AlertTriangle size={12} /> {validation.errors.join('; ')}</p>}
          {validation.warnings?.map((w, i) => <p key={i} className="mt-1 text-amber-600">⚠ {w}</p>)}
        </div>
      )}
      {sim && (
        <div className="rounded-lg border border-slate-200 p-2 text-[11px]">
          {sim.ok ? (
            <>
              <p className="font-semibold text-slate-700">Estimated runtime: <span className="text-emerald-700">{sim.estimated_runtime_human}</span></p>
              <p className="text-slate-500">Cost: ${sim.totals.total_cost} (AI ${sim.totals.ai_cost} · API ${sim.totals.api_cost}) · {sim.wave_count} waves</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {sim.approvals?.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700"><ShieldCheck size={10} />{k}</span>)}
                {sim.waiting?.map((k) => <span key={k} className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-700">⏳ {k}</span>)}
              </div>
              <p className="mt-1.5 text-slate-500">Execution: {sim.execution_path?.join(' → ')}</p>
            </>
          ) : <p className="text-rose-600">{sim.errors?.join('; ')}</p>}
        </div>
      )}
    </div>
  );
}