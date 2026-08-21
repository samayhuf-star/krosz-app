// Worldz Visa (Phase 24) — Verification, evidence, and execution-capability layer.
// ONE engine layered over the existing Travel Entry Engine (Phase 22/23). It never
// duplicates visa rules; it adds claim-level evidence, a two-source verification
// policy, a deterministic execution-capability derivation, freshness/staleness, and
// an honest traveler-facing projection. Public-facing helpers strip internal data.
//
// The three concerns are kept distinct (§2):
//   1. VISA TRUTH          — CapabilityEvidence over CountryCapability
//   2. PROVIDER CAPABILITY — Provider.capability_verification + CountryProviderBinding
//   3. OUR EXECUTION       — derivation from verified facts (computeExecutionCapability)
//
// No "supported" boolean collapses these. No marketing claim infers a capability.

import { computeFreshness } from "../entry/engine.ts";

// ---------------- Source hierarchy (§4) ----------------

export type SourceType =
  | "GOVERNMENT" | "OFFICIAL_IMMIGRATION" | "EMBASSY_CONSULATE"
  | "OFFICIAL_AIRLINE_IATA" | "VERIFIED_COMMERCIAL_PROVIDER" | "SECONDARY_SOURCE";

// Lower number = higher precedence (ranks first).
export const SOURCE_PRECEDENCE: Record<SourceType, number> = {
  GOVERNMENT: 1,
  OFFICIAL_IMMIGRATION: 2,
  EMBASSY_CONSULATE: 3,
  OFFICIAL_AIRLINE_IATA: 4,
  VERIFIED_COMMERCIAL_PROVIDER: 5,
  SECONDARY_SOURCE: 6,
};

export const OFFICIAL_SOURCE_TYPES: SourceType[] = [
  "GOVERNMENT", "OFFICIAL_IMMIGRATION", "EMBASSY_CONSULATE", "OFFICIAL_AIRLINE_IATA",
];

export function sourcePrecedence(t: string): number {
  return SOURCE_PRECEDENCE[t as SourceType] ?? 99;
}

export function isOfficialSource(t: string): boolean {
  return OFFICIAL_SOURCE_TYPES.includes(t as SourceType);
}

// ---------------- Two-source rule (§7) ----------------

export interface TwoSourceResult { ok: boolean; reason: string; hasOfficial: boolean; hasSecond: boolean; hasOverride: boolean; }

// VERIFIED requires: ≥1 official source evidence (VERIFIED) PLUS
// (a second distinct VERIFIED source) OR (an explicit recorded admin override).
// A commercial provider alone can never verify visa truth (§7).
export function meetsTwoSourceRule(evidence: any[]): TwoSourceResult {
  const verified = (evidence || []).filter((e) => e?.verification_status === "VERIFIED");
  const official = verified.filter((e) => isOfficialSource(e.source_type));
  const commercial = verified.filter((e) => e.source_type === "VERIFIED_COMMERCIAL_PROVIDER");
  const hasOfficial = official.length > 0;
  const hasOverride = verified.some((e) => !!e.override_record && !!e.override_record.admin_id);
  // A second source = a verified source whose (source_type|source_url) key differs from
  // every official one — i.e. at least two DISTINCT verified sources. Two different official
  // pages (e.g. government + embassy) are a valid cross-check; the same page twice is not.
  const verifiedKeys = new Set(verified.map((e) => `${e.source_type}|${e.source_url || ""}`));
  const hasSecond = verifiedKeys.size >= 2;
  if (!hasOfficial && commercial.length > 0) {
    return { ok: false, reason: "Commercial source alone cannot verify government visa truth", hasOfficial, hasSecond: hasSecond, hasOverride };
  }
  if (!hasOfficial) return { ok: false, reason: "No official source", hasOfficial, hasSecond, hasOverride };
  if (!hasSecond && !hasOverride) return { ok: false, reason: "Needs second source or explicit admin override", hasOfficial, hasSecond, hasOverride };
  return { ok: true, reason: "Official source + second confirmation (or recorded override)", hasOfficial, hasSecond, hasOverride };
}

// ---------------- Execution capability (§11) ----------------

export type ExecutionCapability =
  | "GUIDANCE_ONLY" | "INTELLIGENCE_ONLY" | "PARTIAL_ASSIST"
  | "DOCUMENT_ASSIST" | "APPLICATION_ASSIST" | "END_TO_END" | "UNKNOWN";

