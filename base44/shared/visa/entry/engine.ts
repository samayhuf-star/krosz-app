// Worldz Visa — Phase 22 Travel Entry Engine (India-first MVP).
// ONE engine over the existing Visa Intelligence domain + a CountryCapability
// matrix. Composes the Phase 15 discovery engine (checkEligibility) and the
// Phase 21 publish engine — it NEVER duplicates regulatory rules. It produces
// a single normalized TravelEntryResult the UI consumes without caring whether
// data came from Pipeworx, a government source, or internal research.
//
// MVP defaults: nationality=IN, departure_country=IN (NOT hard-coded across the
// codebase — only defaulted here and in the capability rows). Every fn accepts
// explicit nationality/departure so future expansion needs no engine change.

import { checkEligibility } from "../discovery/engine.ts";
import {
  computeExecutionCapability, publicVerificationProjection, travelerSupportMessage,
  buildVerificationSummary, listEvidenceFor, listResearchTasksFor, providersByKeyFor,
  staleDownstate, deriveChangeRisk, nextReviewDate,
} from "../verification/engine.ts";
import { isKroszMvpCountry, mvpPricingFor, LEGACY_CAPABILITY_ALIAS } from "../mvpPricing.ts";

export type JourneyType =
  | "VISA_FREE" | "VISA_ON_ARRIVAL" | "ETA" | "EVISA" | "OTHER_LOW_FRICTION"
  | "EMBASSY_VISA" | "CONSULAR_VISA" | "TRANSIT_VISA" | "WORK_VISA" | "STUDENT_VISA" | "OTHER";

export type PublishingState = "DRAFT" | "RESEARCHING" | "VERIFIED" | "PUBLISHED" | "NEEDS_REVIEW" | "SUSPENDED";
export type FreshnessState = "FRESH" | "STALE" | "REQUIRES_REVIEW" | "EXPIRED";
export type AutomationLevel = "FULLY_AUTOMATED" | "SEMI_AUTOMATED" | "GUIDED" | "MANUAL";

// Older CountryCapability seeds wrote whole currency units into a *_minor field
// and tagged them with this exact legacy note. New rows are stored correctly in
// minor units. Normalize only the exact legacy shape so freshly seeded values
// are never multiplied a second time.
export function normalizeGovernmentFeeMinor(raw: any, note?: string | null): number | null {
  if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return null;
  const legacyWholeUnits = String(note || '').trim() === 'Government fee reference — verify before payment';
  return Math.round(Number(raw) * (legacyWholeUnits ? 100 : 1));
}

// Customer pricing is controlled centrally by mvpPricing.ts. Regulatory source
// amounts may remain in native currency internally, but the India MVP surface is
// always projected in INR and only for the ten launch destinations.

export interface TravelEntryInput {
  nationality?: string;
  departure_country?: string;
  destination: string;
  purpose?: string;
  travel_dates?: { departure?: string; return?: string };
  traveler_attributes?: { is_minor?: boolean; entries?: number; passport_expiry?: string };
}

export interface ChecklistItem {
  code: string;
  label: string;
  kind: "required" | "optional" | "conditional" | "informational";
  applicable: boolean;
  reason?: string;
  document_code?: string;
  description?: string;
}

