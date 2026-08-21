// Worldz Visa (Phase 8) — Submission Provider / Portal Adapter architecture.
//
// Provider-neutral submission layer. The VisaApplication, SubmissionPackage,
// GovernmentForm, requirements, documents, answers, and the orchestrator core
// are NEVER changed by a provider. A provider owns ONLY external-system
// interaction and returns a normalized SubmissionResult.
//
// Invariants (spec §§1-57):
//   - Provider selection is DETERMINISTIC (route + capabilities + priority). No LLM.
//   - Submission is DANGEROUS: submit() is idempotent by
//     application_id + package_hash + provider_id. Calling twice must NOT create
//     two external submissions.
//   - Package integrity is verified BEFORE submit: stored package_hash must equal
//     the recomputed hash. A stale (answer/document/form changed) package blocks
//     submission until regenerated.
//   - Manual submission never touches an external portal: the operator submits
//     externally, then enters the external reference + uploads a receipt.
//   - Credentials are NEVER stored in Submission/Task; they live in
//     ProviderCredential (platform secrets) and are injected into ProviderContext.
//   - Provider result payloads are normalized; full external payloads are NOT
//     stored if they carry unnecessary PII.

import type { ProviderContext, ProviderResult } from "../../providers/types.ts";

// ---------- Capabilities (§4) ----------
export type SubmissionCapability =
  | "VALIDATE"
  | "CREATE_DRAFT"
  | "SUBMIT"
  | "STATUS"
  | "RECEIPT"
  | "CANCEL"
  | "APPOINTMENT"
  | "PAYMENT"
  | "DOCUMENT_UPLOAD";

export const ALL_CAPABILITIES: SubmissionCapability[] = [
  "VALIDATE", "CREATE_DRAFT", "SUBMIT", "STATUS", "RECEIPT",
  "CANCEL", "APPOINTMENT", "PAYMENT", "DOCUMENT_UPLOAD",
];

// ---------- Provider types (§5): categories, not hard-coded implementations ----------
export type ProviderType =
  | "GOVERNMENT_API"
  | "VISA_CENTER_API"
  | "EMBASSY"
  | "CONSULATE"
  | "MANUAL_OPERATOR"
  | "EMAIL"
  | "BROWSER_AUTOMATION"
  | "AGENT";

// ---------- Submission state machine (§13/§22) ----------
export type SubmissionStatus =
  | "CREATED"
  | "VALIDATING"
  | "READY"
  | "SUBMITTING"
  | "SUBMITTED"
  | "PROCESSING"
  | "ACTION_REQUIRED"
  | "COMPLETED"
  | "REJECTED"
  | "FAILED"
  | "CANCELLED";

export const SUBMISSION_STATUSES: SubmissionStatus[] = [
  "CREATED", "VALIDATING", "READY", "SUBMITTING", "SUBMITTED",
  "PROCESSING", "ACTION_REQUIRED", "COMPLETED", "REJECTED", "FAILED", "CANCELLED",
];

// Terminal statuses — no further automatic transitions.
export const TERMINAL_STATUSES: SubmissionStatus[] = ["COMPLETED", "REJECTED", "FAILED", "CANCELLED"];

// ---------- Error categories (§40) ----------
export type ErrorCategory = "TRANSIENT" | "PERMANENT" | "REQUIRES_USER" | "REQUIRES_OPERATOR" | "UNKNOWN";

export function categorizeError(errorCode?: string, retryable?: boolean): ErrorCategory {
  const c = String(errorCode || "").toUpperCase();
  if (!c) return retryable ? "TRANSIENT" : "UNKNOWN";
  // Transient: timeouts / rate limits / provider unavailable — safe to retry.
  if (["TIMEOUT", "PROVIDER_TIMEOUT", "RATE_LIMIT", "PROVIDER_UNAVAILABLE", "NETWORK", "5XX", "503", "502", "504"].includes(c)) return "TRANSIENT";
  // Requires operator: credential / config issues only an operator can fix.
  if (["AUTH_FAILURE", "EXPIRED_CREDENTIAL", "INVALID_KEY", "NO_CREDENTIALS", "UNAUTHORIZED", "CONFIG_ERROR"].includes(c)) return "REQUIRES_OPERATOR";
  // Requires user: payment / additional info the applicant must supply.
  if (["PAYMENT_REQUIRED", "ADDITIONAL_INFO_REQUIRED", "APPOINTMENT_REQUIRED"].includes(c)) return "REQUIRES_USER";
  // Permanent: invalid package / duplicate / rejected by provider — do not retry.
  if (["INVALID_PACKAGE", "DUPLICATE_SUBMISSION", "PERMANENT", "REJECTED", "BAD_REQUEST", "FORM_VALIDATION_FAILED"].includes(c)) return "PERMANENT";
  return retryable ? "TRANSIENT" : "UNKNOWN";
}

