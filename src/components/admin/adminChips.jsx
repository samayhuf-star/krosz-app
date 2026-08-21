export function stateTone(s) {
  if (['APPROVED', 'COMPLETED'].includes(s)) return 'emerald';
  if (['REJECTED', 'CANCELLED', 'EXPIRED'].includes(s)) return 'rose';
  if (['REVIEW_REQUIRED', 'ADDITIONAL_INFORMATION_REQUIRED', 'DOCUMENTS_REQUIRED'].includes(s)) return 'amber';
  if (['SUBMITTED', 'PROCESSING'].includes(s)) return 'blue';
  return 'slate';
}
export function ecTone(ec) {
  if (ec === 'END_TO_END') return 'emerald';
  if (ec === 'APPLICATION_ASSIST' || ec === 'PARTIAL_ASSIST') return 'blue';
  if (ec === 'DOCUMENT_ASSIST' || ec === 'INTELLIGENCE_ONLY') return 'violet';
  if (ec === 'GUIDANCE_ONLY' || ec === 'UNKNOWN') return 'slate';
  return 'slate';
}
export function priorityTone(p) {
  if (p === 'URGENT') return 'rose';
  if (p === 'HIGH') return 'amber';
  if (p === 'LOW') return 'slate';
  return 'blue';
}
export function Chip({ tone, label }) {
  const map = { emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', rose: 'bg-rose-50 text-rose-700', slate: 'bg-slate-100 text-slate-600', blue: 'bg-blue-50 text-blue-700', violet: 'bg-violet-50 text-violet-700' };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${map[tone] || map.slate}`}>{label}</span>;
}