export interface TravelEntryResult {
  input: { nationality: string; departure_country: string; destination: string; purpose: string; travel_dates: any };
  destination: any;
  capability: any;
  journey_type: JourneyType | null;
  visa_required: boolean;
  max_stay_days: number | null;
  entries: number | null;
  conditions: { code: string; label: string; required: boolean }[];
  documents: { code: string; label: string; mandatory: boolean }[];
  fees: { government_minor?: number; service_minor?: number; total_minor?: number; currency?: string; notes?: string; original_government_minor?: number | null; original_currency?: string | null; benchmark_date?: string; benchmark_ratio?: number } | null;
  mvp_live: boolean;
  availability: "LIVE" | "COMING_SOON";
  application: {
    required: "NOT_REQUIRED" | "PREPARE_ONLY" | "REQUIRED";
    capability: { prepare: string; prefill: string; pay: string; submit: string; track: string };
    submission: string;
    tracking: string;
    automation: AutomationLevel | null;
    appointment_required: boolean;
    official_portal: string | null;
    manual_operations_required: boolean;
  };
  checklist: ChecklistItem[];
  options: any[];
  outcome: string;
  freshness: FreshnessState;
  rule_version: number | null;
  source: { name?: string; url?: string; type?: string; verified_at?: string; effective_at?: string; provider?: string } | null;
  ready_for_public: boolean;
  // Phase 23 public-facing additions (NEVER expose internal provider/commercial info).
  api: { available: string; mcp_available: string; mcp_read_only?: boolean };
  support_summary: string;
  // Phase 24 public-facing verification additions (§18) — safe summary fields only.
  verification_status: string;
  data_confidence: string;
  execution_capability: string;
}

export interface CapabilityDetail {
  capability: any;
  bindings: any[];
  providers: any[];
  provider_composition: any;
  fallback_strategy: any;
  automation_score: number;
  data_confidence: string;
  final_classification: string;
  research_status: string;
  // Phase 24 verification layer (admin-only — never in the public result).
  evidence: any[];
  research_tasks: any[];
  verification_summary: any;
}

// ---------- Pure helpers (no DB) — unit-tested by entry/contract.ts ----------

export function normalizeEntryInput(raw: TravelEntryInput): TravelEntryInput {
  return {
    nationality: String(raw?.nationality || "IN").toUpperCase(),
    departure_country: String(raw?.departure_country || "IN").toUpperCase(),
    destination: String(raw?.destination || "").toUpperCase(),
    purpose: String(raw?.purpose || "tourism").toLowerCase(),
    travel_dates: raw?.travel_dates || {},
    traveler_attributes: raw?.traveler_attributes || {},
  };
}

// Stay length in days from travel_dates, or null.
export function computeStayDays(travel_dates: any): number | null {
  const dep = travel_dates?.departure, ret = travel_dates?.return;
  if (!dep || !ret) return null;
  const a = new Date(dep), b = new Date(ret);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

// Freshness from verified_at + effective_at + status (§11).
// FRESH <90d, STALE 90-180d, EXPIRED >180d. REQUIRES_REVIEW/EXPIRED if rule not effective.
export function computeFreshness(cap: any, asOf: string): FreshnessState {
  if (!cap) return "REQUIRES_REVIEW";
  if (cap.status === "NEEDS_REVIEW" || cap.status === "SUSPENDED") return "REQUIRES_REVIEW";
  const today = asOf.slice(0, 10);
  if (cap.effective_at && today < cap.effective_at) return "REQUIRES_REVIEW";
  const v = cap.verified_at ? new Date(cap.verified_at) : null;
  if (!v || isNaN(v.getTime())) return "EXPIRED";
  const days = Math.floor((new Date(asOf).getTime() - v.getTime()) / 86400000);
  if (days < 90) return "FRESH";
  if (days < 180) return "STALE";
  return "EXPIRED";
}

// Build the travel checklist (§28/§29). Evaluates conditionals against context.
export function buildChecklist(cap: any, ctx: { stay_days?: number | null; is_minor?: boolean; entries?: number; passport_expiry?: string; asOf?: string }): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const items: any[] = Array.isArray(cap?.checklist) ? cap.checklist : [];
  for (const it of items) {
    const kind = (it.kind || "required") as ChecklistItem["kind"];
    let applicable = true;
    let reason: string | undefined;
    if (kind === "conditional") {
      const r = evalCondition(it, ctx);
      applicable = r.applicable;
      reason = r.reason;
    }
    out.push({
      code: String(it.code || ""),
      label: String(it.label || ""),
      kind,
      applicable,
      reason,
      document_code: it.document_code,
      description: it.description,
    });
  }
  // Always include core informational items if the config is empty.
  if (!out.length) {
    out.push({ code: "passport", label: "Valid passport (min 6 months validity)", kind: "required", applicable: true });
    out.push({ code: "return_ticket", label: "Return / onward ticket", kind: "informational", applicable: true });
  }
  return out;
}