// Deterministic derivation from VERIFIED facts only. Never from provider marketing
// claims, never from api_available=YES alone, never from a provider submission claim
// without our commercial authorization.
//
// Inputs:
//   cap              — CountryCapability (visa truth + provider_capabilities map)
//   bindings         — CountryProviderBinding[] for this destination/journey
//   providersByKey   — Provider[] lookup (lifecycle + capability_verification)
export function computeExecutionCapability(cap: any, bindings: any[] = [], providersByKey: Record<string, any> = {}): ExecutionCapability {
  if (!cap) return "GUIDANCE_ONLY";

  const bnd = bindings || [];
  // VERIFIED bindings (binding.verification_status === "VERIFIED"), role submission/tracking.
  const verifiedBindings = bnd.filter((b) => b?.verification_status === "VERIFIED" || b?.status === "ACTIVE" || b?.status === "VERIFIED");
  const submissionBindings = verifiedBindings.filter((b) => b.role === "submission" && (b.capability?.submission === "YES" || b.capability?.submission === "PARTIAL"));
  const trackingBindings = verifiedBindings.filter((b) => b.role === "tracking" && (b.capability?.tracking === "YES" || b.capability?.tracking === "PARTIAL"));

  const appCap = cap.application_capability || {};
  const hasApplicationAssist = appCap.prepare === "YES" && appCap.prefill === "YES";
  const pc = cap.provider_capabilities || {};

  // END_TO_END: a verified submission binding whose provider is VERIFIED, with our
  // API access + commercial authorization both YES. None of the seeded destinations
  // meet this (no government eVisa API is contractually ours) → never over-claimed.
  const endToEnd = submissionBindings.some((b) => {
    const p = providersByKey[b.provider_key];
    const providerVerified = p?.provider_lifecycle === "VERIFIED" || p?.provider_lifecycle === "PRODUCTION";
    const capVer = p?.capability_verification?.submission === "VERIFIED";
    return providerVerified && capVer && b.our_api_access === "YES" && b.our_commercial_authorized === "YES" && b.our_active !== false;
  });
  if (endToEnd) return "END_TO_END";

  // APPLICATION_ASSIST: verified application automation (our engine) + verified submission binding
  // (provider VERIFIED, our access) — but submission is automated by partner. Keep separate from END_TO_END.
  const appAssist = submissionBindings.some((b) => {
    const p = providersByKey[b.provider_key];
    const providerVerified = p?.provider_lifecycle === "VERIFIED" || p?.provider_lifecycle === "PRODUCTION";
    return providerVerified && p?.capability_verification?.submission === "VERIFIED" && b.our_api_access === "YES" && b.our_commercial_authorized === "YES";
  }) && hasApplicationAssist && pc.application === "YES";
  if (appAssist) return "APPLICATION_ASSIST";

  // PARTIAL_ASSIST: we prepare documents + application, but final submission is manual
  // (operator or traveler self via official portal). This is the honest state for most eVisa destinations.
  if (hasApplicationAssist && submissionBindings.length > 0) return "PARTIAL_ASSIST";

  // DOCUMENT_ASSIST: document vault active, no application automation claimed.
  if (pc.documents === "YES" && !hasApplicationAssist) return "DOCUMENT_ASSIST";

  // INTELLIGENCE_ONLY: verified eligibility + requirements (e.g. Pipeworx intelligence)
  // but no application/submission assist.
  const intelOnly = (pc.requirements === "YES" || pc.eligibility === "YES") && !hasApplicationAssist && submissionBindings.length === 0;
  if (intelOnly) return "INTELLIGENCE_ONLY";

  return "GUIDANCE_ONLY";
}

// ---------------- Verification score (§13) — internal, not manipulable ----------------

