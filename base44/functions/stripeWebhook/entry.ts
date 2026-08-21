// Stripe webhook receiver for the visa payment engine.
//
// Verifies the Stripe-Signature header with STRIPE_WEBHOOK_SECRET (Base44
// Secret) using Stripe's documented t/v1 scheme (HMAC-SHA256 over `${t}.${raw}`,
// constant-time compare, 5-minute replay tolerance). On
// checkout.session.completed / payment_intent.succeeded it transitions the
// matching Payment to SUCCEEDED and the Order to PAID server-side — issuing
// the Invoice (INV-*) and Receipt (RCT-*) with sequential numbers via the
// existing reconcilePayment path, exactly as the mock provider does. On
// payment_intent.payment_failed it records a failed PaymentAttempt with the
// correct failure_category and surfaces the failure on the Payment WITHOUT
// marking the Order paid (the browser never marks an order paid). The Payment
// adapter is looked up by the Payment's Provider row (adapter_key), so this
// handler works for Stripe as well as any other future provider.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { secrets } from "base44:runtime";
import { reconcilePayment } from "../../shared/visa/payments/engine.ts";
// Importing the catalog registers the payment adapters (mock, manual, stripe)
// as a side effect, so reconcilePayment can resolve the Payment's adapter_key.
import "../../shared/visa/payments/catalog.ts";
import { normalizeFailure } from "../../shared/visa/payments/types.ts";

function getSecret(name: string): string | undefined {
  try { const v = secrets.get(name); return v ? String(v) : undefined; } catch { return undefined; }
}

async function verifySignature(rawBody: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const item of sigHeader.split(",")) {
    const idx = item.indexOf("=");
    if (idx > 0) parts[item.slice(0, idx).trim()] = item.slice(idx + 1).trim();
  }
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  // Replay tolerance: reject timestamps older than 5 minutes.
  const ageMs = Math.abs(Date.now() - parseInt(t, 10) * 1000);
  if (isNaN(ageMs) || ageMs > 5 * 60 * 1000) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

export default async function (req: Request): Promise<Response> {
  try {
    const webhookSecret = getSecret("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) return Response.json({ error: "STRIPE_WEBHOOK_SECRET not configured" }, { status: 500 });
    const sig = req.headers.get("stripe-signature") || req.headers.get("Stripe-Signature") || "";
    const rawBody = await req.text();
    if (!await verifySignature(rawBody, sig, webhookSecret)) return Response.json({ error: "Invalid signature" }, { status: 400 });

    const event = JSON.parse(rawBody);
    const type = event?.type || "";
    const data = event?.data?.object || {};

    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    // reconcilePayment's owner check is skipped for admins; webhooks have no
    // user session so a scoped system/admin identity is used. It never returns
    // PII and only advances a Payment that already belongs to an Order in this
    // app.
    const systemUser = { id: "stripe-webhook", role: "admin", email: "stripe-webhook@krosz.com" };

    if (type === "checkout.session.completed" || type === "payment_intent.succeeded") {
      const piId = type === "payment_intent.succeeded" ? data.id : data.payment_intent;
      const sessionId = data.id || null;
      let payment = piId ? (await svc.entities.Payment.filter({ provider_payment_id: piId }).catch(() => []))[0] : null;
      if (!payment && sessionId) payment = (await svc.entities.Payment.filter({ provider_payment_id: sessionId }).catch(() => []))[0];
      if (!payment) return Response.json({ received: true, matched: false });
      try {
        await reconcilePayment(svc, systemUser, { payment_id: payment.id, provider_event: { status: "SUCCEEDED" } });
      } catch (e: any) { console.error("stripeWebhook reconcile failed", e?.message || e); }
      return Response.json({ received: true, matched: true, status: "succeeded" });
    }

    if (type === "payment_intent.payment_failed") {
      const piId = data.id;
      const payment = piId ? (await svc.entities.Payment.filter({ provider_payment_id: piId }).catch(() => []))[0] : null;
      if (payment && !["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"].includes(payment.status)) {
        const lpe = data.last_payment_error || {};
        const errorCode = String(lpe.code || lpe.type || lpe.decline_code || "PAYMENT_FAILED");
        const failure_category = normalizeFailure(errorCode);
        await svc.entities.Payment.update(payment.id, {
          status: "FAILED", failure_code: errorCode, failure_category,
          metadata: { ...(payment.metadata || {}), last_payment_error: { message: lpe.message, code: lpe.code, decline_code: lpe.decline_code } },
        }).catch(() => {});
        const attempt = ((await svc.entities.PaymentAttempt.filter({ payment_id: payment.id }).catch(() => [])) || []).length + 1;
        await svc.entities.PaymentAttempt.create({
          payment_id: payment.id, order_id: payment.order_id, traveler_id: payment.traveler_id,
          attempt_number: attempt, provider_reference: piId, amount_minor: payment.amount_minor, currency: payment.currency,
          status: "FAILED", operation: "webhook_payment_failed", failure_code: errorCode, failure_category,
          metadata: { stripe_event_id: event?.id || null },
        }).catch(() => {});
        // Order is intentionally left in PENDING_PAYMENT (never marked paid) so the customer can retry.
      }
      return Response.json({ received: true, matched: !!payment, status: "failed" });
    }

    return Response.json({ received: true, ignored: type });
  } catch (e: any) {
    console.error("stripeWebhook error", e?.message || e);
    return Response.json({ error: e?.message || "webhook error" }, { status: 500 });
  }
}