function evalCondition(it: any, ctx: any): { applicable: boolean; reason?: string } {
  const t = String(it.condition_type || "");
  if (t === "stay_gt") {
    const stay = ctx?.stay_days ?? null;
    const thr = Number(it.threshold) || 0;
    if (stay == null) return { applicable: false, reason: "Stay duration not provided" };
    return stay > thr ? { applicable: true, reason: `Stay exceeds ${thr} days` } : { applicable: false };
  }
  if (t === "minors") {
    return ctx?.is_minor ? { applicable: true, reason: "Traveler is a minor" } : { applicable: false };
  }
  if (t === "multiple_entry") {
    return Number(ctx?.entries) === -1 || Number(ctx?.entries) > 1 ? { applicable: true, reason: "Multiple-entry visa" } : { applicable: false };
  }
  if (t === "passport_expiry_lt") {
    const exp = ctx?.passport_expiry;
    if (!exp) return { applicable: false, reason: "Passport expiry not provided" };
    const monthsLeft = Math.floor((new Date(exp).getTime() - new Date(ctx?.asOf || new Date().toISOString()).getTime()) / 2592000000);
    return monthsLeft < Number(it.threshold || 6) ? { applicable: true, reason: `Passport validity below ${it.threshold} months` } : { applicable: false };
  }
  return { applicable: true };
}

// Aggregate family readiness (§19/§20). Each traveler result contributes its
// own checklist total; the trip aggregates without merging identities.
export function aggregateFamilyReadiness(perTraveler: { traveler_id?: string; checklist: ChecklistItem[] }[]): {
  travelers: number; total_requirements: number; ready_requirements: number; readiness_pct: number;
} {
  let total = 0, ready = 0;
  for (const t of perTraveler || []) {
    for (const it of t.checklist || []) {
      if (!it.applicable) continue;
      total++;
      // required/informational items are "satisfied" structurally; the actual
      // fulfillment comes from the document vault per traveler elsewhere.
      if (it.kind === "required" || it.kind === "informational") ready++;
    }
  }
  return { travelers: (perTraveler || []).length, total_requirements: total, ready_requirements: ready, readiness_pct: total ? Math.round((ready / total) * 100) : 0 };
}

// Map a capability + discovery options to a checklist-friendly conditions list + documents.
export function buildConditions(cap: any): { code: string; label: string; required: boolean }[] {
  const out: { code: string; label: string; required: boolean }[] = [];
  if (!cap) return out;
  if (cap.passport_validity_min_months) out.push({ code: "passport_validity", label: `Passport valid for at least ${cap.passport_validity_min_months} months`, required: true });
  if (cap.return_ticket_required) out.push({ code: "return_ticket", label: "Return / onward ticket", required: true });
  if (cap.accommodation_required) out.push({ code: "accommodation", label: "Proof of accommodation", required: true });
  if (cap.proof_of_funds_required) out.push({ code: "funds", label: "Proof of sufficient funds", required: true });
  if (cap.max_stay_days && cap.max_stay_days > 0) out.push({ code: "max_stay", label: `Maximum stay ${cap.max_stay_days} days`, required: false });
  return out;
}

// ---------- Async engine (server-side) ----------