// ---------- Normalized submission contract (§11): all a provider needs ----------
export interface SubmissionContract {
  application_id: string;
  package_id: string;
  provider_id: string;
  provider_key: string;
  form_snapshot_id: string;
  form_code: string;
  form_version: string;
  package_hash: string;
  documents: { document_id: string; document_version_id: string; document_type: string; label?: string }[];
  idempotency_key: string;
  environment: "sandbox" | "production";
  submission_id?: string;
  // Optional live submission state passed back to the provider on status polls.
  submitted_at?: string;
  external_reference?: string;
}

// ---------- Normalized provider result (§12) ----------
export interface SubmissionResult {
  success: boolean;
  external_reference?: string;
  external_application_id?: string;
  provider_reference?: string;
  status?: SubmissionStatus;
  receipt?: { document_id?: string; url?: string; mime_type?: string };
  error_code?: string;
  error_message?: string;
  error_category?: ErrorCategory;
  retryable?: boolean;
  // Provider-specific response data kept SEPARATE (never full PII payloads).
  response_metadata?: Record<string, any>;
}

// ---------- Submission provider adapter contract (§3) ----------
// Extends the existing ProviderAdapter (so it lives in the SAME provider
// registry + reuses ProviderContext/ProviderResult/credentials). The submission
// ops are additive; providers implement only the capabilities they advertise.
export interface SubmissionProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly providerType: ProviderType;
  readonly capabilities: SubmissionCapability[];
  getCapabilities(ctx: ProviderContext): SubmissionCapability[];
  validatePackage(ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult>;
  createSubmission(ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult>;
  submit(ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult>;
  getStatus?(ctx: ProviderContext, ref: { external_reference: string; submission_id?: string; submitted_at?: string }): Promise<SubmissionResult>;
  getReceipt?(ctx: ProviderContext, ref: { external_reference: string; submission_id?: string }): Promise<SubmissionResult>;
  cancel?(ctx: ProviderContext, ref: { external_reference: string; submission_id?: string }): Promise<SubmissionResult>;
  // adapter health (reuses the circuit-breaker pattern; never exposes secrets)
  health?(ctx: ProviderContext): Promise<ProviderResult<{ status: string }>>;
}

// ---------- Status normalization (§17) ----------
// Maps provider-specific status strings to the canonical SubmissionStatus.
const STATUS_MAP: { match: RegExp; to: SubmissionStatus }[] = [
  { match: /^(received|submitted|lodged|accepted)$/i, to: "SUBMITTED" },
  { match: /^(pending|under review|in review|processing|under process|in progress)$/i, to: "PROCESSING" },
  { match: /(action required|additional info|docs? required|awaiting)/i, to: "ACTION_REQUIRED" },
  { match: /^(approved|granted|completed|issued|finalized|decision)$/i, to: "COMPLETED" },
  { match: /^(rejected|refused|denied)$/i, to: "REJECTED" },
  { match: /^(cancelled|withdrawn|void)$/i, to: "CANCELLED" },
  { match: /^(failed|error)$/i, to: "FAILED" },
];

export function normalizeStatus(raw: any, fallback: SubmissionStatus = "PROCESSING"): SubmissionStatus {
  if (!raw) return fallback;
  const s = String(raw);
  if (SUBMISSION_STATUSES.includes(s as SubmissionStatus)) return s as SubmissionStatus;
  for (const m of STATUS_MAP) if (m.match.test(s)) return m.to;
  return fallback;
}

// ---------- Idempotency (§21) ----------
import { djb2, stable } from "../../operations/idempotency.ts";

export function submissionIdempotencyKey(applicationId: string, packageHash: string, providerId: string): string {
  return `submission|${applicationId}|${packageHash}|${providerId}|${djb2(stable({ applicationId, packageHash, providerId }))}`;
}