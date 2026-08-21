import { Loader2, Sparkles, CheckCircle2, Wand2, RotateCcw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BlueprintDetailPanel({ active, versions, loading, onGenerate, onPublish, onVerify, onSelfImprove, onBack }) {
  if (loading && !active) return <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={20} /></div>;
  if (!active) return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">Select an industry to view its blueprint.</div>;
  const v = versions.find((x) => x.id === active.id) || active;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-3">
        <button onClick={onBack} className="mb-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><ArrowLeft size={13} /> Library</button>
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{active.category.replace(/_/g, ' ')}</p>
        <h2 className="text-lg font-semibold text-slate-900">{active.industry_label}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{active.business_model}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>active v{active.version}</Badge>
          {active.human_verified ? <Badge cls="bg-emerald-100 text-emerald-700">verified</Badge> : active.ai_generated ? <Badge cls="bg-violet-100 text-violet-700">AI generated</Badge> : <Badge cls="bg-slate-100 text-slate-600">catalog stub</Badge>}
          <Badge cls="bg-slate-100 text-slate-600">usage {active.usage_count || 0}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-2.5">
        <Button size="sm" onClick={onGenerate} className="h-8 bg-violet-600 hover:bg-violet-700"><Sparkles size={14} /> {active.ai_generated ? 'Regenerate' : 'AI Generate'}</Button>
        <Button size="sm" variant="outline" onClick={onSelfImprove} className="h-8"><Wand2 size={14} /> Self-Improve</Button>
        <Button size="sm" variant="outline" onClick={onVerify} className="h-8"><CheckCircle2 size={14} /> {active.human_verified ? 'Unverify' : 'Verify'}</Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Versions (history is never overwritten)</h3>
        <div className="space-y-1.5">
          {versions.map((vr) => (
            <div key={vr.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <div><p className="font-medium text-slate-700">v{vr.version} {vr.status === 'active' && <span className="text-emerald-600">· active</span>} {vr.status === 'superseded' && <span className="text-slate-400">· superseded</span>}</p><p className="text-[10px] text-slate-400">{vr.ai_generated ? 'AI' : 'human'} · {vr.human_verified ? 'verified' : 'unverified'} · {vr.field_count} fields</p></div>
              {vr.status === 'draft' && <Button size="sm" variant="outline" onClick={() => onPublish(vr.id)} className="h-7 text-[11px]"><RotateCcw size={11} /> publish v{vr.version}</Button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Badge({ children, cls = "bg-slate-100 text-slate-600" }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}