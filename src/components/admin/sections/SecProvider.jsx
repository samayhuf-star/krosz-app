import { AlertTriangle, Info } from 'lucide-react';

export default function SecProvider({ d }) {
  const p = d.provider;
  const b = d.provider_binding;
  const cv = d.case_view;
  const ec = cv.execution_capability;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Execution capability</h3>
        <p className="mt-1 text-sm text-slate-700"><span className="font-semibold">{ec}</span> — {execReason(ec, b)}</p>
        <p className="mt-1 text-[11px] text-amber-700"><AlertTriangle size={12} className="mr-1 inline" /> Operations cannot promise a capability that does not exist. Execution capability is governed by the provider/execution system, not overridable here.</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Provider</h3>
        {p ? <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <KV label="Key" value={p.key} />
          <KV label="Name" value={p.name} />
          <KV label="Lifecycle" value={p.provider_lifecycle} />
          <KV label="Our API access" value={p.our_api_access} />
          <KV label="Commercial auth" value={p.our_commercial_authorized} />
          <KV label="Commercial model" value={p.commercial_model} />
          <KV label="Submission capability" value={p.capability_verification?.submission} />
          <KV label="Tracking capability" value={p.capability_verification?.tracking} />
        </div> : <p className="mt-2 text-sm text-slate-400">No provider routed for this case.</p>}
        <p className="mt-2 text-[11px] text-slate-400"><Info size={11} className="mr-1 inline" /> Provider credentials/secrets are never displayed.</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Provider status</h3>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <KV label="Provider application ID" value={d.case.provider_application_id || '—'} />
          <KV label="Raw provider status" value={(cv.events || []).filter(e => e.source === 'provider_webhook').slice(-1)[0]?.metadata?.raw || '—'} />
          <KV label="Normalized status" value={cv.normalized_status} />
          <KV label="Route status" value={cv.route_status || '—'} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Raw provider status is preserved for debugging and never replaced by the normalized value.</p>
      </div>
    </div>
  );
}
function execReason(ec, b) {
  if (ec === 'END_TO_END') return b?.provider_verified && b?.commercial_authorized ? 'Verified production provider + commercial authorization.' : 'Missing verified provider or commercial authorization.';
  if (ec === 'INTELLIGENCE_ONLY') return 'No verified production submission integration — intelligence only.';
  if (ec === 'GUIDANCE_ONLY') return 'Guidance only — submission happens on the official portal.';
  if (ec === 'PARTIAL_ASSIST') return 'Partial assist — requires review gate before submission.';
  return 'Resolved from the Travel Entry Engine snapshot.';
}
function KV({ label, value }) { return <div><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p><p className="text-sm font-medium text-slate-800">{String(value ?? '—')}</p></div>; }