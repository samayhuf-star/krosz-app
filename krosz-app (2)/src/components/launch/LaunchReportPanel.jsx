import { FileText, Loader2, RefreshCw, CheckCircle2, Activity, Lightbulb } from 'lucide-react';
import { useState } from 'react';

export default function LaunchReportPanel({ plan, onCompile, onRegenerate }) {
  const [busy, setBusy] = useState(false);
  const report = plan.result_summary;
  const compile = async () => { setBusy(true); try { await onCompile(); } finally { setBusy(false); } };

  if (!report) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
      <FileText className="mx-auto mb-3 text-emerald-600" size={30} />
      <h3 className="text-lg font-semibold text-slate-900">Compile your Business Launch Report</h3>
      <p className="mx-auto mt-1 max-w-md text-slate-500">The assistant assembles your health scores, completion status, and recommendations into one executive summary.</p>
      <button onClick={compile} disabled={busy} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busy ? <><Loader2 size={15} className="animate-spin" /> Compiling…</> : <><RefreshCw size={15} /> Compile Report</>}</button>
    </div>;
  }
  const s = report.health.scores;
  const recs = report.recommendations || [];
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><FileText size={18} className="text-emerald-700" /><h2 className="text-lg font-semibold text-slate-900">Business Launch Report</h2></div>
          <span className="text-xs text-slate-400">Generated {new Date(report.generated_at).toLocaleString()}</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">Goal: <span className="font-medium text-slate-800">{report.goal}</span></p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2"><Activity size={16} className="text-emerald-700" /><span className="text-sm font-medium text-slate-700">Overall health</span><span className="text-lg font-bold text-emerald-700">{s.overall}</span></div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><CheckCircle2 size={16} className="text-emerald-600" /> {report.completed_steps}/{report.total_steps} steps completed</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(s).map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-400">{k.replace(/_/g, ' ')}</p><p className="text-lg font-bold text-slate-800">{v}</p></div>)}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Lightbulb size={16} className="text-amber-500" /><h3 className="font-semibold text-slate-900">Recommendations</h3></div>
          <button onClick={onRegenerate} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><RefreshCw size={13} /> Regenerate</button></div>
        {recs.length ? <ul className="space-y-2">{recs.map((r) => <li key={r.key} className="flex items-start gap-2 text-sm text-slate-600"><span className="font-semibold text-slate-800">{r.title}.</span> {r.rationale}</li>)}</ul> : <p className="text-sm text-slate-400">Sign off review to generate recommendations.</p>}
      </div>
    </div>
  );
}