// Score is computed from verified components. We IGNORE any stored verification_score
// on the capability (admins cannot hand-set it). 0-100. NOT a visa approval probability.
export function computeVerificationScore(cap: any, evidence: any[] = [], bindings: any[] = [], providersByKey: Record<string, any> = {}): number {
  let score = 0;
  // Component 1: official source evidence (up to 30)
  const officialEv = (evidence || []).filter((e) => e.verification_status === "VERIFIED" && isOfficialSource(e.source_type));
  score += Math.min(30, officialEv.length * 15);
  // Component 2: second-source confirmation (up to 15)
  const two = meetsTwoSourceRule(evidence);
  if (two.hasSecond) score += 15;
  else if (two.hasOverride) score += 10;
  // Component 3: freshness (up to 15)
  const f = cap ? computeFreshness(cap, new Date().toISOString()) : "REQUIRES_REVIEW";
  if (f === "FRESH") score += 15; else if (f === "STALE") score += 8; else if (f === "EXPIRED") score += 0; else score += 0;
  // Component 4: structured field completeness (up to 20)
  score += Math.min(20, completenessPct(cap) / 5); // 0-20
  // Component 5: provider verification (up to 10)
  const verifiedProviders = (bindings || []).filter((b) => {
    const p = providersByKey[b.provider_key];
    return p && (p.provider_lifecycle === "VERIFIED" || p.provider_lifecycle === "PRODUCTION");
  }).length;
  score += Math.min(10, verifiedProviders * 5);
  // Component 6: execution verification (up to 10)
  const exec = computeExecutionCapability(cap, bindings, providersByKey);
  if (exec === "END_TO_END") score += 10;
  else if (exec === "APPLICATION_ASSIST") score += 8;
  else if (exec === "PARTIAL_ASSIST") score += 6;
  else if (exec === "INTELLIGENCE_ONLY") score += 4;
  else if (exec === "DOCUMENT_ASSIST") score += 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function verificationClassFromScore(score: number): "A" | "B" | "C" | "D" | "E" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 25) return "D";
  return "E";
}

// Structured-field completeness 0-100 (§13 / §24). NOT a visa metric.
export function completenessPct(cap: any): number {
  if (!cap) return 0;
  const fields = [
    "journey_type", "visa_required", "max_stay_days", "passport_validity_min_months",
    "application_required", "submission_capability", "tracking_capability",
    "official_portal_url", "fee_government_minor", "source_name", "source_url",
  ];
  let filled = 0;
  for (const f of fields) { const v = (cap as any)[f]; if (v !== null && v !== undefined && v !== "") filled++; }
  return Math.round((filled / fields.length) * 100);
}

// ---------------- Freshness / staleness (§14) ----------------

// If a capability was VERIFIED/PUBLISHED but its source evidence is now stale/expired,
// its verification status is downstated to STALE. Underlying evidence is never deleted.
export function staleDownstate(cap: any, asOf: string): boolean {
  if (!cap) return false;
  if (cap.verification_status !== "VERIFIED" && cap.verification_status !== "PARTIALLY_VERIFIED") return false;
  const f = computeFreshness(cap, asOf);
  return f === "STALE" || f === "EXPIRED";
}

