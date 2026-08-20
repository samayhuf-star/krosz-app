// Worldz Visa — Stripe payment adapter (production).
//
// Real Stripe Checkout Sessions + PaymentIntents via the Stripe REST API
// (https://api.stripe.com/v1). Reads STRIPE_SECRET_KEY from Base44 Secrets at
// call time — no key is ever hard-coded in code. When the secret is absent every
// call returns a structured STRIPE_NOT_CONFIGURED error, so the engine records a
// FAILED payment and the resolver falls back to the sandbox mock provider (see
// engine.ts environment resolution). `provider_payment_id` is always the real
// Stripe PaymentIntent id (pi_…), never a MOCK-PAY-* placeholder.
//
// The adapter implements the same PaymentProviderAdapter contract as the mock
// and manual providers, so the existing Order/Payment/PaymentAttempt/Invoice/
// Receipt/Refund state machine is unchanged. Webhook signature verification
// lives in the stripeWebhook backend function (async HMAC via Web Crypto).

import type { ProviderContext } from "../../../providers/types.ts";
import type {
  PaymentProviderAdapter, CheckoutRequest, CheckoutResult, StatusResult,
  CaptureResult, RefundRequest, RefundResult, PaymentStatus,
} from "../types.ts";
import { secrets } from "base44:runtime";

const STRIPE_API = "https://api.stripe.com/v1";

function secret(name: string): string | undefined {
  try { const v = secrets.get(name); return v ? String(v) : undefined; } catch { return undefined; }
}
function configured(): boolean { return !!secret("STRIPE_SECRET_KEY"); }
function baseUrl(): string {
  return (secret("STRIPE_RETURN_URL") || "https://krosz.com").replace(/\/$/, "");
}

function authHeaders(idempotencyKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${secret("STRIPE_SECRET_KEY")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
  return h;
}

function formEncode(obj: Record<string, any>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(v[i]))}`);
    } else if (typeof v === "object") {
      parts.push(formEncode(v, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join("&");
}

async function stripeRequest(path: string, body: Record<string, any> | null, idempotencyKey?: string): Promise<any> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: authHeaders(idempotencyKey),
    body: body ? formEncode(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error || {};
    throw Object.assign(new Error(err.message || `Stripe HTTP ${res.status}`), {
      code: err.code || err.type || `STRIPE_HTTP_${res.status}`,
      stripe_error: err,
    });
  }
  return json;
}

function piStatus(pi: any): PaymentStatus {
  const s = String(pi?.status || "").toLowerCase();
  if (s === "succeeded") return "SUCCEEDED";
  if (s === "processing") return "PENDING";
  if (s === "requires_capture") return "AUTHORIZED";
  if (s === "canceled" || s === "cancelled") return "CANCELLED";
  if (s === "requires_payment_method" || s === "requires_action" || s === "requires_confirmation") return "FAILED";
  return "PENDING";
}

export const StripePaymentProvider: PaymentProviderAdapter = {
  key: "visa_payment_stripe",
  displayName: "Stripe",
  providerType: "STRIPE",
  capabilities: ["CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS"],

  getCapabilities() { return ["CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS"]; },

  async createCheckout(_ctx, req): Promise<CheckoutResult> {
    if (!configured()) return { success: false, error_code: "STRIPE_NOT_CONFIGURED", error_message: "STRIPE_SECRET_KEY is not set in Base44 Secrets.", response_metadata: {} };
    try {
      const amount = Math.trunc(req.amount_minor);
      const currency = String(req.currency || "INR").toLowerCase();
      const description = `Krosz visa order ${req.order_number}`;
      const body: Record<string, any> = {
        mode: "payment",
        success_url: `${baseUrl()}/orders/${req.order_id}/confirmation?stripe_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl()}/applications/${req.application_id}`,
        client_reference_id: req.order_id,
        metadata: { order_id: req.order_id, application_id: req.application_id, idempotency_key: req.idempotency_key },
        payment_intent_data: {
          description,
          metadata: { order_id: req.order_id, application_id: req.application_id, idempotency_key: req.idempotency_key },
        },
        line_items: [{ quantity: 1, price_data: { currency, unit_amount: amount, product_data: { name: description } } }],
      };
      if (req.traveler?.email) body.customer_email = req.traveler.email;
      const session = await stripeRequest("/checkout/sessions", body, req.idempotency_key);
      const pi = session.payment_intent || null;
      return {
        success: true,
        provider_payment_id: pi || session.id,
        checkout_url: session.url,
        status: "CREATED",
        response_metadata: { stripe_session_id: session.id, stripe_payment_intent: pi || null, stripe_object: "checkout.session" },
      };
    } catch (e: any) {
      return { success: false, error_code: e?.code || "STRIPE_CHECKOUT_FAILED", error_message: e?.message, response_metadata: { stripe_error: e?.stripe_error || null } };
    }
  },

  async capture(_ctx, opts): Promise<CaptureResult> {
    if (!configured()) return { success: false, status: "FAILED", error_code: "STRIPE_NOT_CONFIGURED" };
    try {
      const pi = await stripeRequest(`/payment_intents/${encodeURIComponent(opts.provider_payment_id)}/capture`, {}, opts.idempotency_key);
      return { success: true, status: piStatus(pi), provider_payment_id: pi.id, response_metadata: { stripe_status: pi.status } };
    } catch (e: any) {
      return { success: false, status: "FAILED", error_code: e?.code || "STRIPE_CAPTURE_FAILED", response_metadata: { stripe_error: e?.stripe_error || null } };
    }
  },

  async getStatus(_ctx, opts): Promise<StatusResult> {
    if (!configured()) return { success: false, error_code: "STRIPE_NOT_CONFIGURED" };
    try {
      const pi = await stripeRequest(`/payment_intents/${encodeURIComponent(opts.provider_payment_id)}`, null);
      return { success: true, status: piStatus(pi), response_metadata: { stripe_status: pi.status } };
    } catch (e: any) {
      return { success: false, error_code: e?.code || "STRIPE_STATUS_FAILED", response_metadata: { stripe_error: e?.stripe_error || null } };
    }
  },

  async refund(_ctx, req): Promise<RefundResult> {
    if (!configured()) return { success: false, error_code: "STRIPE_NOT_CONFIGURED", error_message: "STRIPE_SECRET_KEY is not set in Base44 Secrets." };
    try {
      const body: Record<string, any> = {
        payment_intent: req.provider_payment_id,
        amount: Math.trunc(req.amount_minor),
        metadata: { idempotency_key: req.idempotency_key, reason: req.reason || "" },
      };
      if (req.reason) {
        const r = String(req.reason).toLowerCase();
        body.reason = r.includes("duplicate") ? "duplicate" : r.includes("fraud") ? "fraudulent" : "requested_by_customer";
      }
      const rfd = await stripeRequest("/refunds", body, req.idempotency_key);
      const status = rfd.status === "succeeded" ? "COMPLETED" : rfd.status === "pending" ? "PROCESSING" : "FAILED";
      return {
        success: rfd.status !== "failed",
        provider_refund_id: rfd.id,
        status: status as any,
        amount_minor: rfd.amount,
        response_metadata: { stripe_refund_id: rfd.id, stripe_status: rfd.status },
      };
    } catch (e: any) {
      return { success: false, error_code: e?.code || "STRIPE_REFUND_FAILED", error_message: e?.message, response_metadata: { stripe_error: e?.stripe_error || null } };
    }
  },
};