// Resolve the authoritative PUBLISHED capability for a destination. Falls back
// to NEEDS_REVIEW/RESEARCHING rows so the UI can show a research state, but
// never returns SUSPENDED/DRAFT as authoritative.
export async function resolveCapability(svc: any, input: TravelEntryInput): Promise<{ capability: any; all: any[] }> {
  const i = normalizeEntryInput(input);
  const lookupCode = LEGACY_CAPABILITY_ALIAS[i.destination] || i.destination;
  const rows: any[] = await svc.entities.CountryCapability.filter({
    country_code: lookupCode, nationality: i.nationality, departure_country: i.departure_country, purpose: i.purpose,
  }).catch(() => []);
  if (!rows.length) {
    // Try any nationality-independent row for this destination as a last resort.
    const any2: any[] = await svc.entities.CountryCapability.filter({ country_code: lookupCode, purpose: i.purpose }).catch(() => []);
    return { capability: pickBest(any2), all: any2 };
  }
  return { capability: pickBest(rows), all: rows };
}

function pickBest(rows: any[]): any {
  if (!rows.length) return null;
  const order: Record<PublishingState, number> = { PUBLISHED: 5, VERIFIED: 4, NEEDS_REVIEW: 3, RESEARCHING: 2, DRAFT: 1, SUSPENDED: 0 };
  const sorted = [...rows].sort((a, b) => (order[b.status as PublishingState] || 0) - (order[a.status as PublishingState] || 0) || (b.priority_score || 0) - (a.priority_score || 0) || (b.rule_version || 0) - (a.rule_version || 0));
  return sorted[0];
}

