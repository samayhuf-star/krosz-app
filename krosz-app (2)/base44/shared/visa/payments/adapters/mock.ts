// Worldz Visa (Phase 10) — MockPaymentProvider.
//
// A deterministic FAKE payment provider for the sandbox product + automated
// tests. Supports the full capability stack (CREATE_CHECKOUT/AUTHORIZE/CAPTURE/
// REFUND/STATUS). Determinism:
//   - provider_payment_id = djb2(idempotency_key) → duplicate checkout returns the
//     SAME provider_payment_id + checkout_url (§16/§52).
//   - reconcile/getStatus returns SUCCEEDED once capture is requested (ok).
//
// Failure modes (ctx.adapterConfig.scenario): ok | card_declined |
// insufficient_funds | auth_failed | unavailable | rate_limited | expired |
// refund_failed. The engine dedups by idempotency BEFORE calling the adapter, so
// failure scenarios are exercised via direct adapter calls in the contract suite.

import type { ProviderContext } from "../../../providers/types.ts";
import type { PaymentProviderAdapter, CheckoutRequest, CheckoutResult, StatusResult, CaptureResult, RefundRequest, RefundResult, PaymentStatus } from "../types.ts";
import { djb2 } from "../../../operations/idempotency.ts";

function scenarioOf(ctx: ProviderContext): string {
  return String((ctx.adapterConfig as any)?.scenario || "ok");
}

export const MockPaymentProvider: PaymentProviderAdapter = {
  key: "visa_payment_mock",
  displayName: "Mock Payment Provider (sandbox)",
  providerType: "GOVERNMENT_API",
  capabilities: ["CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS"],

  getCapabilities(_ctx: ProviderContext) {
    return ["CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS"];
  },

  async createCheckout(ctx: ProviderContext, req: CheckoutRequest): Promise<CheckoutResult> {
    const sc = scenarioOf(ctx);
    const pid = `MOCK-PAY-${djb2(req.idempotency_key).slice(0, 14).toUpperCase()}`;
    if (sc === "card_declined") return { success: false, error_code: "CARD_DECLINED", error_message: "Card declined (mock)" };
    if (sc === "insufficient_funds") return { success: false, error_code: "INSUFFICIENT_FUNDS", error_message: "Insufficient funds (mock)" };
    if (sc === "auth_failed") return { success: false, error_code: "AUTHENTICATION_FAILED", error_message: "3DS authentication failed (mock)" };
    if (sc === "unavailable") return { success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: "Provider unavailable (mock)" };
    if (sc === "rate_limited") return { success: false, error_code: "RATE_LIMIT", error_message: "Rate limited (mock)" };
    if (sc === "expired") return { success: false, error_code: "PAYMENT_EXPIRED", error_message: "Checkout expired (mock)" };
    return {
      success: true,
      provider_payment_id: pid,
      checkout_url: `mock://checkout/${pid}?order=${encodeURIComponent(req.order_number)}`,
      status: "PENDING" as PaymentStatus,
      response_metadata: { mock: true, amount_minor: req.amount_minor, currency: req.currency },
    };
  },

  async capture(ctx: ProviderContext, opts: { provider_payment_id: string; idempotency_key: string }): Promise<CaptureResult> {
    const sc = scenarioOf(ctx);
    if (sc === "unavailable") return { success: false, error_code: "PROVIDER_UNAVAILABLE" };
    return { success: true, status: "SUCCEEDED" as PaymentStatus, provider_payment_id: opts.provider_payment_id, response_metadata: { mock: true, captured: true } };
  },

  async getStatus(_ctx: ProviderContext, opts: { provider_payment_id: string }): Promise<StatusResult> {
    if (!opts.provider_payment_id) return { success: true, status: "CREATED" as PaymentStatus, response_metadata: { mock: true } };
    // After capture the mock treats the payment as SUCCEEDED.
    return { success: true, status: "SUCCEEDED" as PaymentStatus, response_metadata: { mock: true } };
  },

  async refund(ctx: ProviderContext, req: RefundRequest): Promise<RefundResult> {
    const sc = scenarioOf(ctx);
    if (sc === "refund_failed") return { success: false, error_code: "REFUND_FAILED", error_message: "Refund failed (mock)" };
    const rid = `MOCK-RFD-${djb2(req.idempotency_key).slice(0, 12).toUpperCase()}`;
    return { success: true, provider_refund_id: rid, status: "COMPLETED", amount_minor: req.amount_minor, response_metadata: { mock: true } };
  },

  async cancel(_ctx: ProviderContext, _opts: { provider_payment_id: string }) {
    return { success: true };
  },
};