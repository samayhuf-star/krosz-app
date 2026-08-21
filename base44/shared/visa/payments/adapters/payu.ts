// Worldz Visa — PayU payment adapter (production, India).
//
// Implements the same PaymentProviderAdapter contract as the mock and manual
// providers, so the existing Order/Payment/PaymentAttempt/Invoice/Receipt/Refund
// state machine is unchanged. Reads PAYU_MERCHANT_KEY + PAYU_SALT (and optional
// PAYU_ENVIRONMENT=sandbox, PAYU_PUBLIC_BASE_URL) from Base44 Secrets — no
// credential is hard-coded. When the merchant key/salt are absent every call
// returns a structured PAYU_NOT_CONFIGURED error, the engine records a FAILED
// payment, and the resolver falls back to the sandbox mock/manual providers
// (see engine.ts environment resolution).
//
// Flow:
//   1. createCheckout computes the PayU *request hash*
//      sha512(key|txnid|amount|productinfo|firstname|email|udf1|…|udf10|salt),
//      stores the full form payload in response_metadata.payu_fields, and
//      returns checkout_url = <public base>/functions/payuRedirect?payu_txnid=…
//      (provider_payment_id = our txnid; updated to the real mihpayid on the
//      verified webhook). The browser GETs the payuRedirect function which
//      renders a self-submitting POST form to PayU's hosted payment page —
//      the hash is never exposed to the browser.
//   2. PayU redirects/POSTs the result to surl/furl = /functions/payuWebhook.
//      That handler verifies PayU's *reverse hash*
//      sha512(salt|status|udf10|…|udf1|email|firstname|productinfo|amount|txnid|key)
//      and, only on a verified success, transitions Payment→SUCCEEDED and
//      Order→PAID server-side (via the existing reconcilePayment path, which
//      issues the INV-/RCT- records exactly as the mock provider does). The
//      browser never marks an order paid.

import type { ProviderContext } from "../../../providers/types.ts";
import type {
  PaymentProviderAdapter, CheckoutRequest, CheckoutResult, StatusResult,
  CaptureResult, RefundRequest, RefundResult, PaymentStatus,
} from "../types.ts";
import { secrets } from "base44:runtime";
import { djb2 } from "../../../operations/idempotency.ts";

function secret(name: string): string | undefined {
  try { const v = secrets.get(name); return v ? String(v) : undefined; } catch { return undefined; }
}
function configured(): boolean { return !!secret("PAYU_MERCHANT_KEY") && !!secret("PAYU_SALT"); }
function isSandbox(): boolean { return String(secret("PAYU_ENVIRONMENT") || "").toLowerCase() === "sandbox"; }
function payuHost(): string { return isSandbox() ? "https://test.payu.in" : "https://secure.payu.in"; }
function payuVerifyHost(): string { return isSandbox() ? "https://test.payu.in" : "https://info.payu.in"; }
function publicBase(): string { return (secret("PAYU_PUBLIC_BASE_URL") || "https://krosz.com").replace(/\/$/, ""); }