export async function resolveTravelEntry(svc: any, raw: TravelEntryInput): Promise<TravelEntryResult> {
  const input = normalizeEntryInput(raw);
  const stay_days = computeStayDays(input.travel_dates);
  const today = new Date().toISOString();

  const { capability, all } = await resolveCapability(svc, input);

  // Live discovery options (reuses Phase 15 engine — never duplicated here).
  const discovery = await checkEligibility(svc, { nationality: input.nationality, destination: input.destination, purpose: input.purpose, travel_dates: input.travel_dates }).catch(() => null);
  const options = discovery?.options || [];
  const country = discovery?.destination || null;

  // Journey type: prefer capability; else infer from best option category.
  let journey_type: JourneyType | null = capability?.journey_type || null;
  if (!journey_type && options[0]) journey_type = inferJourney(options[0]);

  const ready_for_public = !!(capability && (capability.status === "PUBLISHED" || capability.status === "VERIFIED") && capability.source_type && capability.source_type !== "dev_seed" && capability.source_type !== "secondary_reference");

  const freshness = computeFreshness(capability, today);

  const conditions = ready_for_public ? buildConditions(capability) : [];

  // Regulatory/customer truth must come from the authoritative capability, never
  // from the legacy discovery seed graph. The old path mixed generic seed
  // requirements (bank statements, police clearance, etc.) into otherwise
  // official destination pages and cases. Build the upload checklist only from
  // the verified capability checklist and its explicit document flags.
  const documents: { code: string; label: string; mandatory: boolean }[] = [];
  if (ready_for_public) {
    const seen = new Set<string>();
    const addDoc = (code: string, label: string, mandatory = true) => {
      const key = String(code || "").toLowerCase();
      if (!key || key === "visa" || seen.has(key)) return;
      seen.add(key); documents.push({ code: key, label, mandatory });
    };
    for (const it of (Array.isArray(capability?.checklist) ? capability.checklist : [])) {
      if (it?.kind === "required" && it?.applicable !== false) addDoc(it.document_code || it.code, it.label || it.code, true);
    }
    if (capability?.document_requirements?.photo_requirements) addDoc("photo", "Recent passport-style photograph", true);
  }

  // The seed catalog historically stored whole currency units in a field named
  // *_minor (VN=25 USD, TH=2000 THB, SG=30 SGD). Normalize those legacy rows at
  // the read boundary and write future seeds correctly. Never fall back to
  // discovery-product pricing for regulatory government fees.
  const rawGov = capability?.fee_government_minor;
  const normalizedGov = normalizeGovernmentFeeMinor(rawGov, capability?.fee_notes);
  const launchLive = isKroszMvpCountry(input.destination);
  const launchPrice = mvpPricingFor(input.destination);
  const fees = ready_for_public && launchLive && launchPrice
    ? {
        government_minor: launchPrice.government_inr_minor,
        service_minor: launchPrice.krosz_service_inr_minor,
        total_minor: launchPrice.government_inr_minor + launchPrice.krosz_service_inr_minor,
        currency: "INR",
        notes: "Krosz service fee is set at 75% of the current Atlys benchmark used for this MVP and includes applicable service-fee tax.",
        original_government_minor: normalizedGov,
        original_currency: capability?.fee_currency || null,
        benchmark_date: launchPrice.benchmark_date,
        benchmark_ratio: launchPrice.benchmark_ratio,
      }
    : null;

  const publicOptions = options.map((o: any) => (ready_for_public && launchLive) ? {
    ...o,
    source: capability.source_type,
    source_name: capability.source_name,
    source_url: capability.source_url,
    verified_at: capability.verified_at,
    max_stay_days: capability.max_stay_days ?? o.max_stay_days,
    entries: capability.entries ?? o.entries,
    fees: fees ? { currency: fees.currency, government_minor: fees.government_minor, service_minor: fees.service_minor, total_minor: fees.total_minor, notes: fees.notes } : undefined,
  } : { ...o, fees: undefined, verified_at: undefined });

  const checklist = buildChecklist(capability, {
    stay_days, is_minor: input.traveler_attributes?.is_minor, entries: input.traveler_attributes?.entries ?? capability?.entries, passport_expiry: input.traveler_attributes?.passport_expiry, asOf: today,
  });

  // Phase 24: deterministic execution capability from verified facts (§11). The public
  // result receives only the safe projection (§18) — never internal research/evidence/score.
  const bindings: any[] = capability
    ? await svc.entities.CountryProviderBinding.filter({ country_code: capability.country_code, nationality: capability.nationality, journey_type: capability.journey_type }, "-fallback_order", 50).catch(() : any[] => [])
    : [];
  const compKeys: string[] = Array.from(new Set([capability?.provider_composition?.source, capability?.provider_composition?.application, capability?.provider_composition?.submission, capability?.provider_composition?.tracking, capability?.provider_composition?.operations].filter(Boolean) as string[]));
  const providersByKey = await providersByKeyFor(svc, compKeys);
  const exec = computeExecutionCapability(capability, bindings, providersByKey);
  const projection = publicVerificationProjection(capability, exec, journey_type);

  return {
    input: { nationality: input.nationality, departure_country: input.departure_country, destination: input.destination, purpose: input.purpose, travel_dates: input.travel_dates },
    destination: country,
    capability,
    journey_type,
    visa_required: capability?.visa_required ?? (journey_type !== "VISA_FREE" && journey_type !== "OTHER_LOW_FRICTION"),
    max_stay_days: capability?.max_stay_days ?? options[0]?.max_stay_days ?? null,
    entries: capability?.entries ?? options[0]?.entries ?? null,
    conditions,
    documents,
    fees,
    application: {
      required: (capability?.application_required as any) || (journey_type === "VISA_FREE" || journey_type === "VISA_ON_ARRIVAL" ? "NOT_REQUIRED" : "REQUIRED"),
      capability: capability?.application_capability || { prepare: "YES", prefill: "YES", pay: "NO", submit: "NO", track: "NO" },
      submission: capability?.submission_capability || "OFFICIAL_PORTAL",
      tracking: capability?.tracking_capability || "TRIP_ONLY",
      automation: capability?.automation_level || (journey_type === "VISA_FREE" || journey_type === "VISA_ON_ARRIVAL" ? "GUIDED" : "SEMI_AUTOMATED"),
      appointment_required: !!capability?.appointment_required,
      official_portal: capability?.official_portal_url || null,
      manual_operations_required: !!capability?.manual_operations_required,
    },
    checklist,
    options: publicOptions,
    // A verified, published capability is the authoritative route-eligibility
    // signal. The legacy discovery layer can still return "not_eligible" when
    // its VisaRoute catalog has no/empty/dev_seed rows for this destination,
    // which must NOT override a live capability — doing so told eligible
    // travelers "You do not appear eligible" on a verified route.
    outcome: !capability ? "no_configuration" : (!ready_for_public ? "requires_review" : "eligible"),
    freshness,
    rule_version: capability?.rule_version ?? null,
    source: capability ? { name: capability.source_name, url: capability.source_url, type: capability.source_type, verified_at: capability.verified_at, effective_at: capability.effective_at, provider: capability.provider } : (discovery?.provenance ? { name: discovery.provenance.source_name, url: discovery.provenance.source_url, type: discovery.provenance.source_type, verified_at: discovery.provenance.verified_at } : null),
    ready_for_public: ready_for_public && launchLive,
    mvp_live: launchLive,
    availability: launchLive ? "LIVE" : "COMING_SOON",
    api: { available: capability?.api_available || "UNKNOWN", mcp_available: capability?.mcp_available || "NO", mcp_read_only: capability?.mcp_read_only },
    // Phase 24: prefer the deterministic execution-capability message for assisted
    // states; keep the journey-specific guidance text for GUIDANCE_ONLY (§12/§34).
    support_summary: exec !== "GUIDANCE_ONLY" && capability ? travelerSupportMessage(exec, journey_type) : supportSummary(capability, journey_type, stay_days),
    verification_status: projection.verification_status,
    data_confidence: projection.data_confidence,
    execution_capability: projection.execution_capability,
  };
}

