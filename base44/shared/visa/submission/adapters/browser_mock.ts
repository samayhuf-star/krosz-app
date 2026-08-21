// Worldz Visa (Phase 8) — BrowserAutomationProvider (interface + mock/sandbox only).
//
// Per §32: create the interface only; implement a mock/sandbox adapter. Do NOT
// automate real government portals in Phase 8. The adapter is registered so the
// admin UI + contract suite can exercise it, but NO route fixture references it,
// so it is never selected for a real submission by default.

import type { ProviderContext } from "../../../providers/types.ts";
import type { SubmissionContract, SubmissionProviderAdapter, SubmissionResult } from "../types.ts";
import { djb2 } from "../../../operations/idempotency.ts";

function refOf(contract: SubmissionContract): string {
  return `BROWSER-${djb2(contract.idempotency_key).slice(0, 10).toUpperCase()}`;
}

export const BrowserAutomationProvider: SubmissionProviderAdapter = {
  key: "visa_submission_browser_mock",
  displayName: "Browser Automation (mock/sandbox)",
  providerType: "BROWSER_AUTOMATION",
  capabilities: ["CREATE_DRAFT", "SUBMIT", "STATUS"],

  getCapabilities(_ctx: ProviderContext) {
    return ["CREATE_DRAFT", "SUBMIT", "STATUS"];
  },

  async validatePackage(_ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    if (!contract.form_snapshot_id) return { success: false, error_code: "INVALID_PACKAGE", error_message: "Form snapshot required", error_category: "PERMANENT", retryable: false };
    return { success: true, status: "READY", response_metadata: { mock: true, browser: true } };
  },

  async createSubmission(_ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    return { success: true, status: "READY", provider_reference: `BROWSER-DRAFT-${refOf(contract)}`, response_metadata: { mock: true, browser: true } };
  },

  async submit(_ctx: ProviderContext, contract: SubmissionContract): Promise<SubmissionResult> {
    // Sandbox only — simulates a browser-automation run that fills + submits a
    // portal form and returns the portal's reference. No real browser is driven.
    return { success: true, status: "SUBMITTED", external_reference: refOf(contract), response_metadata: { mock: true, browser: true, steps: ["login", "fill_form", "upload_documents", "submit", "capture_reference"] } };
  },

  async getStatus(_ctx: ProviderContext, ref: { external_reference: string; submitted_at?: string }): Promise<SubmissionResult> {
    return { success: true, status: "PROCESSING", external_reference: ref.external_reference, response_metadata: { mock: true, browser: true } };
  },
};