export function nextReviewDate(cap: any, risk: string): string {
  const days = risk === "HIGH" ? 30 : risk === "MEDIUM" ? 60 : 90;
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ---------------- Traveler-facing messages (§12) ----------------

export const EXECUTION_LABEL: Record<ExecutionCapability, string> = {
  GUIDANCE_ONLY: "Guidance only",
  INTELLIGENCE_ONLY: "Intelligence only",
  PARTIAL_ASSIST: "Partial assist",
  DOCUMENT_ASSIST: "Document assist",
  APPLICATION_ASSIST: "Application assist",
  END_TO_END: "End-to-end",
  UNKNOWN: "Unknown",
};

export function travelerSupportMessage(exec: ExecutionCapability, journey: string | null): string {
  switch (exec) {
    case "END_TO_END": return "Your application can be submitted through our verified partner.";
    case "APPLICATION_ASSIST": return "We can help prepare and submit your application through a verified automated flow.";
    case "PARTIAL_ASSIST": return "We can help prepare your application, but final submission may require additional steps.";
    case "DOCUMENT_ASSIST": return "We can help organize your documents for this destination.";
    case "INTELLIGENCE_ONLY": return "We can help you understand eligibility and required documents.";
    case "GUIDANCE_ONLY":
      if (journey === "VISA_FREE") return "We can guide you through the official entry process — Indian passport holders travel visa-free here.";
      return "We can guide you through the official application process.";
    default: return "We're researching entry requirements for this destination.";
  }
}

// ---------------- Public projection (§18) — strip internal data ----------------

// The public Travel Entry Engine result must NEVER include: internal research notes,
// private provider contracts, internal automation/verification score, admin-only
// evidence metadata, or unverified provider claims. Only safe summary fields surface.
export function publicVerificationProjection(cap: any, exec: ExecutionCapability, journey: string | null): {
  verification_status: string; data_confidence: string; execution_capability: ExecutionCapability; support_summary: string;
} {
  const verificationStatus = cap?.verification_status || (cap?.status === "PUBLISHED" ? "VERIFIED" : cap?.status === "RESEARCHING" ? "RESEARCHING" : "INVENTORIED");
  const dataConfidence = cap?.data_confidence || "UNKNOWN";
  const support = travelerSupportMessage(exec, journey);
  return {
    verification_status: verificationStatus,
    data_confidence: dataConfidence,
    execution_capability: exec,
    support_summary: support,
  };
}

// Contract-test guard: assert the public result leaks no internal-only fields.
export function assertNoPublicLeak(publicResult: any): { pass: boolean; leaked: string[] } {
  const FORBIDDEN = ["research_notes", "research_assignee", "automation_score", "verification_score", "evidence", "research_tasks", "provider_lifecycle", "capability_verification", "our_api_access", "our_commercial_authorized", "override_record", "content_fingerprint", "content_snapshot"];
  const leaked: string[] = [];
  for (const k of FORBIDDEN) if (k in (publicResult || {})) leaked.push(k);
  return { pass: leaked.length === 0, leaked };
}

// ---------------- Research-task + provider lifecycle transitions (§6/§8/§13/§14) ----------------

const RESEARCH_TRANSITIONS: Record<string, string[]> = {
  QUEUED: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["BLOCKED", "NEEDS_SECOND_SOURCE", "READY_FOR_REVIEW", "REJECTED"],
  BLOCKED: ["IN_PROGRESS", "REJECTED"],
  NEEDS_SECOND_SOURCE: ["IN_PROGRESS", "READY_FOR_REVIEW", "REJECTED"],
  READY_FOR_REVIEW: ["VERIFIED", "REJECTED", "IN_PROGRESS"],
  VERIFIED: [],
  REJECTED: ["QUEUED"],
};

export function canTransitionResearch(from: string, to: string): boolean {
  return (RESEARCH_TRANSITIONS[from] || []).includes(to);
}

const PROVIDER_LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  DISCOVERED: ["RESEARCHING", "REJECTED"],
  RESEARCHING: ["CONTACTED", "DOCUMENTATION_RECEIVED", "SUSPENDED", "REJECTED"],
  CONTACTED: ["DOCUMENTATION_RECEIVED", "RESEARCHING", "REJECTED"],
  DOCUMENTATION_RECEIVED: ["SANDBOX", "TESTING", "SUSPENDED", "REJECTED"],
  SANDBOX: ["TESTING", "SUSPENDED", "REJECTED"],
  TESTING: ["VERIFIED", "PRODUCTION", "SUSPENDED", "REJECTED"],
  VERIFIED: ["PRODUCTION", "SUSPENDED"],
  PRODUCTION: ["SUSPENDED"],
  SUSPENDED: ["RESEARCHING", "REJECTED"],
  REJECTED: ["RESEARCHING"],
};

export function canTransitionProvider(from: string, to: string): boolean {
  return (PROVIDER_LIFECYCLE_TRANSITIONS[from] || []).includes(to);
}

// Completing a research task as VERIFIED requires attached evidence that satisfies
// the two-source rule (§6/§7). A bare status flip is rejected.
export function canCompleteResearchTaskVerified(task: any, evidence: any[]): { ok: boolean; reason: string } {
  if (!task) return { ok: false, reason: "No task" };
  const attached = (evidence || []).filter((e) => (task.evidence_ids || []).includes(e.id) || (task.evidence_ids || []).includes(e.ievidence_id));
  if (!attached.length) return { ok: false, reason: "VERIFIED requires attached evidence" };
  const two = meetsTwoSourceRule(attached);
  if (!two.ok) return { ok: false, reason: two.reason };
  return { ok: true, reason: "Two-source rule satisfied" };
}

// ---------------- Async DB helpers (server-side) ----------------