// §34 — honest traveler-facing summary. NEVER "we'll submit your visa" when we
// only guide through an external portal; NEVER "track automatically" without a
// real tracking channel. This text is what the UI shows the traveler.
export function supportSummary(cap: any, journey: JourneyType | null, stayDays: number | null): string {
  const auto = cap?.automation_level || "GUIDED";
  const sub = cap?.submission_capability;
  if (!cap) return "We're researching entry requirements for this destination. Checklist and official guidance will appear here once verified.";
  if (journey === "VISA_FREE") return "Indian passport holders travel visa-free. We'll give you the entry checklist, valid-stay rules, and arrival essentials.";
  if (journey === "VISA_ON_ARRIVAL") return "You can get a visa on arrival. We'll prepare your documents and guide you through what to present at the border — please re-check the latest VOA eligibility before travel.";
  if (auto === "FULLY_AUTOMATED") return "We'll prepare, submit, and track your application end-to-end through our automated pipeline.";
  if (sub === "OFFICIAL_PORTAL" || sub === "TRAVELER_SUBMISSION") return "We'll prepare your application and guide you through the official government submission. You (or our operations team) complete it on the official portal — we do not submit on your behalf unless a verified integration exists.";
  if (auto === "SEMIAUTOMATED" || auto === "SEMI_AUTOMATED") return "We'll prepare and pre-fill most of your journey; an official portal or operator step is required to finish submission.";
  if (auto === "MANUAL") return "We'll prepare your application package and our operations team will guide manual submission. Tracking is handled case-by-case — no automatic tracking is claimed.";
  return "We'll give you accurate requirements, a checklist, and submission guidance for this destination.";
}

// §21 — internal automation score (platform capability, NOT visa approval
// probability). Sums the verified provider-capability steps + composition roles.
export function computeAutomationScore(cap: any, bindings: any[] = []): number {
  if (!cap) return 0;
  const steps = ["requirements", "eligibility", "application", "prefill", "documents", "payment", "submission", "status", "tracking"];
  let yes = 0;
  const pc: any = cap.provider_capabilities || {};
  for (const s of steps) { const v = String(pc[s] || "UNKNOWN"); if (v === "YES") yes++; else if (v === "PARTIAL") yes += 0.5; }
  const comp: any = cap.provider_composition || {};
  for (const role of ["source", "application", "submission", "tracking", "operations"]) if (comp[role]) yes += 0.4;
  return Math.max(0, Math.min(100, Math.round((yes / (steps.length + 5)) * 100)));
}

