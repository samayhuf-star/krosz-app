// Worldz Visa (Phase 8) — ManualSubmissionProvider.
//
// The first REAL provider. Makes Phase 8 operational before any portal
// automation exists (§10/§25). Capabilities: VALIDATE, CREATE_DRAFT, STATUS.
// No automatic external submission. Flow:
//   Application Ready → (operator submits externally) → operator enters
//   external reference → receipt uploaded → Submission = SUBMITTED.
//
// submit() never calls an external portal: it returns ACTION_REQUIRED so the
// engine creates an operator task and waits for enterExternalReference.

import type { ProviderContext } from "../../../providers/types.ts";
import type { SubmissionContract, SubmissionProviderAdapter, SubmissionResult } from "../types.ts";

function ok(ctx: ProviderContext): SubmissionResult {
  return { success: true, status: "READY", response_metadata: { provider_type: "MANUAL_OPERATOR" }, external_reference: ctx.requestId };
}

export const ManualSubmissionProvider: SubmissionProviderAdapter = {
  key: "visa_submission_manual",
  displayName: "Manual Operator Submission",
  providerType: "MANUAL_OPERATOR",
  capabilities: ["VALIDATE", "CREATE_DRAFT", "STATUS"],

  getCapabilities(_ctx: ProviderContext) {
    return ["VALIDATE", "CREATE_DRAFT", "STATUS"];
  },

  async validatePackage(_ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    if (!contract.form_snapshot_id) return { success: false, error_code: "INVALID_PACKAGE", error_message: "Form snapshot is required", error_category: "PERMANENT", retryable: false };
    if (!contract.package_hash) return { success: false, error_code: "INVALID_PACKAGE", error_message: "Package hash is required", error_category: "PERMANENT", retryable: false };
    if (!contract.documents || contract.documents.length === 0) return { success: false, error_code: "INVALID_PACKAGE", error_message: "At least one document is required", error_category: "PERMANENT", retryable: false };
    return { success: true, status: "READY", response_metadata: { validated: true, document_count: contract.documents.length } };
  },

  async createSubmission(ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    // Manual providers create an internal "draft" — the operator will submit
    // externally. No external id is minted yet.
    const draftRef = `MANUAL-DRAFT-${contract.idempotency_key.slice(-10).toUpperCase()}`;
    return { success: true, status: "READY", external_reference: null, provider_reference: draftRef, response_metadata: { manual: true, draft: true } };
  },

  async submit(ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    // No external submission. Surface the operator action that must happen.
    return {
      success: true,
      status: "ACTION_REQUIRED",
      external_reference: null,
      provider_reference: `MANUAL-PENDING-${contract.idempotency_key.slice(-8).toUpperCase()}`,
      response_metadata: {
        manual: true,
        operator_action: "submit_externally_and_enter_reference",
        instructions: "Submit the printed package at the visa application center, then enter the stamped reference number and upload the receipt.",
      },
    };
  },

  async getStatus(_ctx: ProviderContext, ref: { external_reference: string; submission_id?: string; submitted_at?: string }): Promise<SubmissionResult> {
    // Manual status is whatever the operator last recorded; without an external
    // reference the submission is still awaiting operator completion.
    if (!ref.external_reference) return { success: true, status: "ACTION_REQUIRED", response_metadata: { manual: true } };
    // Once an external reference exists, the operator will drive further status
    // transitions manually; default to PROCESSING.
    return { success: true, status: "PROCESSING", external_reference: ref.external_reference, response_metadata: { manual: true } };
  },
};