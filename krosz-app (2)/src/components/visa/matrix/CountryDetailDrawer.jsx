// Worldz Visa (Phase 23 §30) — Country detail sheet for the capability matrix.
import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Loader2 } from 'lucide-react';
import { adminEntryDetail } from '@/lib/visaApi';
import { STATUS_TONE, ABILITY_TONE, AV_TONE, JOURNEY_LABEL, AUTOMATION_LABEL, CLASS_LABEL, VERIF_TONE, EXEC_LABEL, VCLASS_LABEL, EV_STATUS_TONE, Chip } from './matrixShared';

export default function CountryDetailDrawer({ country, onClose }) {
  const open = !!country;
  const { data, isLoading } = useQuery({
    queryKey: ['admin-entry-detail', country?.country_code],
    queryFn: () => adminEntryDetail({ destination: country.country_code, nationality: 'IN', departure_country: 'IN', purpose: 'tourism' }),
    enabled: !!country,
  });
  const cap = data?.capability;
  const comp = data?.provider_composition || {};
  const fb = data?.fallback_strategy || {};
  const reqs = cap?.document_requirements || {};
  const rows = data?.bindings || [];
  const abil = (v) => <Chip value={v} items={ABILITY_TONE} />;
  const vsum = data?.verification_summary || {};
  const evidence = data?.evidence || [];
  const tasks = data?.research_tasks || [];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{country?.country_code} — capability detail</SheetTitle>
          <SheetDescription>Provider composition, fallback, requirements, and research state for this destination.</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="py-20 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div> : cap ? (
          <div className="space-y-5 text-sm">
            {/* Phase 24 verification summary */}
            <div className="rounded-xl border border-orange-100 bg-orange-50/40 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-800">Verification summary</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Info label="Verification" value={<Chip value={vsum.verification_status} items={VERIF_TONE} />} />
                <Info label="Class" value={VCLASS_LABEL[vsum.verification_class] || vsum.verification_class || '—'} />
                <Info label="Verification score" value={`${vsum.verification_score ?? 0}/100 · internal`} />
                <Info label="Execution capability" value={EXEC_LABEL[vsum.execution_capability] || vsum.execution_capability || '—'} />
                <Info label="Evidence completeness" value={`${vsum.evidence_completeness ?? 0}%`} />
                <Info label="Change risk" value={vsum.change_risk || '—'} />
                <Info label="Sources" value={`${vsum.source_count ?? 0} (${vsum.official_source_count ?? 0} official)`} />
                <Info label="Second source" value={vsum.has_second_source ? 'Yes' : (vsum.has_override ? 'Override' : 'No')} />
                <Info label="Last verified" value={vsum.last_verified_at ? new Date(vsum.last_verified_at).toLocaleDateString() : 'not verified'} />
                <Info label="Next review" value={vsum.next_review_at ? new Date(vsum.next_review_at).toLocaleDateString() : '—'} />
              </div>
            </div>

            <Section title="Evidence (claim-level provenance)">
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                    <tr><th className="p-2">Claim</th><th className="p-2">Source type</th><th className="p-2">Source</th><th className="p-2">Status</th><th className="p-2">Confidence</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {evidence.map((e) => (
                      <tr key={e.id}>
                        <td className="p-2 font-mono text-[11px] text-slate-700">{e.claim_type}</td>
                        <td className="p-2 text-slate-600">{e.source_type}</td>
                        <td className="p-2 max-w-[180px] truncate text-slate-600">{e.source_name}{e.source_url ? ` · ${e.source_url}` : ''}</td>
                        <td className="p-2"><Chip value={e.verification_status} items={EV_STATUS_TONE} /></td>
                        <td className="p-2 text-slate-600">{e.confidence || '—'}</td>
                      </tr>
                    ))}
                    {!evidence.length && <tr><td colSpan={5} className="p-3 text-center text-slate-400">No evidence recorded — attach evidence + verify to reach VERIFIED.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">A destination reaches VERIFIED only via evidence satisfying the two-source rule (official source + second source or recorded admin override). Commercial sources never override government truth.</p>
            </Section>

            <Section title="Research tasks">
              <div className="space-y-1.5">
                {tasks.map((t) => (
                  <div key={t.id} className="rounded-lg border border-slate-100 px-2.5 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-slate-700">{t.claim_type}</span>
                      <Chip value={t.status} items={STATUS_TONE} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      Priority {t.priority} · {t.assigned_to ? `assigned ${t.assigned_to}` : 'unassigned'} · evidence {(t.evidence_ids || []).length}
                    </div>
                    {t.notes && <p className="mt-0.5 text-[11px] text-slate-400">{t.notes}</p>}
                  </div>
                ))}
                {!tasks.length && <p className="text-xs text-slate-400">No research tasks for this destination.</p>}
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-2">
              <Info label="Journey" value={JOURNEY_LABEL[cap.journey_type] || cap.journey_type} />
              <Info label="Visa required" value={cap.visa_required ? 'Yes' : 'No'} />
              <Info label="Max stay" value={cap.max_stay_days != null ? `${cap.max_stay_days} days` : '—'} />
              <Info label="Application" value={cap.application_required} />
              <Info label="Official portal" value={cap.official_portal_url ? 'Yes' : 'No'} sub={cap.official_portal_url} />
              <Info label="Automation" value={AUTOMATION_LABEL[cap.automation_level] || cap.automation_level} />
              <Info label="API" value={<Chip value={cap.api_available} items={AV_TONE} />} />
              <Info label="MCP" value={<Chip value={cap.mcp_available} items={AV_TONE} />} />
              <Info label="Submission" value={cap.submission_capability} />
              <Info label="Tracking" value={cap.tracking_capability} />
              <Info label="Appointment" value={cap.appointment_requirement} />
              <Info label="Confidence" value={<Chip value={cap.data_confidence} items={STATUS_TONE} />} />
              <Info label="Classification" value={CLASS_LABEL[cap.final_classification] || cap.final_classification} />
              <Info label="Automation score" value={`${data?.automation_score ?? 0}/100 · internal`} />
              <Info label="Rule version" value={`v${cap.rule_version || 1}`} />
              <Info label="Research status" value={<Chip value={cap.research_status} items={STATUS_TONE} />} />
            </div>

            <Section title="Provider composition (§24/§25)">
              <div className="space-y-1.5">
                {['source', 'application', 'submission', 'tracking', 'operations'].map((r) => (
                  <div key={r} className="flex items-center justify-between rounded-lg border border-slate-100 px-2.5 py-1.5">
                    <span className="text-xs font-medium uppercase text-slate-500">{r}</span>
                    <span className="font-mono text-xs text-slate-800">{comp[r] || '—'}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Fallback strategy (§33)">
              <div className="space-y-1">
                <KeyValue k="Primary" v={fb.primary || '—'} />
                <KeyValue k="Fallback" v={fb.fallback || '—'} />
                <KeyValue k="Last resort" v={fb.last_resort || '—'} />
                {fb.notes && <p className="text-xs text-amber-600">{fb.notes}</p>}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">We never report fake success when all providers fail.</p>
            </Section>

            <Section title="Verified provider capabilities (this destination)">
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                    <tr><th className="p-2">Provider</th><th className="p-2">Role</th>{['req','elig','app','prefill','sub','track','notif'].map(h => <th key={h} className="p-2 text-center">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((b) => (
                      <tr key={b.id}>
                        <td className="p-2 font-mono text-[11px] text-slate-800">{b.provider_key}</td>
                        <td className="p-2 text-slate-500">{b.role}</td>
                        {["requirements","eligibility","application","prefill","submission","tracking","notifications"].map(c => <td key={c} className="p-2 text-center">{abil(b.capability?.[c])}</td>)}
                      </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={9} className="p-3 text-center text-slate-400">No bindings — run seed pipeline.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Document requirements">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(reqs).filter(([,v]) => v).map(([k]) => (
                  <span key={k} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{k.replace(/_/g, ' ')}</span>
                ))}
                {!Object.values(reqs).some(Boolean) && <span className="text-xs text-slate-400">No verified document requirements recorded.</span>}
              </div>
            </Section>

            <Section title="Sources">
              <KeyValue k="Primary" v={`${cap.source_name || '—'} ${cap.source_url ? `· ${cap.source_url}` : ''}`} />
              <KeyValue k="Secondary" v={cap.secondary_source_name ? `${cap.secondary_source_name} ${cap.secondary_source_url ? `· ${cap.secondary_source_url}` : ''}` : '—'} />
              <KeyValue k="Verified at" v={cap.verified_at ? new Date(cap.verified_at).toLocaleString() : 'not verified'} />
            </Section>
          </div>
        ) : <p className="py-10 text-center text-slate-400">No configuration for this destination yet.</p>}
      </SheetContent>
    </Sheet>
  );
}

function Info({ label, value, sub = '' }) {
  return (
    <div className="rounded-lg border border-slate-100 px-2.5 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{value}</div>
      {sub && <a href={sub} target="_blank" rel="noreferrer" className="block max-w-[200px] truncate text-[11px] text-orange-700">{sub}</a>}
    </div>
  );
}
function Section({ title, children }) {
  return <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>{children}</div>;
}
function KeyValue({ k, v }) {
  return <div className="flex justify-between gap-3 text-xs"><span className="text-slate-500">{k}</span><span className="text-right text-slate-800">{v}</span></div>;
}