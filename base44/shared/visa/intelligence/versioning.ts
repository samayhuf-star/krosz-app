// Worldz Visa (Phase 37) — Visa Intelligence Versioning, Change Severity, Impact,
// Revalidation & Execution Version-Lock ENGINE. PURE (no DB, no network).
//
// This module does NOT reimplement the Travel Entry Engine, the verification engine,
// the change detector, the Case Engine, the Execution Router, the Operations Queue,
// the Document system, the Payment system, or the MCP layer. It ADDS:
//   - the version lifecycle state machine (§4)
//   - field-level change severity classification (§7)
//   - internal impact scoring (§8)
//   - source conflict + fetch-failure + staleness decisions (§17/§18/§20/§21)
//   - configurable low-risk auto-publish gate (§25)
//   - the execution version lock captured at prepare time (§35/§39)
//   - case revalidation against the current published version (§9/§11/§22)
//   - the pre-submission revalidation block (the core "no unsafe execution" §13/§14/§15/§24/§25/§26/§36)
//   - provenance + traveler-facing change notification shapes (§28/§29/§34)
//
// The durable publish/rollback lives in versionStore.ts (admin-gated). Agents and
// travelers may READ versions/confidence/impact but NEVER publish, approve, or
// rollback (§32/§33/§44) — there is no write/transition tool in the MCP catalog.

export type VersionStatus = "DRAFT" | "RESEARCHING" | "CHANGE_DETECTED" | "REVIEW_REQUIRED" | "APPROVED" | "PUBLISHED" | "SUPERSEDED" | "REJECTED";
export const VERSION_STATUSES: VersionStatus[] = [
  "DRAFT", "RESEARCHING", "CHANGE_DETECTED", "REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "SUPERSEDED", "REJECTED",
];
export const TERMINAL_VERSION: VersionStatus[] = ["PUBLISHED", "SUPERSEDED", "REJECTED"];

export const INTELLIGENCE_VERSION_CHANGED_EVENT = "INTELLIGENCE_VERSION_CHANGED";
export const INTELLIGENCE_CHANGE_REQUIRES_ACTION_EVENT = "INTELLIGENCE_CHANGE_REQUIRES_ACTION";
export const VERSION_ROLLBACK_EVENT = "VERSION_ROLLBACK";
export const REVALIDATION_TASK_TYPES = ["INTELLIGENCE_REVIEW", "DOCUMENT_RECHECK", "APPLICATION_REVALIDATION", "PROVIDER_ROUTE_REVIEW", "FORM_MAPPING_REVIEW"] as const;

const VERSION_TRANSITIONS: Record<VersionStatus, VersionStatus[]> = {
  DRAFT: ["RESEARCHING", "REVIEW_REQUIRED", "REJECTED"],
  RESEARCHING: ["CHANGE_DETECTED", "REVIEW_REQUIRED", "APPROVED", "REJECTED"],
  CHANGE_DETECTED: ["REVIEW_REQUIRED", "REJECTED"],
  REVIEW_REQUIRED: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["PUBLISHED", "REJECTED"],
  PUBLISHED: ["SUPERSEDED"],
  SUPERSEDED: ["PUBLISHED"], // re-publish via rollback (§27)
  REJECTED: ["DRAFT"],
};
export function canTransitionVersion(from: VersionStatus, to: VersionStatus): boolean {
  return (VERSION_TRANSITIONS[from] || []).includes(to);
}