async function sha512(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// PayU request hash (merchant → PayU).
export async function payuRequestHash(f: {
  key: string; txnid: string; amount: string; productinfo: string;
  firstname: string; email: string; udf?: string[]; salt: string;
}): Promise<string> {
  const udf = (f.udf && f.udf.length === 10) ? f.udf : new Array(10).fill("");
  return sha512([f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, ...udf, f.salt].join("|"));
}

// PayU reverse/response hash (PayU → merchant), for verifying the callback.
//   sha512(salt|status|udf10|udf9|…|udf1|email|firstname|productinfo|amount|txnid|key)
export async function payuReverseHash(f: {
  key: string; txnid: string; amount: string; productinfo: string;
  firstname: string; email: string; udf?: string[]; status: string; salt: string;
}): Promise<string> {
  const udfRev = (f.udf && f.udf.length === 10) ? [...f.udf].reverse() : new Array(10).fill("");
  return sha512([f.salt, f.status, ...udfRev, f.email, f.firstname, f.productinfo, f.amount, f.txnid, f.key].join("|"));
}
export { constantTimeEqual };

function formUrlEncode(obj: Record<string, string>): string {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ""))}`).join("&");
}

function payuStatusToPayment(payuStatus: string): PaymentStatus {
  const s = String(payuStatus || "").toLowerCase();
  if (s === "captured" || s === "success") return "SUCCEEDED";
  if (s === "failure" || s === "failed") return "FAILED";
  if (s === "cancel" || s === "cancelled" || s === "dropped") return "CANCELLED";
  return "PENDING";
}

export const PayUPaymentProvider: PaymentProviderAdapter = {
  key: "visa_payment_payu",
  displayName: "PayU",
  providerType: "PAYU",
  capabilities: ["CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS"],

  getCapabilities() { return ["CREATE_CHECKOUT", "AUTHORIZE", "CAPTURE", "REFUND", "STATUS"]; },

  async createCheckout(_ctx, req): Promise<CheckoutResult> {
    if (!configured()) return { success: false, error_code: "PAYU_NOT_CONFIGURED", error_message: "PAYU_MERCHANT_KEY / PAYU_SALT are not set in Base44 Secrets.", response_metadata: {} };
    try {
      const key = secret("PAYU_MERCHANT_KEY")!;
      const salt = secret("PAYU_SALT")!;
      // PayU txnid must be unique per merchant per attempt; derive idempotently
      // from the engine's idempotency_key (encodes order+op+attempt). Alphanumeric,
      // well under PayU's length limits.
      const txnid = `KZ${djb2(req.idempotency_key).slice(0, 12).toUpperCase()}`;
      const amount = (Math.trunc(req.amount_minor) / 100).toFixed(2); // INR, major units, 2 dp
      const productinfo = `Krosz visa ${req.order_number}`.slice(0, 80);
      const firstname = String(req.traveler?.first_name || "Traveler").slice(0, 60);
      const email = String(req.traveler?.email || "guest@krosz.com").slice(0, 100);
      const hash = await payuRequestHash({ key, txnid, amount, productinfo, firstname, email, salt });
      const surl = `${publicBase()}/functions/payuWebhook`;
      const furl = `${publicBase()}/functions/payuWebhook`;
      const payu_fields: Record<string, string> = {
        key, txnid, amount, productinfo, firstname, email, surl, furl, hash, action: "payment",
      };
      return {
        success: true,
        // provider_payment_id holds the PayU merchant txnid until the webhook
        // replaces it with the real mihpayid on verified success.
        provider_payment_id: txnid,
        // Browser GETs this function, which renders a self-submitting POST form
        // to PayU's hosted payment page.
        checkout_url: `${publicBase()}/functions/payuRedirect?payu_txnid=${encodeURIComponent(txnid)}`,
        status: "CREATED" as PaymentStatus,
        response_metadata: { payu: true, txnid, mihpayid: null, amount, currency: req.currency || "INR", host: payuHost(), surl, furl, productinfo, firstname, email, payu_fields },
      };
    } catch (e: any) {
      return { success: false, error_code: "PAYU_CHECKOUT_FAILED", error_message: e?.message, response_metadata: {} };
    }
  },

  async capture(_ctx, opts): Promise<CaptureResult> {
    // PayU captures immediately on a successful hosted payment — there is no
    // separate merchant capture step for the standard flow. Return success so
    // any capture call is a confirmed no-op.
    return { success: true, status: "SUCCEEDED" as PaymentStatus, provider_payment_id: opts.provider_payment_id, response_metadata: { payu: true, captured: true, note: "PayU captures on success; no separate call." } };
  },

  async getStatus(_ctx, opts): Promise<StatusResult> {
    if (!configured()) return { success: false, error_code: "PAYU_NOT_CONFIGURED" };
    try {
      const key = secret("PAYU_MERCHANT_KEY")!;
      const salt = secret("PAYU_SALT")!;
      const txnid = opts.provider_payment_id;
      // PayU verify_payment: POST key|command=verify_payment|var1=txnid|hash=sha512(key|command|var1|salt)
      const command = "verify_payment";
      const hash = await sha512([key, command, txnid, salt].join("|"));
      const res = await fetch(`${payuVerifyHost()}/merchant/postservice`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({ key, command, var1: txnid, hash }),
      });
      const json: any = await res.json().catch(() => ({}));
      const tx: any = (json && json.transaction_details && json.transaction_details[txnid]) || {};
      const st = String(tx.status || tx.state || "").toLowerCase();
      if (!st) return { success: true, status: "PENDING" as PaymentStatus, response_metadata: { payu: true, raw: json } };
      return { success: true, status: payuStatusToPayment(tx.status), response_metadata: { payu: true, payu_status: tx.status, mihpayid: tx.mihpayid || null, amount: tx.amount } };
    } catch {
      return { success: true, status: "PENDING" as PaymentStatus, response_metadata: { payu: true, note: "verify_payment unavailable; rely on webhook" } };
    }
  },

  async refund(_ctx, req): Promise<RefundResult> {
    // PayU refunds are performed by Krosz operations in the PayU merchant
    // dashboard (PayU's refund API requires a separate merchant treasury
    // approval). Returning a structured manual-required failure keeps the
    // Refund state machine correct — it never fakes a COMPLETED refund, so
    // an operator must confirm it in PayU then mark the Refund COMPLETED.
    return { success: false, error_code: "PAYU_REFUND_MANUAL", error_message: "Process this refund in the PayU merchant dashboard, then mark the Refund completed.", response_metadata: { payu: true, reason: req.reason || "", amount_minor: Math.trunc(req.amount_minor), currency: req.currency } };
  },
};