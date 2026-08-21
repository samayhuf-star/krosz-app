// Worldz Visa (Phase 25) — Change Detection queue: pending material source changes
// awaiting admin review (accept applies the new truth + recomputes verification).
import { useQuery } from '@tanstack/react-query';
import { Loader2, Radar, GitCompare, Check, X } from 'lucide-react';
import { adminChangeReviewList } from '@/lib/visaApi';
import { Chip } from '@/components/visa/matrix/matrixShared';

const CHANGE_TONE = {
  MATERIAL: 'bg-rose-50 text-rose-700 border-rose-200',
  NON_MATERIAL: 'bg-amber-50 text-amber-700 border-amber-200',
  NONE: 'bg-slate-50 text-slate-500 border-slate-200',
};
const RISK_TONE = { HIGH: 'text-rose-700', MEDIUM: 'text-amber-700', LOW: 'text-orange-700', UNKNOWN: 'text-slate-500' };

export default function ChangeDetectionTab({ busy, onSelect, onAccept, onReject }) {
  const q = useQuery({ queryKey: ['admin-change-review-list'], queryFn: () => adminChangeReviewList() });
  const rows = q.data?.reviews || [];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-600"><Radar size={14} className="mr-1.5 inline -mt-0.5" />Material source changes awaiting admin review. Accept applies the new truth + recomputes verification; reject keeps the previous value.</p>
        <button onClick={() => q.refetch()} disabled={busy} className="text-xs text-slate-500 hover:text-slate-800">Refresh</button>
      </div>
      {q.isLoading ? <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div> : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <GitCompare className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">No pending material changes</p>
          <p className="text-xs text-slate-400">Source snapshots are diffed against the previous capture; material changes appear here for review.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2 font-medium">Destination</th><th className="px-3 py-2 font-medium">Claim</th><th className="px-3 py-2 font-medium">Change</th><th className="px-3 py-2 font-medium">Material fields</th><th className="px-3 py-2 font-medium">Risk</th><th className="px-3 py-2 font-medium">Captured</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ snapshot: s, capability: c }) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">{c?.country_code || '—'} <span className="text-[11px] font-normal text-slate-400">{c?.journey_type}</span></td>
                  <td className="px-3 py-2 text-slate-600">{s.claim_type}</td>
                  <td className="px-3 py-2"><Chip value={s.change_vs_previous} items={CHANGE_TONE} /></td>
                  <td className="px-3 py-2 text-xs text-slate-600">{(s.material_fields || []).join(', ') || '—'}</td>
                  <td className={`px-3 py-2 text-xs ${RISK_TONE[c?.change_risk || 'UNKNOWN']}`}>{c?.change_risk || 'UNKNOWN'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{s.captured_at ? new Date(s.captured_at).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => onSelect(s)} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">Review</button>
                      <button onClick={() => onAccept(s.id)} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700"><Check size={12} /> Accept</button>
                      <button onClick={() => onReject({ snapshot_id: s.id })} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-700"><X size={12} /> Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}