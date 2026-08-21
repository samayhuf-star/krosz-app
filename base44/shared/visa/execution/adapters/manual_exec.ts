// Worldz Visa (Phase 11) — Execution adapter: MANUAL / HUMAN_ASSISTED strategy.
//
// The adapter does NOT drive an external portal. It opens a logical session and
// immediately pauses for a human operator to complete the submission
// externally, then enters the external reference + uploads the receipt via the
// existing Phase 8 manual helpers. The engine records the confirmation/receipt
// and transitions the session to COMPLETED. This is the strategy for portals that
// do not permit automation (§22) and for embassy/consulate manual workflows.

import { openSession } from "../portal/mock_portal.ts";
import type {
  ExecutionProviderAdapter, ExecutionResult, ExecutionExecutionContext,
  SessionStatus,
} from "../types.ts";

const KEY = "visa.exec.manual";

export const manualExecutionAdapter: ExecutionProviderAdapter = {
  key: KEY, displayName: "Manual/Human-Assisted Submission", strategy: "MANUAL",
  capabilities: ["HUMAN_HANDOFF", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK"],
  getCapabilities() { return ["HUMAN_HANDOFF", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK"]; },
  async init(_ctx: any, exec: ExecutionExecutionContext): Promise<ExecutionResult> {
    const s = openSession(exec.portalDefinition?.base_url || "https://portal.manual.example", exec.behaviors || {});
    return {
      success: true, status: "NAVIGATING" as SessionStatus, checkpoint: "PORTAL_OPENED",
      currentStep: "SUBMIT", done: false, response_metadata: { session_ref: s.ref },
    };
  },
  async executeStep(_ctx: any, exec: ExecutionExecutionContext): Promise<ExecutionResult> {
    const step = exec.session.current_step || "SUBMIT";
    if (step === "SUBMIT") {
      // Always pause: a human must complete the external submission and enter the
      // reference + receipt (resolves via Phase 8 enterExternalReference/uploadReceipt).
      return {
        success: false, status: "WAITING_FOR_USER" as SessionStatus, requiresHuman: true,
        humanReason: "MANUAL_REVIEW", humanInstructions: "Complete the submission externally, then enter the reference and upload the receipt.",
        error_code: "MANUAL_REVIEW", error_category: "HUMAN_REQUIRED", retryable: false, currentStep: "SUBMIT",
      };
    }
    if (step === "CAPTURE_RECEIPT") {
      return { success: true, status: "COMPLETED" as SessionStatus, checkpoint: "RECEIPT_CAPTURED", done: true };
    }
    return { success: false, status: "FAILED" as SessionStatus, error_code: "UNKNOWN_STEP", error_category: "PERMANENT" };
  },
  async cancel() { return { success: true, status: "CANCELLED" as SessionStatus, done: true } as ExecutionResult; },
};