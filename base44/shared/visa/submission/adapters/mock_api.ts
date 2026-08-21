// Worldz Visa (Phase 8) — MockGovernmentApiProvider.
//
// A deterministic FAKE government API for automated integration tests (§38/§39).
// Supports VALIDATE, CREATE_DRAFT, SUBMIT, STATUS, RECEIPT, CANCEL, DOCUMENT_UPLOAD.
//
// Determinism: the external reference is djb2(idempotency_key) — calling submit()
// twice with the same key yields the SAME reference (idempotency). Status derives
// deterministically from the elapsed time since submitted_at (SUBMITTED →
// PROCESSING → COMPLETED), so no cross-invocation state is needed.
//
// Failure modes (§39) are selected by ctx.adapterConfig.scenario:
//   timeout | auth_failure | invalid_package | duplicate | unavailable |
//   rate_limit | rejected | processing_delay | ok
// The engine dedups by idempotency_key BEFORE calling submit(), so "duplicate" is
// exercised via direct adapter calls in the contract suite.

import type { ProviderContext } from "../../../providers/types.ts";
import type { SubmissionContract, SubmissionProviderAdapter, SubmissionResult } from "../types.ts";
import { djb2 } from "../../../operations/idempotency.ts";

function refOf(contract: SubmissionContract): string {
  return `MOCK-${djb2(contract.idempotency_key).slice(0, 12).toUpperCase()}`;
}

function fail(scenario: string): SubmissionResult {
  switch (scenario) {
    case "timeout": return { success: false, status: "FAILED", error_code: "TIMEOUT", error_message: "Simulated provider timeout", error_category: "TRANSIENT", retryable: true };
    case "auth_failure": return { success: false, status: "FAILED", error_code: "AUTH_FAILURE", error_message: "Simulated auth failure", error_category: "REQUIRES_OPERATOR", retryable: false };
    case "invalid_package": return { success: false, status: "FAILED", error_code: "INVALID_PACKAGE", error_message: "Simulated invalid package", error_category: "PERMANENT", retryable: false };
    case "unavailable": return { success: false, status: "FAILED", error_code: "PROVIDER_UNAVAILABLE", error_message: "Simulated provider unavailable", error_category: "TRANSIENT", retryable: true };
    case "rate_limit": return { success: false, status: "FAILED", error_code: "RATE_LIMIT", error_message: "Simulated rate limit", error_category: "TRANSIENT", retryable: true };
    case "rejected": return { success: true, status: "REJECTED", external_reference: "MOCK-REJECTED", error_code: "REJECTED", error_message: "Simulated external rejection", error_category: "PERMANENT", retryable: false, response_metadata: { mock: true } };
    default: return { success: false, status: "FAILED", error_code: "UNKNOWN", error_message: "Simulated unknown failure", error_category: "UNKNOWN", retryable: false };
  }
}

function scenarioOf(ctx: ProviderContext): string {
  return String((ctx.adapterConfig as any)?.scenario || "ok");
}

// Deterministic status from elapsed time since submission.
function statusFromAge(submittedAt?: string): "SUBMITTED" | "PROCESSING" | "COMPLETED" {
  if (!submittedAt) return "SUBMITTED";
  const t = new Date(submittedAt).getTime();
  if (Number.isNaN(t)) return "SUBMITTED";
  const ageSec = (Date.now() - t) / 1000;
  if (ageSec < 1) return "SUBMITTED";
  if (ageSec < 4) return "PROCESSING";
  return "COMPLETED";
}

export const MockGovernmentApiProvider: SubmissionProviderAdapter = {
  key: "visa_submission_mock_api",
  displayName: "Mock Government API (sandbox)",
  providerType: "GOVERNMENT_API",
  capabilities: ["VALIDATE", "CREATE_DRAFT", "SUBMIT", "STATUS", "RECEIPT", "CANCEL", "DOCUMENT_UPLOAD"],

  getCapabilities(_ctx: ProviderContext) {
    return ["VALIDATE", "CREATE_DRAFT", "SUBMIT", "STATUS", "RECEIPT", "CANCEL", "DOCUMENT_UPLOAD"];
  },

  async validatePackage(_ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    if (!contract.form_snapshot_id) return { success: false, error_code: "INVALID_PACKAGE", error_message: "Form snapshot required", error_category: "PERMANENT", retryable: false };
    if (!contract.package_hash) return { success: false, error_code: "INVALID_PACKAGE", error_message: "Package hash required", error_category: "PERMANENT", retryable: false };
    return { success: true, status: "READY", response_metadata: { mock: true, validated: true, document_count: contract.documents.length } };
  },

  async createSubmission(ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    const sc = scenarioOf(ctx);
    if (sc !== "ok" && sc !== "duplicate" && sc !== "rejected") return fail(sc);
    return { success: true, status: "READY", provider_reference: `MOCK-DRAFT-${refOf(contract)}`, response_metadata: { mock: true, draft: true } };
  },

  async submit(ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    const sc = scenarioOf(ctx);
    // "duplicate" at the adapter level (engine dedups first in production):
    if (sc === "duplicate") return { success: true, status: "SUBMITTED", external_reference: refOf(contract), response_metadata: { mock: true, duplicate_detected: true } };
    if (sc === "rejected") return { success: true, status: "REJECTED", external_reference: refOf(contract), error_code: "REJECTED", error_message: "Simulated external rejection", error_category: "PERMANENT", retryable: false, response_metadata: { mock: true } };
    if (sc === "processing_delay") { await new Promise((r) => setTimeout(r, 50)); }
    if (sc !== "ok" && sc !== "processing_delay") return fail(sc);
    return { success: true, status: "SUBMITTED", external_reference: refOf(contract), external_application_id: `JP-EVISA-${refOf(contract).slice(5)}`, response_metadata: { mock: true, portal: "mock_japan_evisa" } };
  },

  async getStatus(_ctx: ProviderContext, ref: { external_reference: string; submission_id?: string; submitted_at?: string }): Promise<SubmissionResult> {
    if (!ref.external_reference) return { success: true, status: "SUBMITTING", response_metadata: { mock: true } };
    const status = statusFromAge(ref.submitted_at);
    return { success: true, status, external_reference: ref.external_reference, response_metadata: { mock: true } };
  },

  async getReceipt(ctx: ProviderContext, ref: { external_reference: string; submission_id?: string }): Promise<SubmissionResult> {
    if (scenarioOf(ctx) !== "ok" && scenarioOf(ctx) !== "duplicate") {
      if (!ref.external_reference) return { success: false, error_code: "NOT_READY", error_message: "No receipt yet", error_category: "TRANSIENT", retryable: true };
    }
    if (!ref.external_reference) return { success: false, error_code: "NOT_SUBMITTED", error_message: "Submission not submitted", error_category: "PERMANENT", retryable: false };
    return { success: true, status: "COMPLETED", external_reference: ref.external_reference, receipt: { url: `mock://receipt/${ref.external_reference}`, mime_type: "application/pdf" }, response_metadata: { mock: true } };
  },

  async cancel(_ctx: ProviderContext, ref: { external_reference: string; submission_id?: string }): Promise<SubmissionResult> {
    return { success: true, status: "CANCELLED", external_reference: ref.external_reference, response_metadata: { mock: true } };
  },

  async health(_ctx: ProviderContext) {
    return { success: true, provider: { providerId: "mock", key: "visa_submission_mock_api", category: "submission" }, operation: "health", request_id: _ctx.requestId, data: { status: "healthy" } };
  },
};