// Admin capability detail (§30) — composes the capability with its binding rows
// + provider rows. Never returned to travelers (§29).
export async function resolveCapabilityDetail(svc: any, input: TravelEntryInput): Promise<CapabilityDetail> {
  const { capability } = await resolveCapability(svc, input);
  const bindings: any[] = capability
    ? await svc.entities.CountryProviderBinding.filter({ country_code: capability.country_code, nationality: capability.nationality, journey_type: capability.journey_type }, "-fallback_order", 200).catch(() => [])
    : [];
  const providerKeys: string[] = Array.from(new Set(
    [capability?.provider_composition?.source, capability?.provider_composition?.application, capability?.provider_composition?.submission, capability?.provider_composition?.tracking, capability?.provider_composition?.operations].filter(Boolean) as string[]
  ));
  const providers: any[] = [];
  for (const k of providerKeys) {
    const r: any[] = await svc.entities.Provider.filter({ key: k }).catch(() => []);
    if (r[0]) providers.push({ ...r[0], adapter_config: undefined, capabilities: undefined });
  }
  const providersByKey = Object.fromEntries(providers.map((p) => [p.key, p]));
  // Phase 24: attach claim-level evidence, research tasks, and the verification summary.
  const evidence = capability ? await listEvidenceFor(svc, capability.id).catch(() : any[] => []) : [];
  const researchTasks = capability ? await listResearchTasksFor(svc, capability.id).catch(() : any[] => []) : [];
  const verificationSummary = capability ? await buildVerificationSummary(svc, capability, bindings, providersByKey).catch(() => null) : null;
  return {
    capability,
    bindings,
    providers,
    provider_composition: capability?.provider_composition || {},
    fallback_strategy: capability?.fallback_strategy || {},
    automation_score: computeAutomationScore(capability, bindings),
    data_confidence: capability?.data_confidence || "UNKNOWN",
    final_classification: capability?.final_classification || "UNKNOWN",
    research_status: capability?.research_status || "RESEARCHING",
    evidence,
    research_tasks: researchTasks,
    verification_summary: verificationSummary,
  };
}

export function inferJourney(opt: any): JourneyType | null {
  const cat = String(opt?.category || "").toLowerCase();
  if (cat === "visa_free") return "VISA_FREE";
  if (cat.includes("on_arrival") || cat === " visa_on_arrival") return "VISA_ON_ARRIVAL";
  if (cat === "eta") return "ETA";
  if (cat === "evisa") return "EVISA";
  if (cat === "embassy_visa" || cat === "sticker_visa") return "EMBASSY_VISA";
  if (cat === "transit") return "TRANSIT_VISA";
  return null;
}

// ---------- Admin: validation report (§50) ----------

