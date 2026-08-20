
const TILES = [
  { key: 'total_active', label: 'Total active', tone: 'slate' },
  { key: 'action_required', label: 'Action required', tone: 'amber' },
  { key: 'in_review', label: 'In review', tone: 'blue' },
  { key: 'processing', label: 'Processing', tone: 'blue' },
  { key: 'submitted', label: 'Submitted', tone: 'blue' },
  { key: 'approved', label: 'Approved', tone: 'emerald' },
  { key: 'rejected', label: 'Rejected', tone: 'rose' },
  { key: 'blocked', label: 'Blocked', tone: 'rose' },
  { key: 'unassigned', label: 'Unassigned', tone: 'amber' },
];
const EC_TILES = [
  { key: 'GUIDANCE_ONLY', label: 'Guidance only' },
  { key: 'INTELLIGENCE_ONLY', label: 'Intelligence only' },
  { key: 'PARTIAL_ASSIST', label: 'Partial assist' },
  { key: 'DOCUMENT_ASSIST', label: 'Document assist' },
  { key: 'APPLICATION_ASSIST', label: 'Application assist' },
  { key: 'END_TO_END', label: 'End-to-end' },
];

export default function AdminCaseSummary({ summary }) {
  const ec = summary.ec || {};
  return (
    <div className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
        {TILES.map((t) => (
          <div key={t.key} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{t.label}</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900">{summary[t.key] ?? 0}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {EC_TILES.map((t) => (
          <div key={t.key} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{t.label}</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-700">{ec[t.key] ?? 0}</p>
          </div>
        ))}
      </div>
    </div>
  );
}