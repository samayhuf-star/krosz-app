import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, History, RotateCcw, Rocket } from 'lucide-react';
import ProvenanceChip from './ProvenanceChip';

export default function PublishPanel({ websites, active, publishHistory, onPublish, onRollback, busy }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-900">Publishing & versioning</p>
        <p className="mt-1 text-sm text-slate-600">Publishing freezes the current draft as an immutable Website version. New publishes create V2, V3… and supersede the prior; rollback re-activates any version. Previous versions are never overwritten.</p>
        {active?.status === 'draft' && (
          <Button onClick={onPublish} disabled={busy === 'publish'} className="mt-4 bg-emerald-700 hover:bg-emerald-800">
            {busy === 'publish' ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Publish Website v{active.version}
          </Button>
        )}
        {active?.status === 'published' && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 size={15} /> Website v{active.version} is live.</div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><History size={15} className="text-emerald-600" /> Website versions</p>
        <ul className="space-y-2">
          {websites.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Website v{w.version}</p>
                <p className="text-xs text-slate-500">{w.name} · {w.status}{w.published_at ? ` · ${new Date(w.published_at).toLocaleDateString()}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={w.status === 'published' ? 'bg-emerald-600' : w.status === 'superseded' ? 'bg-slate-300 text-slate-600' : 'bg-amber-500'}>{w.status}</Badge>
                {w.status !== 'published' && w.id !== active?.id && (
                  <Button size="sm" variant="outline" onClick={() => onRollback(w.id)} disabled={busy === 'rollback'}>
                    {busy === 'rollback' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Rollback
                  </Button>
                )}
              </div>
            </li>
          ))}
          {!websites.length && <p className="text-sm text-slate-500">No websites yet.</p>}
        </ul>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold text-slate-900">Publish history</p>
        <ul className="space-y-2">
          {publishHistory?.length ? publishHistory.map((h, i) => (
            <li key={i} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-900">v{h.version} · {h.published_by} {h.published_at && <span className="text-slate-400">on {new Date(h.published_at).toLocaleString()}</span>}</p>
                <Badge variant="outline">{h.summary?.validation_status || '—'}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">{h.page_count} pages · {h.component_count} components · {h.media_count} media items</p>
              <ProvenanceChip provenance={h.provenance} />
            </li>
          )) : <p className="text-sm text-slate-500">No publishes recorded yet.</p>}
        </ul>
      </div>
    </div>
  );
}