import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Play, ShieldCheck, Network, ArrowRight, CheckCircle2, Lock, DollarSign } from 'lucide-react';
import { studioApi } from '@/lib/studioApi';
import { useToast } from '@/components/ui/use-toast';

// Execution Preview (spec §15): shows task count, approval gates, dependency info
// and the estimated execution path for a PUBLISHED template, then runs it through the
// existing launchRun — no new execution engine. Nothing is executed during preview.
// On success the dialog shows the run id / status and links to the Workflow Execution
// Center (/workflows) where the new LaunchPlan + LaunchTasks appear.
export default function RunPreviewDialog({ open, onOpenChange, template, businessId, onLaunched }) {
  const [loading, setLoading] = useState('');
  const [launched, setLaunched] = useState(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  if (!template) return null;

  const run = async () => {
    setLoading('run');
    try {
      const r = await studioApi.execute(template.template_id, businessId);
      setLaunched({ run_id: r.run_id, status: r.status, version: r.version, idempotent: r.idempotent });
      toast({ title: 'Workflow launched', description: `Run ${String(r.run_id).slice(-6)} · v${r.version} · ${r.status}` });
      onLaunched?.(r.run_id);
    } catch (e) {
      toast({ title: 'Launch failed', description: e?.message || String(e), variant: 'destructive' });
    } finally { setLoading(''); }
  };

  const close = () => { setLaunched(null); onOpenChange(false); };

  const tasks = template.tasks || [];
  const path = (template.execution_path || []).join('  →  ');

  if (launched) {
    return (
      <Dialog open onOpenChange={close}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" /> Workflow launched</DialogTitle>
            <DialogDescription>A new run was created in the existing Workflow Engine. Track it live in the Workflow Execution Center.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-slate-500">Template</span><span className="font-medium text-slate-800">{template.name} <span className="text-slate-400">v{launched.version}</span></span></div>
            <div className="mt-1.5 flex items-center justify-between"><span className="text-slate-500">Run ID</span><span className="font-mono text-xs text-slate-800">{launched.run_id}</span></div>
            <div className="mt-1.5 flex items-center justify-between"><span className="text-slate-500">Status</span><span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{launched.status}</span></div>
            {launched.idempotent && <p className="mt-2 text-[11px] text-slate-400">Idempotent: an equivalent active run already existed and was reused.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Stay in Builder</Button>
            <Button onClick={() => { close(); navigate('/workflows'); }} className="bg-emerald-700 hover:bg-emerald-800"><ArrowRight size={15} /> Open in Workflows</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Run “{template.name}”</DialogTitle>
          <DialogDescription>Preview the run, then launch it through the existing Workflow Engine. The run appears live in the Workflow Execution Center.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <Stat icon={<Network size={14} />} label="Tasks" value={template.task_count ?? '—'} tone="text-slate-700" />
          <Stat icon={<ShieldCheck size={14} />} label="Approval gates" value={template.approval_gates ?? 0} tone="text-amber-700" />
          <Stat icon={<Network size={14} />} label="Version" value={`v${template.version}`} tone="text-slate-700" />
        </div>

        {/* Dependency information — per task depends_on (read from the published snapshot, no execution). */}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Dependency information</p>
          <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
            {tasks.length === 0 && <p className="text-[11px] text-slate-400">No tasks exported for this template.</p>}
            {tasks.map((t) => (
              <div key={t.key} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-slate-700">{t.key}</span>
                <span className="text-slate-400">({t.type})</span>
                {t.needs_approval && <Lock size={10} className="text-amber-600" />}
                {t.money_spending && <DollarSign size={10} className="text-emerald-600" />}
                <span className="ml-auto text-slate-500 truncate">{(t.depends_on && t.depends_on.length) ? `← ${t.depends_on.join(', ')}` : <span className="text-slate-400">root</span>}</span>
              </div>
            ))}
          </div>
        </div>

        {path && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Estimated execution path</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-600 break-words">{path}</p>
          </div>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><ShieldCheck size={12} /> Execution uses the existing Workflow Engine — the builder never runs factories directly. Nothing runs during preview.</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!loading}>Cancel</Button>
          <Button onClick={run} disabled={!!loading} className="bg-emerald-700 hover:bg-emerald-800">
            {loading === 'run' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run Workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon, label, value, tone }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{icon} {label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}