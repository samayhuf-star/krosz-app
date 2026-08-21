import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Play, FileText, Inbox, CheckCircle2, Archive, RefreshCw } from 'lucide-react';
import { studioApi } from '@/lib/studioApi';

const TABS = ['published', 'drafts'];

// Template Library — lists BOTH published PlanTemplates (open/duplicate/run) and
// the user's drafts (open/edit/publish/archive), exactly as spec §10 requires. No
// duplicate templates are created: published rows come straight from PlanTemplate.
export default function TemplateLibrary({ open, onOpenChange, onOpenDraft, onDuplicateTemplate, onRunTemplate, onNewDraft }) {
  const [tab, setTab] = useState('published');
  const [templates, setTemplates] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [t, d] = await Promise.all([studioApi.listTemplates(), studioApi.listDrafts()]);
      setTemplates(t.templates || []);
      setDrafts(d.drafts || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { if (open) load(); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Workflow Templates</DialogTitle>
          <DialogDescription>Open, duplicate, run, or publish workflow templates. Published templates execute through the existing Workflow Engine.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-slate-200">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {t === 'published' ? 'Published Templates' : 'My Drafts'} ({t === 'published' ? templates.length : drafts.length})
            </button>
          ))}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={load} className="h-7"><RefreshCw size={13} /></Button>
          <Button size="sm" onClick={onNewDraft} className="h-7 bg-emerald-700 hover:bg-emerald-800"><FileText size={13} /> New Workflow</Button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {loading ? (
            <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
          ) : tab === 'published' ? (
            templates.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">No published templates yet. Publish a draft to make it available to the Workflow Engine.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {templates.map((t) => (
                  <div key={t.template_id} className="flex items-center gap-3 px-1 py-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CheckCircle2 size={16} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{t.name} <span className="ml-1 text-[11px] font-normal text-slate-400">v{t.version}</span></p>
                      <p className="truncate text-[11px] text-slate-500"><span className="mr-1 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Active</span>{t.task_count} tasks · {t.approval_gates} approval gates · {t.tenant_id === 'system' ? 'platform' : 'workspace'} · updated {new Date(t.updated_date || t.created_date).toLocaleDateString()}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => onDuplicateTemplate(t.template_id)} className="h-7"><Copy size={13} /> Duplicate</Button>
                    <Button size="sm" onClick={() => onRunTemplate(t)} className="h-7 bg-emerald-700 hover:bg-emerald-800"><Play size={13} /> Run</Button>
                  </div>
                ))}
              </div>
            )
          ) : (
            drafts.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">No drafts. Click “New Workflow” to design one visually.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {drafts.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-1 py-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">{d.status === 'published' ? <CheckCircle2 size={16} /> : <FileText size={16} />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{d.name} {d.template_id && <span className="ml-1 text-[11px] font-normal text-slate-400">{d.template_id} · v{d.published_version}</span>}</p>
                      <p className="truncate text-[11px] text-slate-500">{d.status} · rev {d.version} · {(d.canvas?.nodes || []).length} nodes · {new Date(d.updated_date).toLocaleDateString()}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => onOpenDraft(d.id)} className="h-7"><Inbox size={13} /> Open</Button>
                    {d.status !== 'published' && <Button variant="ghost" size="sm" onClick={() => studioApi.deleteDraft(d.id).then(load)} className="h-7 text-rose-600"><Archive size={13} /></Button>}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}