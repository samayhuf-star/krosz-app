import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Check, Pencil, ShieldCheck, Loader2 } from 'lucide-react';

// Friendly "Review & approve" card for the engine's current approval gate.
// For the blueprint gate we surface the AI-generated blueprint itself so the
// customer reviews real content (industry, audience, services, site structure),
// not a generic prompt. The Approve action drives the real engine gate; "Make
// changes" routes to the relevant editor rather than hard-skipping the plan.
export default function LaunchReviewGate({ gate, run, businessId, busy, onApprove }) {
  const navigate = useNavigate();
  const isBlueprint = gate.task_key === 'blueprint_approval';

  const blueprintQ = useQuery({
    queryKey: ['launch', 'blueprint-draft', businessId],
    queryFn: async () => {
      const rows = await base44.entities.BusinessBlueprint.filter({ business_id: businessId }).catch(() => []);
      const drafts = (rows || []).filter((r) => r.status === 'draft' || r.status === 'approved').sort((a, b) => (b.version || 0) - (a.version || 0));
      return drafts[0] || null;
    },
    enabled: isBlueprint,
    staleTime: 5000,
  });

  const bp = blueprintQ.data?.blueprint || {};
  const services = (bp.services_products || []).slice(0, 6);
  const pages = (bp.website_structure || bp.suggested_website_structure || []).slice(0, 6);

  return (
    <div className="rounded-3xl border border-amber-200 bg-gradient-to-b from-amber-50/70 to-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><ShieldCheck size={20} /></span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">Needs your approval to continue</p>
          <h3 className="text-lg font-semibold text-slate-900">{isBlueprint ? 'Review your business blueprint' : 'Review & continue'}</h3>
        </div>
      </div>

      {isBlueprint && (
        <div className="mt-5">
          {blueprintQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> Drafting your blueprint…</div>
          ) : blueprintQ.data ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
              <Row label="Business" value={bp.business_name || bp.name || '—'} />
              <Row label="Industry" value={bp.industry || '—'} />
              <Row label="Target customers" value={bp.target_customers || bp.audience || '—'} />
              {services.length > 0 && <Row label="Offerings" value={services.join(', ')} />}
              <Row label="Positioning" value={bp.value_proposition || bp.description || '—'} />
              {pages.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Planned website pages</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {pages.map((p) => (
                      <span key={typeof p === 'string' ? p : p.title} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{typeof p === 'string' ? p : p.title}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Finalizing your blueprint — one moment.</p>
          )}
        </div>
      )}

      {!isBlueprint && (
        <p className="mt-3 text-sm text-slate-600">Your workflow reached a checkpoint. Approve to let me keep building for you.</p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => onApprove(gate)} disabled={busy} className="bg-emerald-700 hover:bg-emerald-800">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {isBlueprint ? 'Approve & launch' : 'Approve & continue'}
        </Button>
        <Button variant="outline" onClick={() => navigate(isBlueprint ? '/blueprint' : '/workflows')} className="text-slate-600">
          <Pencil size={14} /> Make changes
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 flex-none text-[11px] font-medium uppercase tracking-wide text-slate-400 pt-0.5">{label}</span>
      <span className="flex-1 text-slate-700">{value}</span>
    </div>
  );
}