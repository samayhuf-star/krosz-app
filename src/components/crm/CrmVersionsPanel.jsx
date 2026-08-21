import { CheckCircle2, RotateCcw, Rocket, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function CrmVersionsPanel({ versions, activeVersionId, onApprove, onReject, onPublish, onRollback, busy }) {
  const list = versions || [];
  const statusBadge = (s) => s === 'published' ? 'bg-emerald-600' : s === 'approved' ? 'bg-sky-600' : s === 'draft' ? 'bg-amber-500' : s === 'rejected' ? 'bg-rose-500' : 'bg-slate-400';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700"><History size={16} className="text-emerald-700" />Version History · {list.length}</h3>
      <ol className="space-y-3">
        {list.map((v) => {
          const isActive = v.id === activeVersionId && (v.status === 'published' || v.status === 'approved');
          return (
            <li key={v.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${isActive ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">v{v.version}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">CRM Version {v.version}</p>
                    <Badge className={statusBadge(v.status)}>{v.status}</Badge>
                    {isActive && <Badge variant="outline" className="border-emerald-300 text-emerald-700">active</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">{v.published_at ? `Published ${new Date(v.published_at).toLocaleDateString()}` : v.approved_at ? `Approved ${new Date(v.approved_at).toLocaleDateString()}` : 'Not approved'} · Health {v.health_score ?? '—'}/100</p>
                </div>
              </div>
              <div className="flex gap-2">
                {v.status === 'draft' && <><Button onClick={() => onReject(v.id)} disabled={busy?.startsWith('reject')} variant="outline" size="sm">Reject</Button><Button onClick={() => onApprove(v.id)} disabled={busy?.startsWith('approve')} size="sm" className="bg-emerald-700 hover:bg-emerald-800"><CheckCircle2 size={15} /> Approve</Button></>}
                {v.status === 'approved' && !isActive && <Button onClick={() => onPublish(v.id)} disabled={busy?.startsWith('publish')} size="sm" className="bg-emerald-700 hover:bg-emerald-800"><Rocket size={15} /> Publish</Button>}
                {(v.status === 'approved' || v.status === 'superseded') && <Button onClick={() => onRollback(v.id)} disabled={busy?.startsWith('rollback')} variant="outline" size="sm"><RotateCcw size={15} /> Rollback</Button>}
                {v.status === 'rejected' && <span className="text-xs text-slate-400">Rejected — generate a new version to retry</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}