// Worldz Visa (Phase 10) — ManualPaymentProvider.
//
// Operator-in-the-loop payment: a human records an external payment reference
// (bank transfer / UPI / counter payment) + uploads a confirmation. This adapter
// NEVER auto-captures; getStatus returns PENDING until the operator confirms via
// the engine's reconcile path with an explicit external reference. Mirrors the
// Phase 8 ManualSubmissionProvider contract for human-in-the-loop financial flows.

import type { ProviderContext } from "../../../providers/types.ts";
import type { PaymentProviderAdapter, CheckoutRequest, CheckoutResult, StatusResult, CaptureResult, RefundRequest, RefundResult, PaymentStatus } from "../types.ts";
import { djb2 } from "../../../operations/idempotency.ts";

export const ManualPaymentProvider: PaymentProviderAdapter = {
  key: "visa_payment_manual",
  displayName: "Manual / Operator-Recorded Payment",
  providerType: "MANUAL_OPERATOR",
  capabilities: ["CREATE_CHECKOUT", "STATUS", "REFUND"],

  getCapabilities(_ctx: ProviderContext) {
    return ["CREATE_CHECKOUT", "STATUS", "REFUND"];
  },

  async createCheckout(_ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutResult> {
    const pid = `MANUAL-PAY-${djb2(req.idempotency_key).slice(0, 12).toUpperCase()}`;
    return {
      success: true,
      provider_payment_id: pid,
      checkout_url: null as any,
      status: "PENDING" as PaymentStatus,
      response_metadata: { manual: true, instructions: "Operator records external payment reference, then confirms." },
    };
  },

  async getStatus(_ctx: ProviderContext, opts: { provider_payment_id: string }): Promise<StatusResult> {
    // Manual: stays PENDING until the operator confirms (engine reconcile flips).
    return { success: true, status: "PENDING" as PaymentStatus, response_metadata: { manual: true, provider_payment_id: opts.provider_payment_id } };
  },

  async refund(_ctx: ProviderContext, req: RefundRequest): Promise<RefundResult> {
    const rid = `MANUAL-RFD-${djb2(req.idempotency_key).slice(0, 12).toUpperCase()}`;
    return { success: true, provider_refund_id: rid, status: "COMPLETED", amount_minor: req.amount_minor, response_metadata: { manual: true, note: "Refund recorded by operator; external confirmation required." } };
  },
};