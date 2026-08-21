// Worldz Visa (Phase 19) — operations catalog: submission methods, the
// normalized-status map (§20), reference types (§18), and the configurable
// risk-scoring weights (§7). Pure config — no DB seeding. The risk model is
// intentionally an internal application-quality indicator and is framed
// everywhere as "submission quality", never a visa-approval probability.

export const SUBMISSION_METHODS = ["API", "PORTAL", "MANUAL", "EMAIL", "EMBASSY_APPOINTMENT", "OTHER"] as const;

export const EXTERNAL_REFERENCE_TYPES = [
  "GOVERNMENT_APPLICATION_ID",
  "EMBASSY_REFERENCE",
  "COURIER_TRACKING_ID",
  "APPOINTMENT_REFERENCE",
  "VFS_BATCH",
  "PROVIDER_REFERENCE",
] as const;

// Phase 19 §19: normalized internal tracking statuses. Provider raw text is
// preserved verbatim on TrackingEvent.raw_status and mapped to one of these.
export const NORMALIZED_STATUSES = [
  "SUBMITTED", "RECEIVED", "PROCESSING", "ADDITIONAL_INFORMATION_REQUIRED",
  "APPOINTMENT_REQUIRED", "BIOMETRICS_REQUIRED", "PASSPORT_REQUESTED",
  "DECISION_PENDING", "APPROVED", "REFUSED", "WITHDRAWN", "CANCELLED", "COMPLETED",
  "TRACKING_UNAVAILABLE",
] as const;

// Heuristic raw → normalized map (lowercased substring match). Adapters may
// override via normalizeStatus; this is the platform fallback (§20).
export const RAW_STATUS_PATTERNS: Array<{ re: RegExp; normalized: string }> = [
  { re: /approv|grant|issued|visa\s+ready/i, normalized: "APPROVED" },
  { re: /refus|reject|denied/i, normalized: "REFUSED" },
  { re: /withdraw/i, normalized: "WITHDRAWN" },
  { re: /cancel/i, normalized: "CANCELLED" },
  { re: /additional|more\s+info|rfe|request/i, normalized: "ADDITIONAL_INFORMATION_REQUIRED" },
  { re: /appoint|schedule/i, normalized: "APPOINTMENT_REQUIRED" },
  { re: /biometric|fingerprint/i, normalized: "BIOMETRICS_REQUIRED" },
  { re: /passport|collect|drop/i, normalized: "PASSPORT_REQUESTED" },
  { re: /receiv|acknowl/i, normalized: "RECEIVED" },
  { re: /process|under\s+consider|review|pending/i, normalized: "PROCESSING" },
  { re: /decision\s+pending/i, normalized: "DECISION_PENDING" },
];

export function fallbackNormalize(raw: string): string {
  if (!raw) return "PROCESSING";
  const r = String(raw).toLowerCase();
  for (const p of RAW_STATUS_PATTERNS) if (p.re.test(r)) return p.normalized;
  return "PROCESSING";
}

// Configurable risk-scoring weights (§7). Tunable without code change to the
// engine — the engine reads these.
export const RISK_WEIGHTS = {
  completeness: 40,
  documents: 25,
  consistency: 20,
  requirement_coverage: 15,
};

export const RISK_THRESHOLDS = {
  LOW: 85,
  MEDIUM: 60,
};

export function levelFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" {
  if (score == null || Number.isNaN(score)) return "UNKNOWN";
  if (score >= RISK_THRESHOLDS.LOW) return "LOW";
  if (score >= RISK_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "HIGH";
}

// Operations orchestrator task types (§30). Registered as resolvable task
// names against the existing orchestrator engine — NOT a second workflow engine.
export const OPERATIONS_TASK_TYPES = [
  "GENERATE_SUBMISSION_PACKAGE",
  "RUN_SUBMISSION_QC",
  "ASSIGN_APPLICATION_REVIEW",
  "REQUEST_APPLICANT_ACTION",
  "PREPARE_SUBMISSION",
  "SUBMIT_APPLICATION",
  "CONFIRM_SUBMISSION",
  "CHECK_APPLICATION_STATUS",
  "PROCESS_TRACKING_UPDATE",
  "PROCESS_DECISION",
] as const;

// Reviewer actions (§11) — canonical action codes.
export const REVIEWER_ACTIONS = [
  "ASSIGNED", "REVIEW_STARTED", "REQUEST_INFO", "REQUEST_DOCUMENT", "FLAG_ISSUE",
  "REJECT_PACKAGE", "RETURN_TO_APPLICANT", "ESCALATE", "APPROVE_FOR_SUBMISSION",
  "QC_RUN", "SUBMISSION_STARTED", "SUBMISSION_CONFIRMED", "TRACKING_UPDATED",
  "DECISION_RECEIVED", "CASE_CANCELLED",
] as const;