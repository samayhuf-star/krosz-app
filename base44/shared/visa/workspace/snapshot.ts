// Worldz Visa (Phase 16) — Application Rule Snapshot.
//
// When a traveler starts an application we capture an IMMUTABLE snapshot of the
// visa context that governed eligibility at that moment: the synthesized visa
// option, the visa-type metadata (stay/validity/processing/authority), the
// active requirements version (with effective window + verification), and the
// active fee version. The VisaApplication pins requirements_version /
// question_version already (Phase 6/13); Phase 16 adds visa_rule_version,
// fee_version, and the full rule_snapshot object so that if visa rules change
// tomorrow an in-flight application is NOT silently altered (§3).
//
// This module is intentionally self-contained and side-effect-free except for
// reads. It never mutates the catalog. Best-effort: a missing price/type does
// not fail application creation — the snapshot is enriched with whatever is
// resolvable and the application still pins its version labels.

import { resolveProduct, resolveActivePrice } from "../payments/engine.ts";

export interface RuleSnapshotInput {
  destination: string;
  purpose: string;
  nationality: string;
  route: any; // resolved VisaRoute (carries visa_type_key, channel, requirements_version, appointment_required)
}

export interface RuleSnapshot {
  captured_at: string;
  destination: string;
  nationality: string;
  purpose: string;
  visa_option: {
    visa_type_key: string;
    name: string;
    channel: string;
    category?: string;
    entry_type?: string;
    entries?: number;
    max_stay_days?: number;
    validity_days?: number;
    typical_duration_days?: number;
    processing_min_days?: number;
    processing_max_days?: number;
    expedited_processing_days?: number;
    application_method?: string;
    authority?: string;
    appointment_required: boolean;
  };
  requirements_version: string;
  visa_rule_version: string;
  fee_version: string | null;
  effective_from?: string;
  effective_until?: string;
  last_verified_at?: string;
  verified_by?: string;
  verification_status?: string;
  source_id?: string;
  confidence?: number;
}

export async function buildRuleSnapshot(svc: any, input: RuleSnapshotInput): Promise<{
  rule_snapshot: RuleSnapshot;
  visa_rule_version: string;
  fee_version: string | null;
}> {
  const route = input.route || {};
  const visaTypeKey = route.visa_type_key;
  const requirementsVersion = route.requirements_version;

  // Visa type metadata (stay / validity / processing / authority).
  let vt: any = null;
  if (visaTypeKey) {
    const rows: any[] = await svc.entities.VisaType.filter({ visa_type_key: visaTypeKey, status: "active" }).catch(() => []);
    vt = rows[0] || null;
  }

  // Active requirements version (effective window + verification provenance).
  let version: any = null;
  if (requirementsVersion) {
    const vrows: any[] = await svc.entities.VisaRequirementsVersion.filter({ requirements_version: requirementsVersion, status: "active" }).catch(() => []);
    version = vrows[0] || null;
  }

  // Active fee version (best-effort: some dev routes have no product yet).
  let feeVersion: string | null = null;
  try {
    const product = await resolveProduct(svc, { destination: input.destination, visa_type_key: visaTypeKey, purpose: input.purpose });
    const price = await resolveActivePrice(svc, product);
    feeVersion = price?.version || null;
  } catch { feeVersion = null; }

  const visaOption: any = {
    visa_type_key: visaTypeKey,
    name: vt?.name || `${input.destination} ${input.purpose}`,
    channel: route.channel || vt?.channel || "evisa",
    category: vt?.category,
    entry_type: vt?.entry_type,
    entries: vt?.entries,
    max_stay_days: vt?.max_stay_days ?? vt?.typical_duration_days,
    validity_days: vt?.validity_days,
    typical_duration_days: vt?.typical_duration_days,
    processing_min_days: vt?.processing_min_days,
    processing_max_days: vt?.processing_max_days,
    expedited_processing_days: vt?.expedited_processing_days,
    application_method: vt?.application_method,
    authority: vt?.authority,
    appointment_required: !!route.appointment_required,
  };

  const rule_snapshot: RuleSnapshot = {
    captured_at: new Date().toISOString(),
    destination: String(input.destination || "").toUpperCase(),
    nationality: String(input.nationality || "").toUpperCase(),
    purpose: String(input.purpose || "tourism").toLowerCase(),
    visa_option: visaOption,
    requirements_version: requirementsVersion || "",
    visa_rule_version: requirementsVersion || "",
    fee_version: feeVersion,
    effective_from: version?.effective_from || undefined,
    effective_until: version?.effective_until || undefined,
    last_verified_at: version?.last_verified_at || undefined,
    verified_by: version?.verified_by || undefined,
    verification_status: version?.verification_status || undefined,
    source_id: version?.source_id || undefined,
    confidence: version?.metadata?.confidence,
  };

  return { rule_snapshot, visa_rule_version: rule_snapshot.visa_rule_version, fee_version: feeVersion };
}