export async function getValidationReport(svc: any, user: any): Promise<any> {
  if (user?.role !== "admin") throw { message: "Admin only", code: "FORBIDDEN" };
  const rows: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 500).catch(() => []);
  const today = new Date().toISOString();
  // Phase 24: fetch bindings + providers once to derive execution capability + verification per row.
  const allBindings: any[] = await svc.entities.CountryProviderBinding.filter({}, "-country_code", 2000).catch(() : any[] => []);
  const bindingMap: Record<string, any[]> = {};
  for (const b of allBindings) { const k = `${b.country_code}|${b.journey_type}`; (bindingMap[k] = bindingMap[k] || []).push(b); }
  const allProviders: any[] = await svc.entities.Provider.filter({}, "-verified_at", 500).catch(() : any[] => []);
  const providersByKey: Record<string, any> = {};
  for (const p of allProviders) if (p.key) providersByKey[p.key] = { ...p, adapter_config: undefined };
  const vScore = (await import("../verification/engine.ts")).computeVerificationScore;
  const vClass = (await import("../verification/engine.ts")).verificationClassFromScore;
  const vExec = (await import("../verification/engine.ts")).computeExecutionCapability;
  const items = rows.map((c) => {
    const f = computeFreshness(c, today);
    const hasSource = !!(c.source_name && c.source_url && c.source_type && c.source_type !== "dev_seed");
    const hasVerified = !!c.verified_at;
    const hasPortal = !!(c.official_portal_url || c.application_required === "NOT_REQUIRED");
    const hasJourney = !!c.journey_type;
    const smoke = !!(c.status === "PUBLISHED" && hasSource && hasVerified && hasJourney);
    const bnd = bindingMap[`${c.country_code}|${c.journey_type}`] || [];
    const exec = vExec(c, bnd, providersByKey);
    // Lightweight score (no per-row evidence fetch) — honest, not manipulable.
    const score = vScore(c, [], bnd, providersByKey);
    const stale = staleDownstate(c, today);
    return {
      country_code: c.country_code, journey_type: c.journey_type, status: c.status, freshness: f,
      has_source: hasSource, has_verified_at: hasVerified, has_portal: hasPortal, automation: c.automation_level,
      rule_version: c.rule_version, mvp_enabled: c.mvp_enabled,
      visa_required: c.visa_required, application_required: c.application_required,
      api_available: c.api_available, mcp_available: c.mcp_available,
      submission_capability: c.submission_capability, tracking_capability: c.tracking_capability,
      appointment_requirement: c.appointment_requirement, data_confidence: c.data_confidence,
      research_status: c.research_status, final_classification: c.final_classification,
      automation_score: computeAutomationScore(c),
      source_name: c.source_name,
      verification_status: c.verification_status || (c.status === "PUBLISHED" ? "VERIFIED" : "INVENTORIED"),
      execution_capability: exec,
      verification_score: score,
      verification_class: vClass(score),
      stale,
      change_risk: c.change_risk || deriveChangeRisk(c, []),
      test_result: smoke ? "PASS" : (c.status === "SUSPENDED" ? "BLOCKED" : "NEEDS_REVIEW"),
    };
  });
  return {
    rows: items,
    summary: {
      total: items.length,
      ready: items.filter((i) => i.test_result === "PASS").length,
      needs_review: items.filter((i) => i.test_result === "NEEDS_REVIEW").length,
      blocked: items.filter((i) => i.test_result === "BLOCKED").length,
      target: 100,
      coverage_pct: items.length ? Math.round((items.filter((i) => i.test_result === "PASS").length / Math.max(items.length, 1)) * 100) : 0,
      // Phase 24 verification summary
      verified: items.filter((i) => i.verification_status === "VERIFIED").length,
      partially_verified: items.filter((i) => i.verification_status === "PARTIALLY_VERIFIED").length,
      researching: items.filter((i) => i.verification_status === "RESEARCHING" || i.verification_status === "INVENTORIED").length,
      stale: items.filter((i) => i.stale || i.verification_status === "STALE").length,
      blocked_verification: items.filter((i) => i.verification_status === "BLOCKED").length,
      execution: {
        GUIDANCE_ONLY: items.filter((i) => i.execution_capability === "GUIDANCE_ONLY").length,
        INTELLIGENCE_ONLY: items.filter((i) => i.execution_capability === "INTELLIGENCE_ONLY").length,
        PARTIAL_ASSIST: items.filter((i) => i.execution_capability === "PARTIAL_ASSIST").length,
        DOCUMENT_ASSIST: items.filter((i) => i.execution_capability === "DOCUMENT_ASSIST").length,
        APPLICATION_ASSIST: items.filter((i) => i.execution_capability === "APPLICATION_ASSIST").length,
        END_TO_END: items.filter((i) => i.execution_capability === "END_TO_END").length,
      },
    },
  };
}

export const __entry = { normalizeEntryInput, computeStayDays, computeFreshness, buildChecklist, buildConditions, aggregateFamilyReadiness, inferJourney, supportSummary, computeAutomationScore, resolveCapabilityDetail };