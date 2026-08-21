import { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { listReviews, runReview } from '@/lib/visaApi';

const STATUS_TONE = {
  PASSED: { wrap: 'border-orange-200 bg-orange-50', chip: 'bg-orange-100 text-orange-800', icon: CheckCircle2 },
  WARNINGS: { wrap: 'border-amber-200 bg-amber-50', chip: 'bg-amber-100 text-amber-800', icon: ShieldAlert },
  BLOCKED: { wrap: 'border-red-200 bg-red-50', chip: 'bg-red-100 text-red-800', icon: ShieldAlert },
  REQUIRES_HUMAN_REVIEW: { wrap: 'border-amber-200 bg-amber-50', chip: 'bg-amber-100 text-amber-800', icon: ShieldAlert },
  RUNNING: { wrap: 'border-slate-200 bg-slate-50', chip: 'bg-slate-100 text-slate-700', icon: RefreshCw },
  PENDING: { wrap: 'border-slate-200 bg-slate-50', chip: 'bg-slate-100 text-slate-700', icon: RefreshCw },
};

export default function ReviewCard({ applicationId, showFindings = true }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [error, setError] = useState('');

  const load = () => listReviews(applicationId).then((r) => setReviews(r.reviews || [])).catch((e) => setError(e?.message || '')).finally(() => setLoading(false));
  useEffect(() => { load(); }, [applicationId]);

  const run = async () => { setRunning(true); setError(''); try { await runReview(applicationId, { trigger: 'MANUAL_REVIEW', ai: false }); await load(); } catch (e) { setError(e?.message || 'Review failed'); } finally { setRunning(false); } };

  const latest = reviews[0];
  const blockers = latest ? (latest.blocking_count || 0) : 0;
  const warnings = latest ? (latest.warning_count || 0) : 0;
  const critical = latest ? (latest.critical_count || 0) : 0;
  const tone = latest ? (STATUS_TONE[latest.status] || STATUS_TONE.PENDING) : STATUS_TONE.PENDING;
  const Icon = tone.icon;

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tone.wrap}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={18} className={latest?.status === 'PASSED' ? 'text-orange-600' : latest?.status === 'BLOCKED' ? 'text-red-600' : 'text-amber-600'} />
          <p className="text-sm font-semibold text-slate-900">Application Review</p>
          {latest && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.chip}`}>{latest.status.replace(/_/g, ' ').toLowerCase()}</span>}
        </div>
        <button onClick={run} disabled={running} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={13} className={running ? 'animate-spin' : ''} /> {running ? 'Reviewing…' : 'Run review'}
        </button>
      </div>

      {!latest && !loading && <p className="mt-3 text-sm text-slate-500">No review yet. Run a review to check your application is consistent and ready to submit.</p>}
      {latest && (
        <>
          <div className="mt-3 flex items-center gap-4 text-xs">
            <span className="text-slate-600">Quality <span className="font-semibold text-slate-900">{latest.quality_score ?? 100}/100</span></span>
            <span className="text-red-600">{blockers} blocker{blockers === 1 ? '' : 's'}</span>
            <span className="text-amber-600">{warnings} warning{warnings === 1 ? '' : 's'}</span>
            {critical > 0 && <span className="text-red-700">{critical} critical</span>}
          </div>
          {showFindings && <Findings applicationId={applicationId} showWarnings={showWarnings} setShowWarnings={setShowWarnings} />}
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Findings({ applicationId, showWarnings, setShowWarnings }) {
  const [findings, setFindings] = useState([]);
  useEffect(() => {
    if (!applicationId) return;
    import('@/lib/visaApi').then(({ getReview, listReviews }) =>
      listReviews(applicationId).then(async (r) => {
        const rev = (r.reviews || [])[0];
        if (!rev) return setFindings([]);
        const g = await getReview(rev.id);
        setFindings((g.findings || []).filter((f) => f.status === 'OPEN'));
      })
    );
  }, [applicationId, findings.length]);

  if (!findings.length) return <p className="mt-3 text-sm text-orange-700">✓ No open issues found.</p>;
  const blockers = findings.filter((f) => f.severity === 'BLOCKING' || f.severity === 'CRITICAL');
  const warnings = findings.filter((f) => f.severity === 'WARNING');
  return (
    <div className="mt-3 space-y-2">
      {blockers.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-white p-3">
          <p className="text-xs font-semibold text-red-700">{blockers.length} issue{blockers.length === 1 ? '' : 's'} need{blockers.length === 1 ? 's' : ''} attention</p>
          <ul className="mt-1 space-y-1">{blockers.map((f) => <li key={f.id} className="text-sm text-slate-700">{f.description}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white p-3">
          <button onClick={() => setShowWarnings(!showWarnings)} className="flex w-full items-center justify-between text-xs font-semibold text-amber-700">
            <span>{warnings.length} warning{warnings.length === 1 ? '' : 's'} to review</span>{showWarnings ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {showWarnings && <ul className="mt-1 space-y-1">{warnings.map((f) => <li key={f.id} className="text-sm text-slate-600">{f.description}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}