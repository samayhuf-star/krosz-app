import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Clock, X, Star } from 'lucide-react';

function Stars({ value }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} className={i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
      ))}
      <span className="ml-1 text-xs font-semibold text-slate-700">{value ? value.toFixed(1) : '0'}</span>
    </div>
  );
}

export default function DomainCandidateCard({ item, isBest, onBuy, busy }) {
  if (item.available === false) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 opacity-70">
        <div className="flex items-center justify-between">
          <p className="font-mono text-sm font-medium text-slate-500">{item.domain}</p>
          <Badge variant="secondary" className="text-slate-500"><X size={12} className="mr-1" /> Taken</Badge>
        </div>
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border p-4 transition-shadow ${isBest ? 'border-emerald-500 bg-emerald-50/50 shadow-md ring-1 ring-emerald-500' : 'border-slate-200 bg-white hover:shadow-sm'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-base font-semibold text-slate-900">{item.domain}</p>
          <div className="mt-1.5"><Stars value={item.stars} /></div>
        </div>
        <div className="text-right">
          {item.is_estimated ? (
            <p className="text-sm font-semibold text-slate-800">≈ ${item.price}<span className="text-xs font-normal text-slate-400">/yr</span></p>
          ) : (
            <p className="text-sm font-semibold text-slate-800">${item.price}<span className="text-xs font-normal text-slate-400">/yr</span></p>
          )}
          {isBest && <Badge className="mt-1 bg-emerald-700">Best Choice</Badge>}
        </div>
      </div>
      {item.reasons.length > 0 && (
        <ul className="mt-3 space-y-1">
          {item.reasons.map((r) => (
            <li key={r} className="flex items-center gap-1.5 text-xs text-slate-600"><Check size={12} className="text-emerald-600" /> {r}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={() => onBuy(item.domain)} disabled={busy} className="bg-emerald-800 hover:bg-emerald-900">
          {busy ? <Clock size={14} className="animate-spin" /> : null} Buy Domain
        </Button>
        {item.is_estimated && <span className="text-[11px] text-slate-400">estimated price</span>}
      </div>
    </div>
  );
}