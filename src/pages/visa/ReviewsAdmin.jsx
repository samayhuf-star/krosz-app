import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { adminListReviews, getReview, waiveReviewFinding, dismissReviewFinding } from '@/lib/visaApi';

const FILTERS = ['BLOCKED', 'REQUIRES_HUMAN_REVIEW', 'WARNINGS', 'PASSED', 'ALL'];

const STATUS_CHIP = {
  PASSED: 'bg-orange-100 text-orange-800',
  WARNINGS: 'bg-amber-100 text-amber-800',
  BLOCKED: 'bg-red-100 text-red-800',
  REQUIRES_HUMAN_REVIEW: 'bg-amber-100 text-amber-800',
  RUNNING: 'bg-slate-100 text-slate-700',
  PENDING: 'bg-slate-100 text-slate-700',
};

export default function ReviewsAdmin() {
  const [filter, setFilter] = useState('BLOCKED');
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // {review, findings}
  const [waiveReason, setWaiveReason] = useState('');

  const load = () => { setLoading(true); adminListReviews(filter === 'ALL' ? {} : { status: filter }).then((r) => setReviews(r.reviews || [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, [filter]);

  const open = async (rev) => { try { const g = await getReview(rev.id); setActive({ review: g.review, findings: g.findings || [] }); } catch {} };
  const act = async (f, action) => {
    const fn = action === 'waive' ? waiveReviewFinding : dismissReviewFinding;
    await fn(f.id, waiveReason || (action === 'waive' ? 'operator review' : 'not applicable'));
    setWaiveReason('');
    if (active) { const g = await getReview(active.review.id); setActive({ review: g.review, findings: g.findings || [] }); }
    load();
  };

  return (
    <div>
      <PageHeader eyebrow="Operations" title="Review Console" subtitle="Operator QA queue for application reviews." />
      <div className="px-5 py-6 sm:px-8 lg:px-10">
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === f ? 'bg-orange-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{f.replace(/_/g, ' ').toLowerCase()}</button>)}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : reviews.length === 0 ? <p className="text-sm text-slate-400">No reviews in this view.</p> :
            reviews.map((r) => (
              <button key={r.id} onClick={() => open(r)} className={`block w-full rounded-xl border p-3 text-left ${active?.review?.id === r.id ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">{r.application_id?.slice(-6).toUpperCase()}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[r.status] || STATUS_CHIP.PENDING}`}>{r.status.replace(/_/g, ' ').toLowerCase()}</span>
                </div>
                <p className="text-xs text-slate-500">{r.blocking_count} blockers · {r.warning_count} warnings · {r.finding_count} findings</p>
                <p className="text-[11px] text-slate-400">{new Date(r.created_date).toLocaleString()}</p>
              </button>
            ))}
        </div>

        <div className="lg:col-span-2 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
          {!active ? <p className="text-sm text-slate-400">Select a review to inspect findings.</p> : (
            <>
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-semibold text-slate-900">Review {active.review.review_version} · {active.review.application?.destination} {active.review.application?.purpose}</p>
                  <p className="text-xs text-slate-500">Requirements {active.review.requirements_version || '—'} · Rules {active.review.rule_version} · Engine {active.review.review_engine_version}</p></div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[active.review.status]}`}>{active.review.status.replace(/_/g, ' ').toLowerCase()}</span>
              </div>
              <div className="mt-3 max-h-[420px] space-y-2 overflow-auto">
                {active.findings.length === 0 && <p className="text-sm text-slate-400">No findings recorded.</p>}
                {active.findings.map((f) => (
                  <div key={f.id} className={`rounded-xl border p-3 ${f.severity === 'BLOCKING' || f.severity === 'CRITICAL' ? 'border-red-200 bg-red-50' : f.severity === 'WARNING' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">{f.title}{f.ai_generated && <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">AI</span>}</p>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${f.status === 'OPEN' ? 'bg-slate-200 text-slate-700' : 'bg-orange-100 text-orange-700'}`}>{f.status.toLowerCase()}</span>
                    </div>
                    <p className="text-sm text-slate-600">{f.description}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{f.source} · {f.code} · {f.field_path || '—'}</p>
                    {f.status === 'OPEN' && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="Reason" className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                        <button onClick={() => act(f, 'waive')} className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white">Waive</button>
                        <button onClick={() => act(f, 'dismiss')} className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-semibold text-white">Dismiss</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-400"><ShieldCheck size={13} /> AI findings are advisory only and never block submission; waivers are admin-only and audited.</p>
      </div>
    </div>
  );
}