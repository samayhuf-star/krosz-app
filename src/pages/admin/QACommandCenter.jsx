import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, Download, Loader2, Play, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { qaLatest, qaRun, qaExportLatest } from '@/lib/qaApi';

const tone = {
  PASS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WARN: 'bg-amber-50 text-amber-700 border-amber-200',
  FAIL: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function QACommandCenter() {
  const qc = useQueryClient();
  const [mode, setMode] = useState('LIGHT');
  const latest = useQuery({ queryKey: ['qa-latest'], queryFn: qaLatest, refetchInterval: 60_000 });
  const run = useMutation({
    mutationFn: () => qaRun(mode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qa-latest'] }),
  });
  const report = latest.data?.report || run.data?.report || null;

  const download = async () => {
    const res = await qaExportLatest();
    if (!res?.report) return;
    const blob = new Blob([JSON.stringify(res.report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `krosz-qa-${res.report.run_id || 'latest'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Autonomous QA · PROMIN"
        title="QA Command Center"
        description="One consolidated source of truth for continuous Krosz application health. Hourly checks stay deterministic and low-cost; deeper regression is reserved for failures and deployments."
        action={<div className="flex flex-wrap gap-2">
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="LIGHT">Light</option><option value="REGRESSION">Regression</option><option value="FULL">Full</option>
          </select>
          <button onClick={() => run.mutate()} disabled={run.isPending} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">
            {run.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run QA
          </button>
          <button onClick={download} disabled={!report} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 disabled:opacity-40"><Download size={15} /> Export one file</button>
        </div>}
      />

      <div className="px-5 py-6 sm:px-8 lg:px-10">
        {!report && !latest.isLoading && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">No QA report yet. Run the first lightweight certification.</div>}
        {latest.isLoading && <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>}
        {report && <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card label="Health" value={`${report.health_score ?? 0}%`} icon={Activity} />
            <Card label="Passed" value={report.summary?.passed ?? 0} icon={CheckCircle2} />
            <Card label="Warnings" value={report.summary?.warnings ?? 0} icon={AlertTriangle} />
            <Card label="Failed" value={report.summary?.failed ?? 0} icon={ShieldCheck} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className={`rounded-full border px-2.5 py-1 font-semibold ${tone[report.status] || tone.WARN}`}>{report.status}</span>
            <span>Run {report.run_id}</span>
            <span>Generated {report.generated_at ? new Date(report.generated_at).toLocaleString() : '—'}</span>
            <span>Mode {report.mode}</span>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">Checks</h2></div>
            <div className="divide-y divide-slate-100">
              {(report.checks || []).map((c) => <div key={c.id} className="grid gap-2 px-5 py-3 md:grid-cols-[120px_180px_1fr] md:items-center">
                <span className={`w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone[c.status] || tone.WARN}`}>{c.status}</span>
                <span className="text-xs font-medium text-slate-500">{c.area}</span>
                <div><p className="text-sm text-slate-800">{c.message}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{c.id}</p></div>
              </div>)}
            </div>
          </div>

          {!!report.root_causes?.length && <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
            <h2 className="font-semibold text-slate-900">Root-cause queue</h2>
            <div className="mt-3 space-y-2">{report.root_causes.map((r, i) => <div key={`${r.check_id}-${i}`} className="rounded-xl bg-white p-3 text-sm text-slate-700"><span className="font-medium">{r.area}</span> — {r.cause}</div>)}</div>
          </div>}
        </>}
      </div>
    </div>
  );
}

function Card({ label, value, icon: Icon }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span><Icon size={18} className="text-orange-600" /></div><p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p></div>;
}
