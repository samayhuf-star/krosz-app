// PayU payment callback / webhook.
//
// PayU redirects (and/or sends a server-to-server callback) the payment result
// to this function (the adapter sets surl=furl=<public base>/functions/payuWebhook).
// It verifies PayU's reverse hash
//   sha512(salt|status|udf10|…|udf1|email|firstname|productinfo|amount|txnid|key)
// (constant-time compare against the `hash` PayU returns). Only on a VERIFIED
// success does it transition Payment→SUCCEEDED and Order→PAID server-side
// (via the existing reconcilePayment path, which issues INV-/RCT- records and
// the financial record exactly as the mock provider does). The browser never
// marks an order paid. Failed/dropped/cancelled payments record a failed
// PaymentAttempt with the correct failure_category and never mark the Order paid.
//
// Idempotent: duplicate callbacks (browser redirect + server-to-server) find an
// already-SUCCEEDED Payment and short-circuit. No user session — asServiceRole
// with a scoped system admin identity (reconcilePayment's owner check is
// skipped for admins).

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { secrets } from "base44:runtime";
import { reconcilePayment } from "../../shared/visa/payments/engine.ts";
// Importing the catalog registers the payment adapters (mock, manual, payu)
// as a side effect, so reconcilePayment can resolve the Payment's adapter_key.
import "../../shared/visa/payments/catalog.ts";
import { normalizeFailure } from "../../shared/visa/payments/types.ts";
import { payuReverseHash, constantTimeEqual } from "../../shared/visa/payments/adapters/payu.ts";