// ---------- Change severity (§7) ----------
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export const SEVERITY_RANK: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export const FIELD_SEVERITY: Record<string, Severity> = {
  journey_type: "CRITICAL", visa_required: "CRITICAL", eligibility: "CRITICAL",
  visa_free: "CRITICAL", evisa_available: "CRITICAL", eta_available: "CRITICAL", visa_on_arrival: "CRITICAL",
  application_required: "HIGH", submission_capability: "HIGH",
  fee_government_minor: "HIGH", fee_currency: "HIGH",
  required_documents: "HIGH",
  application_url: "HIGH", official_portal_url: "HIGH",
  passport_validity_min_months: "HIGH",
  processing_time_days: "MEDIUM", validity_days: "MEDIUM", max_stay_days: "MEDIUM",
  insurance_required: "MEDIUM", biometric_requirements: "MEDIUM",
  description: "LOW", advisory_text: "LOW",
};
export function classifyChangeSeverity(field: string): Severity {
  return FIELD_SEVERITY[field] || "MEDIUM"; // unknown field → fail-safe MEDIUM (never LOW)
}
export function severityForDiff(materialFields: string[]): Severity {
  let rank = 0; let sev: Severity = "LOW";
  for (const f of materialFields) { const r = SEVERITY_RANK[classifyChangeSeverity(f)]; if (r > rank) { rank = r; sev = classifyChangeSeverity(f); } }
  return sev;
}
export const CRITICAL_FIELDS = new Set(["journey_type", "visa_required", "eligibility", "visa_free", "evisa_available", "eta_available", "visa_on_arrival"]);
export const HIGH_FIELDS = new Set(["fee_government_minor", "fee_currency", "required_documents", "application_url", "official_portal_url", "submission_capability", "passport_validity_min_months", "application_required"]);
export function affectsExecution(fields: string[]): boolean {
  return fields.some((f) => ["journey_type", "application_url", "official_portal_url", "submission_capability", "application_required", "required_documents", "passport_validity_min_months"].includes(f));
}

// ---------- Auto-publish gate (§25) ----------
export const NEVER_AUTO_PUBLISH = new Set([...CRITICAL_FIELDS, ...HIGH_FIELDS, "biometric_requirements"]);
export const AUTO_PUBLISHABLE_FIELDS = new Set(["description", "advisory_text"]);
export function canAutoPublish(change: { materialFields: string[]; severity: Severity }, config: { autoPublishLowRisk?: boolean } = {}): boolean {
  if (!config.autoPublishLowRisk) return false;
  if (change.severity !== "LOW") return false;
  if (!change.materialFields.length) return false;
  return change.materialFields.every((f) => AUTO_PUBLISHABLE_FIELDS.has(f));
}

// ---------- Internal impact score (§8) ----------
export function computeImpactScore(args: { severity: Severity; activeCases: number; affectsExecution: boolean; futureTravelCases: number }): number {
  let s = SEVERITY_RANK[args.severity] * 20; // 20/40/60/80
  s += Math.min(20, args.activeCases * 2);
  if (args.affectsExecution) s += 15;
  s += Math.min(10, args.futureTravelCases);
  return Math.max(0, Math.min(100, Math.round(s)));
}

// ---------- Source conflict (§17/§18) ----------
export function detectSourceConflict(evidence: Array<{ claim_value?: string | null; source_type: string; verification_status: string }>): { conflict: boolean; values: string[]; officialSources: number } {
  const verified = evidence.filter((e) => e.verification_status === "VERIFIED" && e.claim_value != null);
  if (verified.length < 2) return { conflict: false, values: [], officialSources: 0 };
  const official = verified.filter((e) => ["GOVERNMENT", "OFFICIAL_IMMIGRATION", "EMBASSY_CONSULATE"].includes(e.source_type));
  const values = Array.from(new Set(verified.map((e) => String(e.claim_value))));
  return { conflict: values.length > 1, values, officialSources: official.length };
}

// ---------- Fetch failure (§20) ----------
export function fetchFailureDecision(): { status: "SOURCE_FETCH_FAILED"; retain_last_verified: boolean } {
  return { status: "SOURCE_FETCH_FAILED", retain_last_verified: true };
}

// ---------- Staleness (§21) ----------
export function stalenessStatus(lastVerifiedAt: string | null, asOf: string = new Date().toISOString()): "FRESH" | "AGING" | "STALE" | "CRITICAL_STALE" {
  if (!lastVerifiedAt) return "CRITICAL_STALE";
  const days = (new Date(asOf).getTime() - new Date(lastVerifiedAt).getTime()) / 86400000;
  if (days < 30) return "FRESH";
  if (days < 90) return "AGING";
  if (days < 180) return "STALE";
  return "CRITICAL_STALE";
}

