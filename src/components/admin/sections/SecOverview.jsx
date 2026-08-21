import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function SecOverview({ d }) {
  const cv = d.case_view;
  const snap = cv.snapshot || {};
  const drift = d.snapshot_drift;
  const q = d.quality_signals;
  const sla = d.sla;
  return (
    <div className="space-y-4">
      <Card title="Journey snapshot" desc="Snapshot at case creation — never silently mutated.">
        <Grid>
          <KV label="Destination" value={snap.country} />
          <KV label="Journey" value={snap.journey} />
          <KV label="Nationality" value={snap.nationality} />
          <KV label="Eligibility" value={d.case.eligibility_outcome} />
          <KV label="Execution capability" value={snap.execution_capability} />
          <KV label="Verification" value={snap.verification_status} />
          <KV label="Confidence" value={snap.confidence} />
          <KV label="Resolved at" value={snap.resolved_at ? new Date(snap.resolved_at).toLocaleString() : '—'} />
          <KV label="Data version" value={d.case.data_version} />
          <KV label="Snapshot hash" value={snap.snapshot_hash} mono />
        </Grid>
      </Card>

      <Card title="Current catalog" desc="Live Travel Entry Engine data — separated from the case snapshot.">
        {d.current_catalog ? <Grid>
          <KV label="Journey" value={d.current_catalog.journey} />
          <KV label="Verification" value={d.current_catalog.verification_status} />
          <KV label="Execution" value={d.current_catalog.execution_capability} />
          <KV label="Government fee" value={d.current_catalog.fee?.government_minor ?? '—'} />
        </Grid> : <p className="text-sm text-slate-400">No current capability row found.</p>}
        {drift?.differs && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle size={14} className="mr-1.5 inline" /> Journey data has changed since this case was created. Fields: {drift.changed_fields.join(', ')}.</div>}
      </Card>

      <Card title="Quality signals" desc="Deterministic — not AI-generated.">
        {q.level === 'ok' ? <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={14} /> No active warnings.</p>
          : <ul className="space-y-1">{q.messages.map((m, i) => <li key={i} className={q.level === 'alert' ? 'text-rose-700' : 'text-amber-700'}>{m}</li>)}</ul>}
      </Card>

      <Card title="SLA (operational expectation)" desc="Not a government guarantee.">
        <Grid>
          <KV label="Age (days)" value={sla.age_days} />
          <KV label="Expected (days)" value={sla.expected_days} />
          <KV label="SLA risk" value={sla.sla_risk} />
          <KV label="Overdue" value={sla.overdue ? 'Yes — processing time exceeded the configured operational expectation.' : 'No'} />
        </Grid>
      </Card>
    </div>
  );
}

function Card({ title, desc, children }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{desc && <p className="mb-3 text-xs text-slate-500">{desc}</p>}<div className={desc ? '' : 'mt-3'}>{children}</div></div>;
}
function Grid({ children }) { return <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">{children}</div>; }
function KV({ label, value, mono = false }) { return <div><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p><p className={`text-sm text-slate-800 ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{String(value ?? '—')}</p></div>; }