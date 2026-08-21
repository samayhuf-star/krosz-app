// Worldz Visa (Phase 23 §29) — Provider detail sheet.
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Globe, Radio } from 'lucide-react';
import { ABILITY_TONE, LIFECYCLE_TONE, TRI, Chip } from './matrixShared';

export default function ProviderDetailDrawer({ provider, onClose }) {
  const open = !!provider;
  const r = provider || {};
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{r.display_name || r.name}</SheetTitle>
          <SheetDescription>Provider capability, MCP, commercial access, and India coverage.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Provider type" value={r.provider_type} />
            <Field label="Key" value={r.key} mono />
            <Field label="Status" value={<Chip value={r.status} items={STATUS_TONE_LOCAL} />} />
            <Field label="Lifecycle" value={<Chip value={r.provider_lifecycle || 'DISCOVERED'} items={LIFECYCLE_TONE} />} />
            <Field label="Health" value={r.health_status} />
            <Field label="Commercial" value={r.commercial_model} />
            <Field label="India coverage" value={`${r.india_coverage_score ?? 0}/100`} />
            <Field label="Sandbox" value={<Chip value={r.sandbox_available} items={TRI} />} />
            <Field label="Production" value={<Chip value={r.production_available} items={TRI} />} />
            <Field label="Our API access" value={<Chip value={r.our_api_access || 'NO'} items={TRI} />} />
            <Field label="Our commercial auth" value={<Chip value={r.our_commercial_authorized || 'NO'} items={TRI} />} />
            <Field label="Webhook" value={<Chip value={r.webhook_support} items={TRI} />} />
            <Field label="Evaluation" value={`${r.evaluation_score ?? 0}/100 · internal`} />
            <Field label="MCP" value={<Chip value={r.mcp_available ? 'YES' : 'NO'} items={ABILITY_TONE} />} />
          </div>

          <Section title="Capability verification (per-capability, never inferred)">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(r.capability_verification || {}).map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                  <span className="text-slate-400">{k}</span> <Chip value={v} items={{ UNVERIFIED: 'bg-slate-50 text-slate-500 border-slate-200', VERIFIED: 'bg-orange-50 text-orange-700 border-orange-200', REJECTED: 'bg-rose-50 text-rose-700 border-rose-200' }} />
                </span>
              ))}
              {!Object.keys(r.capability_verification || {}).length && <span className="text-xs text-slate-400">No capability verification recorded.</span>}
            </div>
            {r.verification_notes && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{r.verification_notes}</p>}
          </Section>
          {r.description && <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">{r.description}</p>}
          {r.mcp_available && (
            <Section title="MCP">
              <Field label="Endpoint" value={r.mcp_endpoint} mono />
              <Field label="Auth" value={r.mcp_auth} />
              <Field label="Read-only" value={r.mcp_read_only ? 'Yes' : 'No'} />
              <div className="mt-1 flex flex-wrap gap-1">{(r.mcp_tools || []).map((t) => <span key={t} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-700">{t}</span>)}</div>
            </Section>
          )}
          {r.documentation_url || r.website ? (
            <Section title="Links">
              {r.website && <a href={r.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-orange-700"><Globe size={12} /> {r.website}</a>}
              {r.documentation_url && <a href={r.documentation_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-orange-700"><Radio size={12} /> API docs</a>}
            </Section>
          ) : null}
          <Section title="Commercial terms (recorded, not guaranteed)">
            {r.per_application_cost_minor != null && <Field label="Per application" value={`${r.per_application_cost_minor / 100} ${r.per_application_cost_currency || ''}`} />}
            {r.api_subscription_minor != null && <Field label="Subscription" value={`${r.api_subscription_minor / 100} ${r.api_subscription_currency || ''}`} />}
            {r.min_volume != null && <Field label="Min volume" value={r.min_volume} />}
            {r.setup_fee_minor != null && <Field label="Setup fee" value={`${r.setup_fee_minor / 100} ${r.transaction_fee_currency || ''}`} />}
            {!r.per_application_cost_minor && !r.api_subscription_minor && <p className="text-xs text-slate-400">No commercial terms recorded.</p>}
          </Section>
          <p className="text-[11px] text-slate-400">Internal evaluation only — never exposed to travelers. Verified at: {r.verified_at ? new Date(r.verified_at).toLocaleDateString() : 'not verified'}.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
const STATUS_TONE_LOCAL = { connected: 'bg-orange-50 text-orange-700 border-orange-200', verified: 'bg-blue-50 text-blue-700 border-blue-200', researching: 'bg-slate-50 text-slate-500 border-slate-200', not_configured: 'bg-slate-50 text-slate-400 border-slate-200' };
function Field({ label, value, mono = false }) {
  return <div><p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p><div className={`mt-0.5 text-sm text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div></div>;
}
function Section({ title, children }) { return <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>{children}</div>; }