// ---------- Version build + identity (§3/§19) ----------
export function buildVersion(input: {
  country: string; journey: string; data_version: string; source_version?: string | null;
  effective_from?: string | null; effective_until?: string | null; published_at?: string | null;
  published_by?: string | null; source_reference?: string | null; confidence?: string;
  content_hash?: string | null; change_summary?: any; previous_version_id?: string | null;
  status?: VersionStatus; severity?: Severity; affects_execution?: boolean;
}): any {
  return {
    country: input.country, journey: input.journey, data_version: input.data_version,
    source_version: input.source_version || null,
    effective_from: input.effective_from || null, effective_until: input.effective_until || null,
    published_at: input.published_at || null, published_by: input.published_by || null,
    source_reference: input.source_reference || null, confidence: input.confidence || "UNKNOWN",
    content_hash: input.content_hash || null,
    change_summary: input.change_summary || null,
    previous_version_id: input.previous_version_id || null,
    status: input.status || "DRAFT",
    severity: input.severity || "MEDIUM", affects_execution: !!input.affects_execution,
  };
}
export function versionIdentity(v: any): { country: string; journey: string; data_version: string } {
  return { country: v.country, journey: v.journey, data_version: v.data_version };
}

// ---------- Publish / rollback transitions (§17/§18/§27) ----------
export function publishTransition(args: { newVersionId: string; currentPublished?: { id: string } | null }): { newStatus: VersionStatus; previousStatus: VersionStatus; previousSuperseded: boolean } {
  const prevExists = !!args.currentPublished && args.currentPublished.id !== args.newVersionId;
  return { newStatus: "PUBLISHED", previousStatus: "SUPERSEDED", previousSuperseded: prevExists };
}
export function rollbackTransition(args: { currentPublishedId: string; previousVersionId: string }): { currentStatus: VersionStatus; previousStatus: VersionStatus; preserved: boolean } {
  return { currentStatus: "SUPERSEDED", previousStatus: "PUBLISHED", preserved: true };
}

// ---------- Execution version lock (§35/§39) ----------
export interface VersionLock { intelligence_version: string | null; provider_version: string | null; form_version: string | null; mapping_version: string | null; captured_at: string; }
export function versionLockForCase(app: any): VersionLock {
  const snap = app?.case_snapshot || {};
  const lock = snap.version_lock || {};
  return {
    intelligence_version: lock.intelligence_version || snap.intelligence_version || app?.visa_rule_version || null,
    provider_version: lock.provider_version || snap.provider_version || null,
    form_version: lock.form_version || snap.form_version || null,
    mapping_version: lock.mapping_version || snap.mapping_version || null,
    captured_at: lock.captured_at || app?.created_date || new Date().toISOString(),
  };
}
export function lockCompatible(lock: VersionLock, current: { intelligence_version?: string | null; provider_version?: string | null; form_version?: string | null; mapping_version?: string | null }): {
  intelligenceCompatible: boolean; providerCompatible: boolean; formCompatible: boolean; mappingCompatible: boolean;
} {
  return {
    intelligenceCompatible: !lock.intelligence_version || !current.intelligence_version || lock.intelligence_version === current.intelligence_version,
    providerCompatible: !lock.provider_version || !current.provider_version || lock.provider_version === current.provider_version,
    formCompatible: !lock.form_version || !current.form_version || lock.form_version === current.form_version,
    mappingCompatible: !lock.mapping_version || !current.mapping_version || lock.mapping_version === current.mapping_version,
  };
}

