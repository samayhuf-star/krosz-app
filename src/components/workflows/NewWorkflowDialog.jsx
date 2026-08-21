import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Rocket, Loader2, Wand2 } from 'lucide-react';
import { workflowsApi } from '@/lib/workflowsApi';
import { prettyKey } from './statusMeta';
import { useToast } from '@/components/ui/use-toast';

// Minimal reusable-template launcher (Step 3, lightweight): pick one of the
// engine's registered PlanTemplates and a business, optionally add a goal,
// and start a new workflow run on the universal engine. The visual builder
// (Step 4) and launch wizard (Step 8) are the next phase.
export default function NewWorkflowDialog({ open, onOpenChange, onLaunched }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState(null);
  const [businessId, setBusinessId] = useState(null);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);

  const templatesQ = useQuery({
    queryKey: ['workflows', 'templates'],
    queryFn: workflowsApi.listTemplates,
    enabled: open,
    staleTime: 60000,
  });
  const businessesQ = useQuery({
    queryKey: ['workflows', 'businesses'],
    queryFn: () => base44.entities.Business.list('-created_date', 50),
    enabled: open,
    staleTime: 30000,
  });

  const templates = templatesQ.data?.templates || [];
  const businesses = businessesQ.data || [];

  const launch = async () => {
    if (!templateId || !businessId) {
      toast({ title: 'Pick a workflow type and a business', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const res = await workflowsApi.launch(businessId, templateId, goal || undefined);
      await qc.invalidateQueries({ queryKey: ['workflows', 'runs'] });
      onLaunched(res.run.id);
      onOpenChange(false);
      setTemplateId(null); setBusinessId(null); setGoal('');
      toast({ title: 'Workflow launched', description: prettyKey(templateId) });
    } catch (e) {
      toast({ title: 'Launch failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 size={18} /> Start a workflow</DialogTitle>
          <DialogDescription>Reusable templates run on the same engine. Pick one to launch it live.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Workflow type</Label>
            <div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto">
              {templatesQ.isLoading ? (
                <p className="col-span-2 text-sm text-slate-400">Loading templates…</p>
              ) : templates.length ? templates.map((t) => (
                <button
                  key={`${t.template_id}:${t.version}`}
                  onClick={() => setTemplateId(t.template_id)}
                  className={`rounded-xl border p-2.5 text-left transition-colors ${templateId === t.template_id ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <p className="text-sm font-semibold text-slate-900">{prettyKey(t.template_id)}</p>
                  <p className="text-[11px] text-slate-400">{t.task_count} steps</p>
                </button>
              )) : <p className="col-span-2 text-sm text-slate-400">No templates registered.</p>}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Business</Label>
            <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto">
              {businessesQ.isLoading ? (
                <p className="col-span-2 text-sm text-slate-400">Loading businesses…</p>
              ) : businesses.length ? businesses.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBusinessId(b.id)}
                  className={`truncate rounded-xl border px-2.5 py-2 text-left text-sm transition-colors ${businessId === b.id ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  {b.name}
                </button>
              )) : <p className="col-span-2 text-sm text-slate-400">No businesses yet.</p>}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Goal (optional)</Label>
            <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="e.g. Launch the dental clinic in Dallas" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={launch} disabled={busy} className="bg-emerald-700 hover:bg-emerald-800">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Launch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}