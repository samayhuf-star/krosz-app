// Worldz Visa (Phase 33) — Unified Provider Execution Adapter contract.
//
// Wraps the EXISTING adapters (SubmissionProviderAdapter for API providers +
// ExecutionProviderAdapter for portal/browser automation) behind ONE uniform
// capability surface used by the execution store. It does NOT replace the
// existing submission/execution adapter registries (§1 — no duplicate provider
// architecture). Unsupported methods return CAPABILITY_NOT_SUPPORTED, never
// fake success (§9).
//
// Capabilities (§4): INTELLIGENCE, ELIGIBILITY, REQUIREMENTS, APPLICATION_CREATE,
// APPLICATION_UPDATE, DOCUMENT_UPLOAD, PAYMENT, SUBMISSION, STATUS, TRACKING,
// CANCELLATION, REFUND. A provider may support some but not all.

import type { SubmissionProviderAdapter, SubmissionResult, SubmissionContract } from "../submission/types.ts";
import type { ExecutionProviderAdapter } from "./types.ts";
import { normalizeStatus as normalizeSubmissionStatus } from "../submission/types.ts";
import { normalizeProviderStatus } from "../application/caseEngine.ts";

export type ProviderCapability =
  | "INTELLIGENCE" | "ELIGIBILITY" | "REQUIREMENTS" | "APPLICATION_CREATE" | "APPLICATION_UPDATE"
  | "DOCUMENT_UPLOAD" | "PAYMENT" | "SUBMISSION" | "STATUS" | "TRACKING" | "CANCELLATION" | "REFUND";

export const CAPABILITY_NOT_SUPPORTED = "CAPABILITY_NOT_SUPPORTED";
export const CAPABILITY_NOT_SUPPORTED_RESULT = { ok: false, capability_supported: false, error_code: CAPABILITY_NOT_SUPPORTED, error_message: "Capability not supported by this provider" } as const;

export interface ExecutionAttemptInput {
  case_id: string;
  operation: "CREATE_APPLICATION" | "UPDATE_APPLICATION" | "UPLOAD_DOCUMENT" | "SUBMIT" | "STATUS" | "CANCEL" | "REFUND";
  idempotency_key: string;
  environment: "SANDBOX" | "PRODUCTION";
  external_reference?: string;
  dry_run?: boolean;
  documents?: { document_type: string; storage_uri: string }[];
  form_snapshot?: any;
}

export interface ExecutionAttemptOutput {
  ok: boolean;
  capability_supported: boolean;
  external_reference?: string;
  provider_application_id?: string;
  normalized_status?: string; // provider.output -> case-state-normalized
  raw_status?: string;
  receipt?: { url?: string; mime_type?: string };
  error_code?: string;
  error_message?: string;
  retryable?: boolean;
  response_metadata?: Record<string, any>;
}

export interface ProviderExecutionAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly kind: "API" | "PORTAL" | "MANUAL" | "MOCK";
  getCapabilities(): ProviderCapability[];
  checkAvailability(): Promise<{ available: boolean; latency_ms?: number; reason?: string }>;
  createApplication(input: ExecutionAttemptInput): Promise<ExecutionAttemptOutput>;
  updateApplication?(input: ExecutionAttemptInput): Promise<ExecutionAttemptOutput>;
  uploadDocument?(input: ExecutionAttemptInput): Promise<ExecutionAttemptOutput>;
  submitApplication?(input: ExecutionAttemptInput): Promise<ExecutionAttemptOutput>;
  getApplicationStatus?(input: ExecutionAttemptInput): Promise<ExecutionAttemptOutput>;
  cancelApplication?(input: ExecutionAttemptInput): Promise<ExecutionAttemptOutput>;
  refundApplication?(input: ExecutionAttemptInput): Promise<ExecutionAttemptOutput>;
  normalizeStatus(raw: string): { normalized: string; raw: string };
  handleWebhook(payload: any): Promise<{ normalized: string; raw: string; external_reference?: string; idempotency_key?: string } | { error: string }>;
}

