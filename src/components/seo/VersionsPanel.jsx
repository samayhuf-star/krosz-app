import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, RotateCcw, History, Rocket } from 'lucide-react';

const STATUS = { published: 'bg-emerald-600', approved: 'bg-sky-600', draft: 'bg-amber-500', rejected: 'bg-rose-500', superseded: 'bg-slate-300 text-slate-600' };

export default function VersionsPanel({ versions, activeVersionId, onApprove, onReject, onPublish, onRollback, busy }) {
  if (!versions?.length) return <p className="text-sm text-slate-500">No SEO versions yet.</p>;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><History size={15} className="text-emerald-600" /> SEO versions — every generation creates a new immutable version; prior versions are never overwritten.</p>
      </div>
      <ul className="space-y-2">
        {versions.map((v) => {
          const isActive = v.id === activeVersionId;
          return (
            <li key={v.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${isActive ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
              <div>
                <p className="text-sm font-semibold text-slate-900">SEO Version {v.version} {isActive && <Badge className="ml-1 bg-emerald-600">active</Badge>}</p>
                <p className="text-xs text-slate-500">{v.status} · health {v.health_score ?? '—'}/100 · validation {v.validation_status}{v.published_at ? ` · published ${new Date(v.published_at).toLocaleDateString()}` : v.approved_at ? ` · approved ${new Date(v.approved_at).toLocaleDateString()}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={STATUS[v.status] || 'bg-slate-300'}>{v.status}</Badge>
                {v.status === 'draft' && (
                  <>
                    <Button size="sm" onClick={() => onApprove(v.id)} disabled={busy?.startsWith('approve')} className="bg-emerald-700 hover:bg-emerald-800"><CheckCircle2 size={13} /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => onReject(v.id)} disabled={busy?.startsWith('reject')}><XCircle size={13} className="text-rose-600" /> Reject</Button>
                  </>
                )}
                {v.status === 'approved' && !isActive && (
                  <Button size="sm" onClick={() => onPublish(v.id)} disabled={busy?.startsWith('publish')} className="bg-emerald-700 hover:bg-emerald-800"><Rocket size={13} /> Publish</Button>
                )}
                {(v.status === 'approved' || v.status === 'superseded') && (
                  <Button size="sm" variant="outline" onClick={() => onRollback(v.id)} disabled={busy?.startsWith('rollback')}><RotateCcw size={13} /> Rollback</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}