// Worldz Visa (Phase 11) — Execution adapter: MOCK API strategy (Japan eVisa,
// §51). A single executeStep drives the full API round-trip: validate → submit
// → receipt. The mock portal's submitTimeout behavior yields an indeterminate
// post-submit state → UNKNOWN_EXTERNAL_STATE (no auto-retry, §28).

import {
  openSession, getSession, submit, captureReceipt as portalReceipt, getStatus,
} from "../portal/mock_portal.ts";
import type {
  ExecutionProviderAdapter, ExecutionResult, ExecutionExecutionContext,
} from "../types.ts";

const KEY = "visa.exec.mock_api";

export const mockApiExecutionAdapter: ExecutionProviderAdapter = {
  key: KEY, displayName: "Mock Government API", strategy: "API",
  capabilities: ["EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK"],
  getCapabilities() { return ["EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK"]; },
  async init(_ctx: any, exec: ExecutionExecutionContext): Promise<ExecutionResult> {
    const s = openSession(exec.portalDefinition?.base_url || "https://api.mock-gov.example", exec.behaviors || {});
    s.otpVerified = true; s.captchaSolved = true; s.logged_in = true; // API key auth.
    return { success: true, status: "NAVIGATING", checkpoint: "PORTAL_OPENED", currentStep: "SUBMIT", done: false, response_metadata: { session_ref: s.ref } };
  },
  async executeStep(_ctx: any, exec: ExecutionExecutionContext): Promise<ExecutionResult> {
    const step = exec.session.current_step || "SUBMIT";
    const s = getSession(exec.session.execution_session_reference);
    if (!s) return { success: false, status: "FAILED", error_code: "SESSION_LOST", error_category: "PERMANENT" };
    if (step === "SUBMIT") {
      const r = submit(s);
      if (r.indeterminate) {
        return { success: false, status: "UNKNOWN_EXTERNAL_STATE", indeterminate: true, error_code: "SUBMIT_TIMEOUT", error_category: "UNKNOWN", done: false };
      }
      return { success: true, status: "COMPLETED", checkpoint: "SUBMITTED", externalReference: r.reference, currentStep: "CAPTURE_RECEIPT" };
    }
    if (step === "CAPTURE_RECEIPT") {
      const receipt = portalReceipt(s);
      return { success: true, status: "COMPLETED", checkpoint: "RECEIPT_CAPTURED", receipt, externalReference: s.externalReference || undefined, done: true };
    }
    return { success: false, status: "FAILED", error_code: "UNKNOWN_STEP", error_category: "PERMANENT" };
  },
  async getStatus(_ctx: any, ref: { external_reference: string }) {
    const st = getStatus(ref.external_reference);
    const done = st.status === "COMPLETED";
    return { success: true, status: done ? "COMPLETED" : "PROCESSING", done } as ExecutionResult;
  },
};