// Wrap an existing SubmissionProviderAdapter (API/government provider) into the
// uniform execution adapter. Only the submission adapter's supported methods are
// exposed; the rest return CAPABILITY_NOT_SUPPORTED.
export function wrapSubmissionAdapter(sub: SubmissionProviderAdapter): ProviderExecutionAdapter {
  const caps = sub.getCapabilities({} as any) || [];
  const has = (c: string) => caps.includes(c);
  const declared: ProviderCapability[] = [];
  if (has("VALIDATE")) declared.push("REQUIREMENTS");
  if (has("CREATE_DRAFT")) declared.push("APPLICATION_CREATE", "APPLICATION_UPDATE");
  if (has("SUBMIT")) declared.push("SUBMISSION");
  if (has("STATUS")) declared.push("STATUS", "TRACKING");
  if (has("DOCUMENT_UPLOAD")) declared.push("DOCUMENT_UPLOAD");
  if (has("PAYMENT")) declared.push("PAYMENT");
  if (has("CANCEL")) declared.push("CANCELLATION");
  if (has("RECEIPT")) declared.push("STATUS");

  const ctx = {} as any;
  function contractFromInput(input: ExecutionAttemptInput): SubmissionContract {
    return {
      application_id: input.case_id, package_id: "", provider_id: sub.key, provider_key: sub.key,
      form_snapshot_id: "", form_code: "", form_version: "", package_hash: "",
      documents: (input.documents || []).map((d) => ({ document_id: "", document_version_id: "", document_type: d.document_type })),
      idempotency_key: input.idempotency_key, environment: input.environment === "SANDBOX" ? "sandbox" : "production",
      external_reference: input.external_reference,
    } as SubmissionContract;
  }
  function out(r: SubmissionResult): ExecutionAttemptOutput {
    return {
      ok: !!r.success, capability_supported: true,
      external_reference: r.external_reference || r.provider_reference,
      provider_application_id: r.external_application_id,
      normalized_status: r.status ? providerStatusToCaseState(r.status) : undefined,
      raw_status: r.status as any,
      receipt: r.receipt as any,
      error_code: r.error_code, error_message: r.error_message, retryable: r.retryable,
      response_metadata: r.response_metadata,
    };
  }
  return {
    key: sub.key, displayName: sub.displayName, kind: "API",
    getCapabilities: () => declared,
    checkAvailability: async () => (sub.health ? sub.health(ctx).then((h) => ({ available: h.ok, reason: h.error || undefined })).catch(() => ({ available: false })) : { available: true }),
    createApplication: async (input) => has("CREATE_DRAFT") ? out(await sub.createSubmission(ctx, contractFromInput(input))) : { ...CAPABILITY_NOT_SUPPORTED_RESULT },
    submitApplication: async (input) => has("SUBMIT") ? out(await sub.submit(ctx, contractFromInput(input))) : { ...CAPABILITY_NOT_SUPPORTED_RESULT },
    getApplicationStatus: async (input) => has("STATUS") && sub.getStatus ? out(await sub.getStatus(ctx, { external_reference: input.external_reference || "" })) : { ...CAPABILITY_NOT_SUPPORTED_RESULT },
    uploadDocument: async (input) => has("DOCUMENT_UPLOAD") ? out(await sub.createSubmission(ctx, contractFromInput(input))) : { ...CAPABILITY_NOT_SUPPORTED_RESULT },
    cancelApplication: async (input) => has("CANCEL") && sub.cancel ? out(await sub.cancel(ctx, { external_reference: input.external_reference || "" })) : { ...CAPABILITY_NOT_SUPPORTED_RESULT },
    normalizeStatus: (raw) => ({ normalized: providerStatusToCaseState(raw), raw }),
    handleWebhook: async (payload) => {
      const raw = String(payload?.status || payload?.event || "UNKNOWN");
      const normalized = providerStatusToCaseState(raw);
      return { normalized, raw, external_reference: payload?.external_reference || payload?.reference, idempotency_key: payload?.idempotency_key };
    },
  };
}

