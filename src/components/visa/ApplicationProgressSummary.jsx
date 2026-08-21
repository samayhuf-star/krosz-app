import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { listApplicationDocuments } from '@/lib/visaApi';

// §10: a clear "what's done / what's required / any blockers" summary shown
// when a traveler returns to an application mid-flow. It derives everything
// from existing case context + document progress — no new state, no mutation.
const STATE_DONE = new Set(['verified', 'approved', 'used']);
const STATE_BLOCKED = new Set(['needs_review', 'rejected', 'replacement_required']);
const STATE_PENDING = new Set(['processing', 'pending_review', 'uploaded']);

export default function ApplicationProgressSummary({ ctx, caseId }) {
  const docsQ = useQuery({
    queryKey: ['case-progress-docs', caseId],
    queryFn: () => listApplicationDocuments(caseId).catch(() => ({ documents: [], attachments: [], progress: { items: [] } })),
    enabled: !!caseId,
  });

  if (!ctx) return null;
  const required = (ctx.required_docs || []).filter((d) => d.mandatory !== false && d.mandatory !== 'na');
  const progress = docsQ.data?.progress || { items: [] };

  const done = [];
  const requiredRemaining = [];
  const blockers = [];

  // Eligibility
  if (ctx.eligibility === 'eligible') done.push({ label: 'Eligibility confirmed' });
  else blockers.push({ label: 'Eligibility needs confirmation', tone: 'amber' });

  // Documents
  const findItem = (code) => (progress.items || []).find((i) =>
    String(i.document_type || '').toUpperCase() === String(code || '').toUpperCase() ||
    (i.document_types || []).some((t) => String(t).toUpperCase() === String(code || '').toUpperCase()) ||
    String(i.requirement_id || '') === String(code || '')
  );
  for (const d of required) {
    const item = findItem(d.code);
    const state = item?.state;
    if (state && STATE_DONE.has(state)) done.push({ label: d.label });
    else if (state && STATE_BLOCKED.has(state)) blockers.push({ label: `${d.label}: needs attention`, tone: 'rose' });
    else if (state && STATE_PENDING.has(state)) requiredRemaining.push({ label: `${d.label}: in review` });
    else requiredRemaining.push({ label: d.label });
  }

  // Payment
  const fee = ctx.fee || {};
  if (fee.available && ctx.next_action?.blocked && /pay|payment/i.test(ctx.next_action?.label || '')) {
    requiredRemaining.push({ label: 'Payment pending' });
  }

  // Overall blocker from the case engine
  if (ctx.next_action?.blocked) blockers.push({ label: ctx.next_action.label, tone: 'rose' });

  const total = required.length || 1;
  const completedPct = Math.min(100, Math.round((done.filter((x) => required.some((d) => d.label === x.label) || x.label === 'Eligibility confirmed').length / (total + 1)) * 100));

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Where this application stands</h2>
        <span className="text-xs text-slate-400">{completedPct}% complete</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-[#006CEC] transition-all" style={{ width: `${completedPct}%` }} />
      </div>

      {docsQ.isLoading ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Loading document status…</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Column title="Done" icon={CheckCircle2} tone="emerald" items={done} />
          <Column title="Still required" icon={Clock} tone="amber" items={requiredRemaining} />
          <Column title="Blockers" icon={AlertCircle} tone={blockers.length ? 'rose' : 'slate'} items={blockers} emptyText="Nothing blocking you right now" />
        </div>
      )}
    </div>
  );
}

function Column({ title, icon: Icon, tone, items, emptyText = '' }) {
  const tones = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
    slate: 'text-slate-400',
  };
  const dot = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', slate: 'bg-slate-300' };
  return (
    <div>
      <p className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tones[tone] || tones.slate}`}><Icon size={13} /> {title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyText || 'All clear'}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot[it.tone === 'rose' ? 'rose' : tone === 'emerald' ? 'emerald' : tone === 'amber' ? 'amber' : 'slate']}`} />
              <span>{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}