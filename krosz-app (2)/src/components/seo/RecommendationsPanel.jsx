import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, Loader2 } from 'lucide-react';

const PRIO = { urgent: 'bg-rose-500', high: 'bg-amber-500', medium: 'bg-sky-500', low: 'bg-slate-400' };
const CAT_TONE = { content: 'text-emerald-700', technical: 'text-sky-700', schema: 'text-indigo-700', internal_links: 'text-violet-700', local: 'text-rose-700', metadata: 'text-amber-700' };

export default function RecommendationsPanel({ recommendations, onAction, busyId }) {
  if (!recommendations?.length) return <p className="text-sm text-slate-500">No recommendations.</p>;
  return (
    <div className="space-y-3">
      {recommendations.map((r) => (
        <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`${PRIO[r.priority] || 'bg-slate-400'} text-white`}>{r.priority}</Badge>
                <span className={`text-xs font-medium uppercase ${CAT_TONE[r.category] || ''}`}>{r.category}</span>
                <Badge variant="outline" className="text-[10px]">impact: {r.estimated_impact}</Badge>
                <Badge variant="outline" className="text-[10px]">effort: {r.estimated_difficulty}</Badge>
              </div>
              <p className="mt-2 font-semibold text-slate-900">{r.title}</p>
              {r.description && <p className="mt-1 text-sm text-slate-600">{r.description}</p>}
              {r.page_slug && <p className="mt-1 font-mono text-xs text-slate-400">page: /{r.page_slug}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
              {r.status === 'pending' && (
                <>
                  <Button size="sm" variant="outline" onClick={() => onAction(r.id, 'approved')} disabled={busyId === r.id}><Check size={13} className="text-emerald-600" /> Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => onAction(r.id, 'rejected')} disabled={busyId === r.id}><X size={13} className="text-rose-600" /> Reject</Button>
                </>
              )}
              {r.status === 'approved' && <Button size="sm" variant="outline" onClick={() => onAction(r.id, 'applied')} disabled={busyId === r.id}>{busyId === r.id ? <Loader2 size={13} className="animate-spin" /> : 'Mark applied'}</Button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}