export async function listEvidenceFor(svc: any, countryCapabilityId: string): Promise<any[]> {
  const rows: any[] = await svc.entities.CapabilityEvidence.filter({ country_capability_id: countryCapabilityId }, "-retrieved_at", 200).catch(() => []);
  return rows.sort((a, b) => sourcePrecedence(a.source_type) - sourcePrecedence(b.source_type));
}

export async function listResearchTasksFor(svc: any, countryCapabilityId: string): Promise<any[]> {
  const rows: any[] = await svc.entities.ResearchTask.filter({ country_capability_id: countryCapabilityId }, "-created_at", 200).catch(() => []);
  return rows;
}

export interface VerificationSummary {
  verification_status: string;
  verification_score: number;
  verification_class: string;
  execution_capability: ExecutionCapability;
  evidence_completeness: number;
  source_count: number;
  official_source_count: number;
  has_second_source: boolean;
  has_override: boolean;
  change_risk: string;
  last_verified_at: string | null;
  next_review_at: string | null;
  source_hierarchy: { source_type: string; source_name: string; source_url: string; verification_status: string }[];
  claim_verification: Record<string, { status: string; count: number }>;
}

export async function buildVerificationSummary(svc: any, cap: any, bindings: any[], providersByKey: Record<string, any>): Promise<VerificationSummary> {
  const evidence = cap ? await listEvidenceFor(svc, cap.id).catch(() : any[] => []) : [];
  const score = computeVerificationScore(cap, evidence, bindings, providersByKey);
  const exec = computeExecutionCapability(cap, bindings, providersByKey);
  const two = meetsTwoSourceRule(evidence);
  const official = evidence.filter((e) => isOfficialSource(e.source_type));
  const claimMap: Record<string, { status: string; count: number }> = {};
  for (const e of evidence) {
    const k = e.claim_type || "general";
    claimMap[k] = claimMap[k] || { status: "UNVERIFIED", count: 0 };
    claimMap[k].count++;
    if (e.verification_status === "VERIFIED") claimMap[k].status = "VERIFIED";
    else if (claimMap[k].status !== "VERIFIED" && e.verification_status === "PARTIALLY_VERIFIED") claimMap[k].status = "PARTIALLY_VERIFIED";
  }
  return {
    verification_status: cap?.verification_status || (cap?.status === "PUBLISHED" ? "VERIFIED" : "INVENTORIED"),
    verification_score: score,
    verification_class: verificationClassFromScore(score),
    execution_capability: exec,
    evidence_completeness: completenessPct(cap),
    source_count: evidence.length,
    official_source_count: official.length,
    has_second_source: two.hasSecond,
    has_override: two.hasOverride,
    change_risk: cap?.change_risk || "UNKNOWN",
    last_verified_at: cap?.last_verified_at || cap?.verified_at || null,
    next_review_at: cap?.next_review_at || null,
    source_hierarchy: evidence.map((e) => ({ source_type: e.source_type, source_name: e.source_name, source_url: e.source_url, verification_status: e.verification_status })),
    claim_verification: claimMap,
  };
}

// providers lookup helper (denormalized adapter_config out).
export async function providersByKeyFor(svc: any, keys: string[]): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (!k) continue;
    const r: any[] = await svc.entities.Provider.filter({ key: k }).catch(() : any[] => []);
    if (r[0]) out[k] = { ...r[0], adapter_config: undefined };
  }
  return out;
}

// Deterministic change-risk from volatility signals (§15). High when freshness stale,
// medium when single-source, low when multi-source+fresh.
export function deriveChangeRisk(cap: any, evidence: any[]): "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" {
  if (!cap) return "UNKNOWN";
  const f = computeFreshness(cap, new Date().toISOString());
  const verified = (evidence || []).filter((e) => e.verification_status === "VERIFIED");
  if (f === "EXPIRED" || cap.verification_status === "STALE") return "HIGH";
  if (f === "STALE") return "MEDIUM";
  if (verified.length < 2) return "MEDIUM";
  return "LOW";
}

export const __verification = {
  meetsTwoSourceRule, computeExecutionCapability, computeVerificationScore, verificationClassFromScore,
  completenessPct, staleDownstate, travelerSupportMessage, publicVerificationProjection, assertNoPublicLeak,
  canTransitionResearch, canTransitionProvider, canCompleteResearchTaskVerified, deriveChangeRisk,
};