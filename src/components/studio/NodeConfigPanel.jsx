import { Trash2, ShieldCheck, DollarSign, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export default function NodeConfigPanel({ node, nodes, iconMap = {}, onChange, onRemove }) {
  if (!node) return <div className="p-4 text-xs text-slate-400">Select a node to configure its inputs, dependencies, retry and approval.</div>;

  const others = nodes.filter((n) => n.id !== node.id && !n.structural || (n.structural && n.kind === 'trigger'));
  const deps = new Set((node._deps || []).map(String));

  const update = (patch) => onChange(node.id, { ...node, ...patch });
  const toggleDep = (id) => {
    const next = deps.has(id) ? [...deps].filter((d) => d !== id) : [...deps, id];
    onChange(node.id, { ...node, _deps: next });
    // bubble edges through _deps so the page can sync
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Node</p>
        <Button variant="ghost" size="sm" onClick={() => onRemove(node.id)} className="h-7 text-rose-600 hover:text-rose-700"><Trash2 size={14} /> Remove</Button>
      </div>
      <div>
        <Label className="text-[11px]">Name</Label>
        <Input value={node.title || ''} onChange={(e) => update({ title: e.target.value })} className="h-8 text-xs" />
      </div>
      <div>
        <Label className="text-[11px]">Description</Label>
        <Textarea value={node.description || ''} onChange={(e) => update({ description: e.target.value })} className="min-h-[48px] text-xs" />
      </div>
      <div>
        <Label className="text-[11px]">Dependencies (runs after these)</Label>
        <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
          {others.length === 0 && <p className="text-[11px] text-slate-400">No other nodes yet.</p>}
          {others.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={node._deps?.includes(o.id)} onChange={() => toggleDep(o.id)} className="h-3.5 w-3.5" />
              <span className="truncate">{o.title || o.id}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-xs">
          <input type="checkbox" checked={!!node.needs_approval} onChange={(e) => update({ needs_approval: e.target.checked })} className="h-3.5 w-3.5" />
          <ShieldCheck size={13} className="text-amber-600" /> Approval
        </label>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-xs">
          <input type="checkbox" checked={!!node.money_spending} onChange={(e) => update({ money_spending: e.target.checked })} className="h-3.5 w-3.5" />
          <DollarSign size={13} className="text-emerald-600" /> Money
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[11px]"><Clock size={11} className="inline" /> Timeout (s)</Label>
          <Input type="number" value={node.timeout_s ?? ''} onChange={(e) => update({ timeout_s: +e.target.value || undefined })} className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[11px]">Max retries</Label>
          <Input type="number" value={node.max_retries ?? 3} onChange={(e) => update({ max_retries: +e.target.value || 0 })} className="h-8 text-xs" />
        </div>
      </div>
      <div>
        <Label className="text-[11px]">Provider / capability</Label>
        <Input value={node.capability || ''} onChange={(e) => update({ capability: e.target.value })} placeholder="leave blank for default" className="h-8 text-xs" />
      </div>
    </div>
  );
}