function secret(name: string): string | undefined {
  try { const v = secrets.get(name); return v ? String(v) : undefined; } catch { return undefined; }
}
function esc(s: any): string {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function redirectAway(to: string, delayMs = 0): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="${delayMs ? Math.ceil(delayMs / 1000) : 0};url=${esc(to)}"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body onload="${delayMs ? `setTimeout(function(){window.location='${esc(to)}'},${delayMs});` : `window.location='${esc(to)}';`} " style="font-family:system-ui,sans-serif;padding:24px"><p style="color:#64748b">Redirecting…</p></body></html>`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function findPayment(svc: any, txnid: string, mihpayid: string): Promise<any | null> {
  // Primary: provider_payment_id === our txnid (set at checkout).
  let rows: any[] = await svc.Payment.filter({ provider_payment_id: txnid }).catch(() => []);
  if (rows[0]) return rows[0];
  // After a first success, provider_payment_id is overwritten with mihpayid.
  if (mihpayid) { rows = await svc.Payment.filter({ provider_payment_id: mihpayid }).catch(() => []); if (rows[0]) return rows[0]; }
  // Fallback scan: a duplicate callback whose txnid lives in stored metadata.
  const recent: any[] = await svc.Payment.list("-created_date", 100).catch(() => []);
  return recent.find((p) => p?.metadata?.response?.payu_fields?.txnid === txnid || p?.metadata?.response?.txnid === txnid) || null;
}

export default async function (req: Request): Promise<Response> {
  try {
    const salt = secret("PAYU_SALT");
    const publicBase = (secret("PAYU_PUBLIC_BASE_URL") || "https://krosz.com").replace(/\/$/, "");
    if (!salt) return Response.json({ error: "PAYU_SALT not configured" }, { status: 500 });

    // PayU sends params as a POST form (or GET query on browser redirect). Also
    // accept a JSON { params: {...} } for SDK/manual invocation/tests.
    const raw = await req.text().catch(() => "");
    const params: Record<string, string> = {};
    const reqUrl = new URL(req.url);
    reqUrl.searchParams.forEach((v, k) => { params[k] = v; });
    if (raw) {
      if (raw.trim().startsWith("{")) {
        try { const j = JSON.parse(raw); const src = (j && j.params) ? j.params : j; if (src && typeof src === "object") for (const [k, v] of Object.entries(src)) params[k] = String(v); } catch {}
      } else {
        new URLSearchParams(raw).forEach((v, k) => { params[k] = v; });
      }
    }

    // Allow SDK-style manual reconcile for an admin test: { action: "reconcile", payment_id, status, mihpayid }.
    if (params.action === "reconcile" && params.payment_id) {
      const base44 = createClientFromRequest(req);
      const svc = base44.asServiceRole;
      const sys = { id: "payu-webhook", role: "admin", email: "payu-webhook@krosz.com" };
      await reconcilePayment(svc, sys, { payment_id: params.payment_id, provider_event: { status: "SUCCEEDED" }, external_reference: params.mihpayid || undefined }).catch((e: any) => { console.error("payu manual reconcile failed", e?.message || e); });
      return Response.json({ received: true, manual: true });
    }

    const txnid = String(params.txnid || "");
    const mihpayid = String(params.mihpayid || "");
    const status = String(params.status || "").toLowerCase();
    const key = String(params.key || "");
    const amount = String(params.amount || "");
    const productinfo = String(params.productinfo || "");
    const firstname = String(params.firstname || "");
    const email = String(params.email || "");
    const hash = String(params.hash || "");
    const udf = Array.from({ length: 10 }, (_, i) => String(params[`udf${i + 1}`] || ""));

    const expected = await payuReverseHash({ key, txnid, amount, productinfo, firstname, email, udf, status, salt });
    const verified = !!hash && constantTimeEqual(expected, hash);
    if (!verified) {
      console.warn("payuWebhook: hash mismatch", { txnid, status });
      if (txnid) return redirectAway(`${publicBase}/orders/lookup?payu=error&txnid=${encodeURIComponent(txnid)}`);
      return Response.json({ error: "Invalid payment verification hash" }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const sys = { id: "payu-webhook", role: "admin", email: "payu-webhook@krosz.com" };

    const payment = await findPayment(svc, txnid, mihpayid);
    if (!payment) return Response.json({ received: true, matched: false, txnid });

    // Success — reconcile server-side (Payment SUCCEEDED, Order PAID, invoice + receipt).
    if (status === "captured" || status === "success") {
      try {
        await reconcilePayment(svc, sys, { payment_id: payment.id, provider_event: { status: "SUCCEEDED" }, external_reference: mihpayid || undefined });
      } catch (e: any) { console.error("payuWebhook reconcile failed", e?.message || e); }
      return redirectAway(`${publicBase}/orders/${encodeURIComponent(payment.order_id)}/confirmation?payu=success&txnid=${encodeURIComponent(txnid)}`);
    }

    // Failure / cancel / dropped — record failure, never mark the Order paid.
    if (status === "failure" || status === "failed" || status === "cancel" || status === "cancelled" || status === "dropped") {
      const code = String(params.error || status || "PAYMENT_FAILED").toUpperCase();
      const failure_category = status === "cancel" || status === "cancelled" || status === "dropped" ? "PAYMENT_EXPIRED" : normalizeFailure(code);
      if (!["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"].includes(payment.status)) {
        await svc.entities.Payment.update(payment.id, {
          status: "FAILED", failure_code: code, failure_category,
          metadata: { ...(payment.metadata || {}), payu_response: params },
        }).catch(() => {});
        const attempts: any[] = await svc.entities.PaymentAttempt.filter({ payment_id: payment.id }).catch(() => []);
        await svc.entities.PaymentAttempt.create({
          payment_id: payment.id, order_id: payment.order_id, traveler_id: payment.traveler_id,
          attempt_number: (attempts.length || 0) + 1, provider_reference: mihpayid || txnid,
          amount_minor: payment.amount_minor, currency: payment.currency, status: "FAILED",
          operation: "payu_callback_failed", failure_code: code, failure_category,
          metadata: { payu_status: status, txnid, mihpayid },
        }).catch(() => {});
        const order: any = await svc.entities.Order.get(payment.order_id).catch(() => null);
        if (order && order.status === "PENDING_PAYMENT") await svc.entities.Order.update(order.id, { status: "FAILED" }).catch(() => {});
      }
      return redirectAway(`${publicBase}/orders/${encodeURIComponent(payment.order_id)}/confirmation?payu=failure&txnid=${encodeURIComponent(txnid)}`);
    }

    // pending / other — no state change; let the customer return to confirmation.
    return redirectAway(`${publicBase}/orders/${encodeURIComponent(payment.order_id)}/confirmation?payu=${encodeURIComponent(status)}&txnid=${encodeURIComponent(txnid)}`);
  } catch (e: any) {
    console.error("payuWebhook error", e?.message || e);
    return Response.json({ error: e?.message || "payu webhook error" }, { status: 500 });
  }
}