// ---------- Case revalidation (§9/§11/§22) ----------
export type RevalidationResult = "UNCHANGED" | "REVIEW_REQUIRED" | "ACTION_REQUIRED" | "EXECUTION_BLOCKED";
export function revalidationResultFor(args: {
  lock: VersionLock; currentVersionId: string | null; severityOfChange?: Severity; affectsExecution: boolean; caseState: string;
}): RevalidationResult {
  const drift = !!args.lock?.intelligence_version && args.currentVersionId != null && args.lock.intelligence_version !== args.currentVersionId;
  if (!drift) return "UNCHANGED";
  const sev = args.severityOfChange || "MEDIUM";
  const inExecution = ["READY_FOR_SUBMISSION", "SUBMISSION_PENDING", "SUBMITTED", "PROCESSING", "DOCUMENTS_REVIEW"].includes(args.caseState);
  if (sev === "CRITICAL" || (args.affectsExecution && inExecution && (sev === "HIGH" || sev === "CRITICAL"))) return "EXECUTION_BLOCKED";
  if (sev === "HIGH") return "ACTION_REQUIRED";
  if (sev === "MEDIUM") return "REVIEW_REQUIRED";
  return "UNCHANGED";
}

// ---------- Pre-submission revalidation block (§13/§24/§25/§26/§36) ----------
export function preSubmissionRevalidation(args: {
  lock: VersionLock; current: { intelligence_version?: string | null; provider_version?: string | null; form_version?: string | null; mapping_version?: string | null };
  routeAvailable: boolean; routeConfirmedCompatible: boolean;
}): { ok: boolean; block?: string; code?: string } {
  const compat = lockCompatible(args.lock, args.current);
  if (!compat.intelligenceCompatible) return { ok: false, block: "BLOCKED_BY_INTELLIGENCE_CHANGE", code: "INTELLIGENCE_VERSION_DRIFT" };
  if (!args.routeAvailable || !args.routeConfirmedCompatible) return { ok: false, block: "BLOCKED_BY_INTELLIGENCE_CHANGE", code: "ROUTE_NOT_COMPATIBLE" };
  if (!compat.providerCompatible) return { ok: false, block: "BLOCKED_BY_PROVIDER_SCHEMA_CHANGE", code: "PROVIDER_VERSION_INCOMPATIBLE" };
  if (!compat.formCompatible) return { ok: false, block: "BLOCKED_BY_PORTAL_SCHEMA_CHANGE", code: "FORM_VERSION_INCOMPATIBLE" };
  if (!compat.mappingCompatible) return { ok: false, block: "BLOCKED_BY_PORTAL_SCHEMA_CHANGE", code: "MAPPING_VERSION_INCOMPATIBLE" };
  return { ok: true };
}

// ---------- Provenance (§28/§34) ----------
export function buildProvenance(version: any, source: { name?: string; url?: string; type?: string } | null = null): any {
  return {
    data_version: version?.data_version || null,
    status: version?.status || null,
    source,
    source_version: version?.source_version || null,
    effective_from: version?.effective_from || null,
    published_at: version?.published_at || null,
    published_by: version?.published_by || null,
    approved_by: version?.approved_by || null,
    confidence: version?.confidence || "UNKNOWN",
    content_hash: version?.content_hash || null,
    previous_version_id: version?.previous_version_id || null,
  };
}

// ---------- Traveler-facing change notification (§29) ----------
export function buildChangeNotification(args: { severity: Severity; country: string; journey: string }): { title: string; message: string } {
  if (args.severity === "CRITICAL" || args.severity === "HIGH") {
    return {
      title: "Visa requirements changed",
      message: "Visa requirements for your destination have changed. Please review the updated requirements before continuing.",
    };
  }
  return { title: "Visa information updated", message: "Some visa details for your destination were updated. No action is required." };
}

// ---------- Authorization (§38/§44) ----------
export function canPublishVersion(role: string | null | undefined): boolean { return role === "admin"; }
export function canApproveVersion(role: string | null | undefined): boolean { return role === "admin"; }
export function intelligenceTaskIdempotencyKey(caseId: string, taskType: string): string { return `intel|${caseId}|${taskType}`; }