// Wrap an existing portal/browser ExecutionProviderAdapter (Phase 11) into the
// uniform execution adapter. Portal execution never offers direct API submission;
// it produces SUBMISSION via the browser flow (kept out of this contract's
// synchronous surface — the existing engine orchestrates portal runs).
export function wrapPortalAdapter(ex: ExecutionProviderAdapter): ProviderExecutionAdapter {
  return {
    key: ex.key, displayName: ex.displayName, kind: "PORTAL",
    getCapabilities: () => ["BROWSER_NAVIGATION", "FORM_FILLING", "DOCUMENT_UPLOAD", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK"] as any,
    checkAvailability: async () => (ex.health ? ex.health({} as any).then((h) => ({ available: h.ok })).catch(() => ({ available: false })) : { available: true }),
    createApplication: async () => ({ ...CAPABILITY_NOT_SUPPORTED_RESULT }),
    submitApplication: async () => ({ ...CAPABILITY_NOT_SUPPORTED_RESULT }), // portal submit is async via the execution engine
    normalizeStatus: (raw) => ({ normalized: providerStatusToCaseState(raw), raw }),
    handleWebhook: async () => ({ error: "portal adapters do not receive webhooks" }),
  };
}

// A mock API adapter for tests (§41 critical: never executes real submissions).
export function createMockProviderAdapter(opts: { key?: string; capabilities?: ProviderCapability[]; behavior?: Record<string, any> } = {}): ProviderExecutionAdapter {
  const key = opts.key || "MOCK_PROVIDER";
  const caps = opts.capabilities || ["APPLICATION_CREATE", "DOCUMENT_UPLOAD", "SUBMISSION", "STATUS", "TRACKING", "CANCELLATION"];
  const beh = opts.behavior || {};
  return {
    key, displayName: `Mock ${key}`, kind: "MOCK",
    getCapabilities: () => caps,
    checkAvailability: async () => ({ available: beh.unavailable !== true, latency_ms: 12 }),
    createApplication: async (input) => {
      if (!caps.includes("APPLICATION_CREATE")) return { ...CAPABILITY_NOT_SUPPORTED_RESULT };
      if (input.dry_run) return { ok: true, capability_supported: true, external_reference: `DRY_${input.case_id}`, provider_application_id: `DRY_${input.case_id}` };
      return { ok: true, capability_supported: true, external_reference: `${key}-APP-${input.case_id.slice(-6)}`, provider_application_id: `${key}-APP-${input.case_id.slice(-6)}` };
    },
    uploadDocument: async (input) => {
      if (!caps.includes("DOCUMENT_UPLOAD")) return { ...CAPABILITY_NOT_SUPPORTED_RESULT };
      return { ok: true, capability_supported: true, external_reference: `${key}-DOC-${(input.documents || []).length}` };
    },
    submitApplication: async (input) => {
      if (!caps.includes("SUBMISSION")) return { ...CAPABILITY_NOT_SUPPORTED_RESULT };
      if (input.dry_run) return { ok: true, capability_supported: true, external_reference: `DRY_SUB_${input.case_id}`, normalized_status: "SUBMITTED", raw_status: "SUBMITTED" };
      if (beh.submitFails) return { ok: false, capability_supported: true, error_code: beh.submitFails, error_message: "mock failure", retryable: beh.submitFails === "TIMEOUT" };
      return { ok: true, capability_supported: true, external_reference: `${key}-SUB-${input.case_id.slice(-6)}`, provider_application_id: `${key}-APP-${input.case_id.slice(-6)}`, normalized_status: "SUBMITTED", raw_status: "SUBMITTED", receipt: { url: `https://mock/${key}/receipt.pdf`, mime_type: "application/pdf" } };
    },
    getApplicationStatus: async (input) => {
      if (!caps.includes("STATUS")) return { ...CAPABILITY_NOT_SUPPORTED_RESULT };
      const raw = beh.status || "PROCESSING";
      return { ok: true, capability_supported: true, external_reference: input.external_reference, normalized_status: providerStatusToCaseState(raw), raw_status: raw };
    },
    cancelApplication: async (input) => {
      if (!caps.includes("CANCELLATION")) return { ...CAPABILITY_NOT_SUPPORTED_RESULT };
      return { ok: true, capability_supported: true, external_reference: input.external_reference, normalized_status: "CANCELLED", raw_status: "CANCELLED" };
    },
    normalizeStatus: (raw) => ({ normalized: providerStatusToCaseState(raw), raw }),
    handleWebhook: async (payload) => {
      const raw = String(payload?.status || "PROCESSING");
      return { normalized: providerStatusToCaseState(raw), raw, external_reference: payload?.external_reference, idempotency_key: payload?.idempotency_key };
    },
  };
}

// Provider raw status -> authoritative case state (§18). Reuses the Phase 27
// caseEngine normalizer so normalization stays single-source. Provider-specific
// overrides can extend this map without bypassing it.
export function providerStatusToCaseState(raw: string): string {
  const n = normalizeProviderStatus(raw);
  return n.normalized || "PROCESSING";
}

export { normalizeSubmissionStatus };