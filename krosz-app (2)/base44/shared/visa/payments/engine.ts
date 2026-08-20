// Worldz Visa (Phase 10) — the financial engine.
//
// Owns order/payment/refund/invoice/receipt state and the audit trail. Mirrors
// the Phase 8/9 boundary: the orchestrator owns lifecycle/recovery, the provider
// owns external interaction, this engine is the visa-domain service the visaApi
// thin layer calls. The VisaApplication is NEVER mutated by a payment provider;
// only payment_required / paid_at projection fields are touched (§21), and
// payment records belong to ORDERS, not the application (§3).
//
// Security invariants (§49-§57): price tampering rejected (server recalculates),
// ownership enforced on every read/write, pay is idempotent (order+op+attempt),
// webhooks are the authoritative source of payment state, refunds are separate
// transactions with a provider-confirmed state machine, refundable amount is
// capped by the captured payment. No card data is ever logged.

import { resolvePaymentProvider, buildProviderContext, type ResolvedPaymentProvider } from "./resolver.ts";
import { getPaymentAdapter } from "./registry.ts";
import {
  paymentIdempotencyKey, refundIdempotencyKey, normalizeFailure, serviceRequiresGate,
  type OrderStatus, type PaymentStatus, type PaymentGate, type PaidService, type PriceComponent,
} from "./types.ts";
import { secrets } from "base44:runtime";
import { sumMinor } from "./money.ts";
import { documentAudit } from "../documents.ts";
import { recordFinancialEvent, commercialTimeline, dispatchCommercial } from "../finalreview/ledger.ts";
import { markPaymentPending, markPaid } from "../finalreview/engine.ts";
import { recordCaseEvent } from "../application/caseStore.ts";
import { createFinancialRecord } from "../finance/store.ts";

// ---------- audit + order-number helpers ----------
async function auditPay(svc: any, user: any, action: string, entityId: string, travelerId: string, applicationId: string, detail: any): Promise<void> {
  await documentAudit(svc, user, { action, entity_type: "Payment", entity_id: entityId, application_id: applicationId, detail: { ...detail, traveler_id: travelerId } }).catch(() => {});
}

function year(): number { return new Date().getUTCFullYear(); }

async function nextSequence(svc: any, entity: string, prefix: string): Promise<string> {
  const rows: any[] = await svc.entities[entity].filter({}).catch(() => []);
  // Best-effort monotonic sequence from the highest existing numeric suffix.
  let max = 0;
  for (const r of rows) {
    const m = String(r.order_number || r.invoice_number || r.receipt_number || "").match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  return `${prefix}-${year()}-${String(next).padStart(6, "0")}`;
}

// ---------- Product / price resolution ----------
export async function resolveProduct(svc: any, app: any): Promise<any> {
  const rows: any[] = await svc.entities.VisaProduct.filter({
    country: String(app.destination || "").toUpperCase(),
    visa_type_key: app.visa_type_key, purpose: app.purpose, status: "ACTIVE",
  }).catch(() => []);
  // Skip test-route products (metadata.test_route) unless it's the ONLY match —
  // they exist to exercise the no-payment gate, not to win real routing.
  const real = rows.filter((p) => !p.metadata?.test_route);
  const chosen = real.length ? real : rows;
  if (!chosen.length) throw Object.assign(new Error("No active product for this route"), { code: "NO_PRODUCT" });
  return chosen[0];
}

export async function resolveProductById(svc: any, productId: string): Promise<any> {
  const p = await svc.entities.VisaProduct.get(productId).catch(() => null);
  if (!p) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  if (p.status !== "ACTIVE") throw Object.assign(new Error(`Product not active (${p.status})`), { code: "PRODUCT_INACTIVE" });
  return p;
}

export async function resolveActivePrice(svc: any, product: any): Promise<any> {
  const rows: any[] = await svc.entities.VisaPrice.filter({ product_id: product.id, status: "active" }).catch(() => []);
  if (!rows.length) throw Object.assign(new Error("No active price for product"), { code: "NO_PRICE" });
  // Most recent effective first.
  rows.sort((a: any, b: any) => String(b.effective_from || "").localeCompare(String(a.effective_from || "")));
  return rows[0];
}

function computeTotals(components: PriceComponent[]): { subtotal_minor: number; tax_minor: number; discount_minor: number; total_minor: number } {
  let sub = 0, tax = 0, disc = 0;
  for (const c of components || []) {
    if (c.type === "TAX") tax += c.amount_minor;
    else if (c.type === "DISCOUNT") disc += c.amount_minor;
    else sub += c.amount_minor;
  }
  return { subtotal_minor: sub, tax_minor: tax, discount_minor: disc, total_minor: sub + tax - disc };
}

// Server-authoritative quote (§50): the frontend never supplies totals.
export async function getQuote(svc: any, app: any): Promise<any> {
  const product = await resolveProduct(svc, app);
  const price = await resolveActivePrice(svc, product);
  const totals = { subtotal_minor: price.subtotal_minor ?? 0, tax_minor: price.tax_minor ?? 0, discount_minor: price.discount_minor ?? 0, total_minor: price.total_minor ?? 0 };
  return {
    product: { id: product.id, code: product.code, name: product.name, refund_policy: product.refund_policy, payment_gate: product.payment_gate, optional_services: product.optional_services || [] },
    price: { id: price.id, currency: price.currency, version: price.version, components: price.components, ...totals },
    currency: price.currency,
    ...totals,
    optional_services: product.optional_services || [],
  };
}

// ---------- Orders ----------
export async function createOrder(svc: any, user: any, app: any, opts?: { client_total_minor?: number; optional_services?: string[] }): Promise<any> {
  const product = await resolveProduct(svc, app);
  const price = await resolveActivePrice(svc, product);
  const baseComponents = [...(price.components || [])];
  const selected = (opts?.optional_services || []) as string[];
  for (const os of product.optional_services || []) {
    if (selected.includes(os.code) && !baseComponents.find((c) => c.code === os.code)) {
      baseComponents.push({ type: os.type || "OPTIONAL_SERVICE", code: os.code, label: os.label, amount_minor: os.amount_minor, refundable: !!os.refundable });
    }
  }
  const totals = computeTotals(baseComponents);
  // Price tampering (§50): if a client total is supplied it MUST match the
  // server recalculated total; otherwise reject and keep the server value.
  if (opts?.client_total_minor != null && Math.trunc(opts.client_total_minor) !== Math.trunc(totals.total_minor)) {
    await auditPay(svc, user, "order.price_tampering_rejected", "", app.traveler_id, app.id, { expected: totals.total_minor, supplied: opts.client_total_minor });
    throw Object.assign(new Error("Price mismatch — using server price"), { code: "PRICE_TAMPERING", server_total_minor: totals.total_minor });
  }
  // Idempotency: one active order per (application_id, product_id). Return existing live order.
  const existing: any[] = await svc.entities.Order.filter({ application_id: app.id, product_id: product.id }).catch(() => []);
  const live = existing.find((o) => !["CANCELLED", "REFUNDED", "COMPLETED", "FAILED"].includes(o.status));
  if (live) {
    return { order: live, items: await svc.entities.OrderItem.filter({ order_id: live.id }).catch(() => []), idempotent: true };
  }

  const order_number = await nextSequence(svc, "Order", "VIS");
  const snapshot = {
    product_code: product.code, price_version: price.version, currency: price.currency,
    components: baseComponents,
    ...totals,
    refund_policy: product.refund_policy, payment_gate: product.payment_gate, generated_at: new Date().toISOString(),
  };
  const noPayment = product.payment_gate === "NO_PAYMENT_REQUIRED" || totals.total_minor === 0;
  let order: any = await svc.entities.Order.create({
    order_number, traveler_id: app.traveler_id, application_id: app.id, product_id: product.id, product_code: product.code,
    currency: price.currency, subtotal_minor: totals.subtotal_minor, tax_minor: totals.tax_minor, discount_minor: totals.discount_minor,
    total_minor: totals.total_minor, status: noPayment ? "COMPLETED" : "PENDING_PAYMENT", price_snapshot: snapshot, price_version: price.version,
    paid_at: noPayment ? new Date().toISOString() : null, completed_at: noPayment ? new Date().toISOString() : null, metadata: {},
  }).catch((e: any) => { throw Object.assign(new Error(`Order create failed: ${e?.message}`), { code: "CREATE_FAILED" }); });

  // Order items mirror the price components (§10) → enables per-component refund.
  for (const c of baseComponents) {
    await svc.entities.OrderItem.create({
      order_id: order.id, traveler_id: app.traveler_id, product_id: product.id,
      item_type: c.type, component_code: c.code, description: c.label, quantity: 1,
      unit_price_minor: c.amount_minor, tax_minor: c.type === "TAX" ? c.amount_minor : 0,
      discount_minor: c.type === "DISCOUNT" ? c.amount_minor : 0, total_minor: c.amount_minor, metadata: { refundable: !!c.refundable, government_fee_basis: c.government_fee_basis },
    }).catch(() => {});
  }
  const items = await svc.entities.OrderItem.filter({ order_id: order.id }).catch(() => []);

  // No-payment product: auto-complete → invoice + receipt + application projection.
  if (noPayment) {
    await svc.entities.VisaApplication.update(app.id, { metadata: { ...(app.metadata || {}), payment_status: "PAID", paid_at: order.paid_at } }).catch(() => {});
    const invoice = await issueInvoiceFor(svc, user, order, "PAID").catch(() => null);
    const receipt = await issueReceiptFor(svc, user, order, null, invoice).catch(() => null);
    order = await svc.entities.Order.get(order.id);
    await auditPay(svc, user, "order.completed_no_payment", order.id, app.traveler_id, app.id, { order_number });
    await recordFinancialEvent(svc, app, "ORDER_CREATED", { order_id: order.id, amount_minor: 0, currency: price.currency });
    await commercialTimeline(svc, app, "ORDER_CREATED", { source_ref: order.id, actor_type: "SYSTEM", metadata: { order_number } }).catch(() => {});
    await markPaid(svc, app, order).catch(() => {});
    // Phase 38: idempotently project the immutable paid order snapshot into
    // reconciliation. Payment/order state remains authoritative.
    await createFinancialRecord(svc, order, app).catch(() => null);
    return { order, items, invoice, receipt, no_payment: true };
  }

  await auditPay(svc, user, "order.created", order.id, app.traveler_id, app.id, { order_number, total_minor: totals.total_minor, currency: price.currency });
  await recordFinancialEvent(svc, app, "PRICE_CREATED", { order_id: order.id, amount_minor: totals.total_minor, currency: price.currency });
  await recordFinancialEvent(svc, app, "ORDER_CREATED", { order_id: order.id, amount_minor: totals.total_minor, currency: price.currency });
  await commercialTimeline(svc, app, "ORDER_CREATED", { source_ref: order.id, actor_type: "SYSTEM", metadata: { order_number, total_minor: totals.total_minor, currency: price.currency } }).catch(() => {});
  await dispatchCommercial("OrderCreated" as any, { application_id: app.id, order_id: order.id });
  await markPaymentPending(svc, app, order).catch(() => {});
  await svc.entities.VisaApplication.update(app.id, { metadata: { ...(app.metadata || {}), payment_status: "PENDING", payment_required: true } }).catch(() => {});
  return { order, items };
}

export async function getOrder(svc: any, user: any, orderId: string): Promise<any> {
  const order: any = await svc.entities.Order.get(orderId).catch(() => null);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  await assertOrderOwner(svc, user, order);
  const items = await svc.entities.OrderItem.filter({ order_id: order.id }).catch(() => []);
  const payments = await svc.entities.Payment.filter({ order_id: order.id }).catch(() => []);
  const invoices = await svc.entities.Invoice.filter({ order_id: order.id }).catch(() => []);
  const receipts = await svc.entities.Receipt.filter({ order_id: order.id }).catch(() => []);
  const refunds = await svc.entities.Refund.filter({ order_id: order.id }).catch(() => []);
  return { order, items, payments, invoices, receipts, refunds };
}

export async function listOrders(svc: any, user: any, opts?: { application_id?: string; traveler_id?: string }): Promise<any[]> {
  if (user.role === "admin") {
    const q: any = {};
    if (opts?.application_id) q.application_id = opts.application_id;
    if (opts?.traveler_id) q.traveler_id = opts.traveler_id;
    return await svc.entities.Order.filter(q, "-created_date", 100).catch(() => []);
  }
  if (opts?.application_id) {
    // Ownership check via the application's owner.
    const app = await svc.entities.VisaApplication.get(opts.application_id).catch(() => null);
    if (!app || app.created_by_id !== user.id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
    return await svc.entities.Order.filter({ application_id: opts.application_id }, "-created_date", 100).catch(() => []);
  }
  const travelerId = opts?.traveler_id || await travelerIdForUser(svc, user);
  if (!travelerId) return [];
  return await svc.entities.Order.filter({ traveler_id: travelerId }, "-created_date", 100).catch(() => []);
}

async function assertOrderOwner(svc: any, user: any, order: any): Promise<void> {
  if (user.role === "admin") return;
  if (order.created_by_id !== user.id) {
    // Also allow if the traveler belongs to the user.
    const app = order.application_id ? await svc.entities.VisaApplication.get(order.application_id).catch(() => null) : null;
    if (app && app.created_by_id === user.id) return;
    throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  }
}

async function travelerIdForUser(svc: any, user: any): Promise<string | null> {
  const rows: any[] = await svc.entities.Traveler.filter({ user_id: user.id }).catch(() => []);
  return rows[0]?.id || null;
}

// ---------- Checkout / payment ----------
export async function createCheckout(svc: any, user: any, orderId: string): Promise<any> {
  const order: any = await svc.entities.Order.get(orderId).catch(() => null);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  await assertOrderOwner(svc, user, order);
  // Idempotency (§16/§52): an EXISTING payment for this order short-circuits a
  // duplicated checkout call — a live CREATED/PENDING/AUTHORIZED payment resumes,
  // and an already-SUCCEEDED payment is returned as "already paid" (no second
  // charge, no second order). Double-clicking Pay never creates two charges.
  const existingPayments: any[] = await svc.entities.Payment.filter({ order_id: order.id }).catch(() => []);
  const live = existingPayments.find((p) => ["CREATED", "PENDING", "AUTHORIZED"].includes(p.status));
  if (live) return { payment: live, idempotent: true };
  const succeeded = existingPayments.find((p) => p.status === "SUCCEEDED");
  if (succeeded) return { payment: succeeded, idempotent: true, already_paid: true };

  if (!["PENDING_PAYMENT", "FAILED"].includes(order.status)) throw Object.assign(new Error(`Order not payable (${order.status})`), { code: "NOT_PAYABLE" });

  // New attempt = previous failed attempts + 1.
  const attempt = (existingPayments.filter((p) => p.status === "FAILED").length || 0) + 1;
  const idempotency_key = paymentIdempotencyKey(order.id, "checkout", attempt);
  // Stripe is the production default (selected when STRIPE_SECRET_KEY is
  // configured); the mock provider remains the sandbox/dev default. The
  // environment is resolved from secrets so the same code path works before
  // and after live Stripe keys are added — no deploy/config change needed.
  const checkoutEnv: "sandbox" | "production" = secrets.get("STRIPE_SECRET_KEY") ? "production" : "sandbox";
  const resolved = await resolvePaymentProvider(svc, "CREATE_CHECKOUT", { environment: checkoutEnv });
  const ctx = await buildProviderContext(svc, resolved.provider);
  const adapter = getPaymentAdapter(resolved.provider.adapter_key);
  const app = order.application_id ? await svc.entities.VisaApplication.get(order.application_id).catch(() => null) : null;
  const result = await adapter.createCheckout(ctx, {
    order_id: order.id, order_number: order.order_number, amount_minor: order.total_minor, currency: order.currency,
    idempotency_key, application_id: order.application_id, environment: resolved.environment,
    traveler: app ? { first_name: app.metadata?.first_name, last_name: app.metadata?.last_name, email: user.email } : undefined,
  });
  if (!result.success) {
    const failure_category = normalizeFailure(result.error_code);
    // Record a failed Payment + attempt (never overwrite a prior attempt, §47).
    const payment = await svc.entities.Payment.create({
      order_id: order.id, traveler_id: order.traveler_id, application_id: order.application_id,
      provider_id: resolved.provider_id, provider_key: resolved.provider_key, provider_type: resolved.provider_type,
      amount_minor: order.total_minor, currency: order.currency, status: "FAILED",
      idempotency_key, attempt, failure_code: result.error_code, failure_category, metadata: { response: result.response_metadata },
    }).catch(() => null);
    if (payment) await svc.entities.PaymentAttempt.create({ payment_id: payment.id, order_id: order.id, traveler_id: order.traveler_id, attempt_number: attempt, provider_reference: "", amount_minor: order.total_minor, currency: order.currency, status: "FAILED", operation: "create_checkout", failure_code: result.error_code, failure_category, metadata: {} }).catch(() => {});
    await svc.entities.Order.update(order.id, { status: "FAILED" }).catch(() => {});
    await auditPay(svc, user, "payment.failed", payment?.id || order.id, order.traveler_id, order.application_id, { order_id: order.id, failure_code: result.error_code, failure_category });
    await recordFinancialEvent(svc, app, "PAYMENT_FAILED", { order_id: order.id, payment_id: payment?.id, amount_minor: order.total_minor, currency: order.currency }).catch(() => {});
    await commercialTimeline(svc, app, "PAYMENT_FAILED", { source_ref: payment?.id || order.id, actor_type: "SYSTEM", metadata: { order_id: order.id, failure_code: result.error_code } }).catch(() => {});
    await dispatchCommercial("PaymentFailed" as any, { application_id: order.application_id, order_id: order.id });
    throw Object.assign(new Error(result.error_message || "Checkout failed"), { code: result.error_code || "CHECKOUT_FAILED", failure_category });
  }

  const payment = await svc.entities.Payment.create({
    order_id: order.id, traveler_id: order.traveler_id, application_id: order.application_id,
    provider_id: resolved.provider_id, provider_key: resolved.provider_key, provider_type: resolved.provider_type,
    provider_payment_id: result.provider_payment_id, checkout_url: result.checkout_url,
    amount_minor: order.total_minor, currency: order.currency, status: result.status || "CREATED",
    idempotency_key, attempt, metadata: { response: result.response_metadata },
  }).catch((e: any) => { throw Object.assign(new Error(`Payment create failed: ${e?.message}`), { code: "CREATE_FAILED" }); });
  await svc.entities.PaymentAttempt.create({ payment_id: payment.id, order_id: order.id, traveler_id: order.traveler_id, attempt_number: attempt, provider_reference: result.provider_payment_id, amount_minor: order.total_minor, currency: order.currency, status: result.status || "CREATED", operation: "create_checkout", metadata: {} }).catch(() => {});
  await svc.entities.Order.update(order.id, { status: "PENDING_PAYMENT" }).catch(() => {});
  await auditPay(svc, user, "payment.created", payment.id, order.traveler_id, order.application_id, { order_id: order.id, provider_payment_id: result.provider_payment_id, attempt });
  await recordFinancialEvent(svc, app, "PAYMENT_INITIATED", { order_id: order.id, payment_id: payment.id, amount_minor: order.total_minor, currency: order.currency }).catch(() => {});
  await commercialTimeline(svc, app, "PAYMENT_INITIATED", { source_ref: payment.id, actor_type: "SYSTEM", metadata: { order_id: order.id } }).catch(() => {});
  await dispatchCommercial("PaymentStarted" as any, { application_id: order.application_id, order_id: order.id });
  return { payment, checkout_url: result.checkout_url, provider_payment_id: result.provider_payment_id };
}

// Reconcile payment status from the provider (authoritative, §17). Used by both
// the webhook handler and a manual "I've paid" confirm for manual providers.
export async function reconcilePayment(svc: any, user: any, opts: { payment_id: string; confirmed?: boolean; external_reference?: string; provider_event?: any }): Promise<any> {
  const payment: any = await svc.entities.Payment.get(opts.payment_id).catch(() => null);
  if (!payment) throw Object.assign(new Error("Payment not found"), { code: "NOT_FOUND" });
  await assertPaymentOwner(svc, user, payment);
  if (["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"].includes(payment.status)) return { payment, already: true, status: "succeeded" };
  const provider: any = await svc.entities.Provider.get(payment.provider_id).catch(() => null);
  if (!provider) throw Object.assign(new Error("Provider not found"), { code: "NO_PROVIDER" });
  const ctx = await buildProviderContext(svc, provider);
  const adapter = getPaymentAdapter(provider.adapter_key);

  let status: PaymentStatus = payment.status;
  // Operator-confirmed manual payment → SUCCEEDED (recorded with external_reference).
  if ((provider.adapter_key === "visa_payment_manual" && opts.confirmed) || opts.provider_event?.status === "SUCCEEDED") {
    status = "SUCCEEDED";
  } else {
    const s = await adapter.getStatus(ctx, { provider_payment_id: payment.provider_payment_id }).catch(() => null);
    if (s?.success && s.status) status = s.status;
  }

  if (status !== "SUCCEEDED") {
    await svc.entities.Payment.update(payment.id, { status }).catch(() => {});
    if (status === "FAILED") {
      await recordFinancialEvent(svc, { id: payment.application_id, traveler_id: payment.traveler_id }, "PAYMENT_FAILED", { order_id: payment.order_id, payment_id: payment.id, amount_minor: payment.amount_minor, currency: payment.currency }).catch(() => {});
      await commercialTimeline(svc, { id: payment.application_id, traveler_id: payment.traveler_id }, "PAYMENT_FAILED", { source_ref: payment.id, actor_type: "SYSTEM", metadata: { order_id: payment.order_id } }).catch(() => {});
    }
    return { payment: { ...payment, status }, status: "pending" };
  }

  // SUCCESS path → payment SUCCEEDED, order PAID, invoice + receipt issued, app projection.
  const paid_at = new Date().toISOString();
  await svc.entities.Payment.update(payment.id, { status: "SUCCEEDED", paid_at, ...(opts.external_reference ? { provider_payment_id: opts.external_reference } : {}) }).catch(() => {});
  const order: any = await svc.entities.Order.get(payment.order_id).catch(() => null);
  if (order) {
    await svc.entities.Order.update(order.id, { status: "PAID", paid_at }).catch(() => {});
    const invoice = await issueInvoiceFor(svc, user, order, "PAID").catch(() => null);
    const receipt = await issueReceiptFor(svc, user, order, payment, invoice).catch(() => null);
    await auditPay(svc, user, "payment.succeeded", payment.id, payment.traveler_id, payment.application_id, { order_id: order.id, provider_payment_id: payment.provider_payment_id });
    // Application projection only (does NOT own the payment, §21).
    const app = order.application_id ? await svc.entities.VisaApplication.get(order.application_id).catch(() => null) : null;
    if (app) await svc.entities.VisaApplication.update(app.id, { metadata: { ...(app.metadata || {}), payment_status: "PAID", paid_at, payment_id: payment.id, order_id: order.id } }).catch(() => {});
    // Orchestrator unlock signal: best-effort — the orchestrator reacts to this.
    await signalPaymentSucceeded(svc, user, app, order).catch(() => {});
    // Phase 18: commercial event trail + final-review state (payment confirmed ≠ submitted, §20).
    await recordFinancialEvent(svc, app, "PAYMENT_SUCCEEDED", { order_id: order.id, payment_id: payment.id, amount_minor: order.total_minor, currency: order.currency }).catch(() => {});
    // Phase 31 \u00a720: durable, idempotent case-level payment event (payment state still
    // owned by the payment engine; the case only records the consequence).
    await recordCaseEvent(svc, { ...app, case_state: app?.case_state, traveler_id: app?.traveler_id, created_by_id: app?.created_by_id }, { event_type: "PAYMENT_COMPLETED", source: "payment_engine", idempotency_key: `pay_${payment.id}`, reason: `Payment succeeded for order ${order.order_number}`, metadata: { order_id: order.id, payment_id: payment.id } }).catch(() => {});
    await commercialTimeline(svc, app, "PAYMENT_SUCCESSFUL", { source_ref: payment.id, actor_type: "SYSTEM", metadata: { order_id: order.id, order_number: order.order_number } }).catch(() => {});
    await dispatchCommercial("PaymentConfirmed" as any, { application_id: app?.id, order_id: order?.id });
    if (app) await markPaid(svc, app, order).catch(() => {});
    // Phase 38: create exactly one reconciliation row from the immutable order
    // snapshot after payment succeeds. The store enforces case-level idempotency.
    if (app) await createFinancialRecord(svc, { ...order, status: "PAID", paid_at }, app).catch(() => null);
    return { payment: { ...payment, status: "SUCCEEDED", paid_at }, order: await svc.entities.Order.get(order.id), invoice, receipt, status: "succeeded" };
  }
  return { payment: { ...payment, status: "SUCCEEDED", paid_at }, status: "succeeded" };
}

async function assertPaymentOwner(svc: any, user: any, payment: any): Promise<void> {
  if (user.role === "admin") return;
  if (payment.created_by_id !== user.id) {
    const order = await svc.entities.Order.get(payment.order_id).catch(() => null);
    if (!order || order.created_by_id !== user.id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  }
}

// Retry a failed payment on the SAME order (§45/§46) — a new attempt is created,
// previous attempts are preserved (§47), no second order.
export async function retryPayment(svc: any, user: any, orderId: string): Promise<any> {
  const order: any = await svc.entities.Order.get(orderId).catch(() => null);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  await assertOrderOwner(svc, user, order);
  if (!["FAILED", "PENDING_PAYMENT"].includes(order.status)) throw Object.assign(new Error(`Order not retryable (${order.status})`), { code: "NOT_RETRYABLE" });
  // Reset to PENDING_PAYMENT so createCheckout can proceed; it computes the next attempt.
  await svc.entities.Order.update(order.id, { status: "PENDING_PAYMENT" }).catch(() => {});
  return await createCheckout(svc, user, orderId);
}

export async function cancelOrder(svc: any, user: any, orderId: string): Promise<any> {
  const order: any = await svc.entities.Order.get(orderId).catch(() => null);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  await assertOrderOwner(svc, user, order);
  if (["PAID", "COMPLETED", "REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED"].includes(order.status)) throw Object.assign(new Error(`Cannot cancel ${order.status} order; refund instead`), { code: "NOT_CANCELLABLE" });
  await svc.entities.Order.update(order.id, { status: "CANCELLED", cancelled_at: new Date().toISOString() }).catch(() => {});
  const payments = await svc.entities.Payment.filter({ order_id: order.id }).catch(() => []);
  for (const p of payments) if (["CREATED", "PENDING", "AUTHORIZED"].includes(p.status)) await svc.entities.Payment.update(p.id, { status: "CANCELLED" }).catch(() => {});
  const app = order.application_id ? await svc.entities.VisaApplication.get(order.application_id).catch(() => null) : null;
  if (app) await svc.entities.VisaApplication.update(app.id, { metadata: { ...(app.metadata || {}), payment_status: "CANCELLED" } }).catch(() => {});
  await auditPay(svc, user, "order.cancelled", order.id, order.traveler_id, order.application_id, { order_number: order.order_number });
  return { order: await svc.entities.Order.get(order.id) };
}

// ---------- Refunds (§31-§35) ----------

// Deterministic, conservative eligibility assessment (Phase 2 §8).
// NEVER auto-approves a financially-consequent refund; it only triages. The
// product refund policy, application stage and whether the case has already
// been submitted to the government drive the initial tier. A human still
// decides approval via approveRefund/rejectRefund.
function assessRefundEligibility(reason: string, productPolicy: string | undefined, app: any, submissionStatus: string): { eligibility: "POTENTIALLY_ELIGIBLE" | "REQUIRES_HUMAN_REVIEW" | "NOT_ELIGIBLE"; notes: string } {
  if (productPolicy === "NON_REFUNDABLE") return { eligibility: "NOT_ELIGIBLE", notes: "Product is configured non-refundable." };
  const submitted = submissionStatus === "SUBMITTED" || submissionStatus === "COMPLETED";
  if (reason === "DUPLICATE_PAYMENT") return { eligibility: "POTENTIALLY_ELIGIBLE", notes: "Duplicate payment is eligible for a full refund of the duplicate, regardless of stage." };
  if (reason === "PROVIDER_FAILURE") return { eligibility: "REQUIRES_HUMAN_REVIEW", notes: "Provider failure requires operator confirmation of what work was (not) performed." };
  if (reason === "APPLICATION_CANCELLED") {
    if (submitted) return { eligibility: "REQUIRES_HUMAN_REVIEW", notes: "Application was already submitted to the government; government fee is generally non-refundable. Service fee reviewed against work performed." };
    return { eligibility: "POTENTIALLY_ELIGIBLE", notes: "Cancelled before government submission; service fee may be refundable before work is performed." };
  }
  if (reason === "CUSTOMER_REQUEST" || reason === "OPERATOR_ADJUSTMENT" || reason === "OTHER") {
    if (submitted) return { eligibility: "REQUIRES_HUMAN_REVIEW", notes: "Post-submission customer request; government fee generally non-refundable, service fee depends on work performed." };
    return { eligibility: "REQUIRES_HUMAN_REVIEW", notes: "Customer-requested refund before submission; reviewer confirms refundability per policy." };
  }
  return { eligibility: "REQUIRES_HUMAN_REVIEW", notes: "Unrecognized reason; default to human review." };
}

async function currentSubmissionStatus(svc: any, appId: string | undefined): Promise<string> {
  if (!appId) return "UNKNOWN";
  const subs: any[] = await svc.entities.Submission.filter({ application_id: appId }).catch(() => []);
  if (subs.some((s) => s.status === "SUBMITTED" || s.status === "COMPLETED")) return "SUBMITTED";
  if (subs.length) return "PENDING";
  return "NOT_SUBMITTED";
}

export async function requestRefund(svc: any, user: any, orderId: string, opts: { amount_minor?: number; type?: "FULL" | "PARTIAL"; reason: string; reason_detail?: string; components?: any[] }): Promise<any> {
  const order: any = await svc.entities.Order.get(orderId).catch(() => null);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  await assertOrderOwner(svc, user, order);
  if (!["PAID", "PARTIALLY_PAID", "COMPLETED", "PARTIALLY_REFUNDED"].includes(order.status)) throw Object.assign(new Error(`Order not refundable (${order.status})`), { code: "NOT_REFUNDABLE" });

  // Find the succeeded payment to refund against.
  const payments: any[] = await svc.entities.Payment.filter({ order_id: order.id }).catch(() => []);
  const pay = payments.find((p) => p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED");
  if (!pay) throw Object.assign(new Error("No succeeded payment to refund"), { code: "NO_PAYMENT", payment_statuses: payments.map((p) => p.status) });

  const type = opts.type || (opts.amount_minor != null && opts.amount_minor < order.total_minor ? "PARTIAL" : "FULL");
  const existingRefunds: any[] = await svc.entities.Refund.filter({ order_id: order.id }).catch(() => []);
  const alreadyRefunded = sumMinor(existingRefunds.filter((r) => ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED"].includes(r.status)).map((r) => r.amount_minor));
  const target = type === "FULL" ? (order.total_minor - alreadyRefunded) : Math.trunc(opts.amount_minor || 0);
  if (target <= 0) throw Object.assign(new Error("Nothing left to refund"), { code: "NOTHING_TO_REFUND" });
  if (alreadyRefunded + target > order.total_minor) throw Object.assign(new Error("Refund exceeds captured payment"), { code: "OVER_REFUND" });

  // Phase 2: deterministic eligibility evidence captured at request time.
  const app = order.application_id ? await svc.entities.VisaApplication.get(order.application_id).catch(() => null) : null;
  const submissionStatus = await currentSubmissionStatus(svc, order.application_id);
  const productRows: any[] = await svc.entities.VisaProduct.filter({ code: order.product_code }).catch(() => []);
  const productPolicy = productRows[0]?.refund_policy;
  const polRows: any[] = await svc.entities.PolicyVersion.filter({ policy_key: "refund-policy", is_current: true }, "-effective_from", 1).catch(() => []);
  const policyVersion = polRows[0]?.version || null;
  const assessment = assessRefundEligibility(opts.reason, productPolicy, app, submissionStatus);

  const refund = await svc.entities.Refund.create({
    order_id: order.id, payment_id: pay.id, traveler_id: order.traveler_id, application_id: order.application_id,
    type, amount_minor: target, currency: order.currency, reason: opts.reason, reason_detail: opts.reason_detail || "",
    actor: (user && (user.full_name || user.email)) || (user && user.id) || "system",
    status: "REQUESTED", components: opts.components || [],
    eligibility: assessment.eligibility, eligibility_notes: assessment.notes,
    application_stage: app?.case_state || app?.status || null, submission_status: submissionStatus, policy_version: policyVersion,
  }).catch(() => null);
  await svc.entities.Order.update(order.id, { status: "REFUND_PENDING" }).catch(() => {});
  await auditPay(svc, user, "refund.requested", refund?.id, order.traveler_id, order.application_id, { order_id: order.id, type, amount_minor: target, eligibility: assessment.eligibility });
  try {
    const { sendRefundStatus } = await import("../../mail/templates.ts");
    const uRows: any[] = app?.created_by_id ? await svc.entities.User.filter({ id: app.created_by_id }).catch(() => []) : [];
    const email = uRows[0]?.email || user.email;
    if (email) { const name = (uRows[0]?.full_name || "").split(" ")[0] || "there"; await sendRefundStatus(email, name, order.order_number, "Requested", target, order.currency, "We've received your refund request and will review it against our refund policy. Refunds go to your original payment method."); }
  } catch {}
  return { refund };
}

export async function approveRefund(svc: any, user: any, refundId: string): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const r: any = await svc.entities.Refund.get(refundId).catch(() => null);
  if (!r) throw Object.assign(new Error("Refund not found"), { code: "NOT_FOUND" });
  if (!["REQUESTED", "UNDER_REVIEW"].includes(r.status)) throw Object.assign(new Error(`Refund not requestable (${r.status})`), { code: "BAD_STATE" });
  const order: any = await svc.entities.Order.get(r.order_id).catch(() => null);
  const product: any = await svc.entities.VisaProduct.filter({ code: order?.product_code }).catch(() => []);
  // Enforce product refund policy (§33): NON_REFUNDABLE blocks; OPERATOR_REVIEW needs admin (this IS admin).
  const policy = product[0]?.refund_policy;
  if (policy === "NON_REFUNDABLE" || r.eligibility === "NOT_ELIGIBLE") throw Object.assign(new Error("Refund is not eligible under the current policy"), { code: "NON_REFUNDABLE" });
  await svc.entities.Refund.update(r.id, { status: "APPROVED", reviewer: user.id || user.email, reviewed_at: new Date().toISOString() }).catch(() => {});
  await auditPay(svc, user, "refund.approved", r.id, r.traveler_id, r.application_id, { refund_id: r.id });
  try {
    const { sendRefundStatus } = await import("../../mail/templates.ts");
    const uRows: any[] = r.application_id ? (await svc.entities.VisaApplication.filter({ id: r.application_id }).catch(() => []))[0]?.created_by_id ? await svc.entities.User.filter({ id: (await svc.entities.VisaApplication.filter({ id: r.application_id }).catch(() => []))[0]?.created_by_id }).catch(() => []) : [] : [];
    const email = uRows[0]?.email || "";
    if (email) { const name = (uRows[0]?.full_name || "").split(" ")[0] || "there"; await sendRefundStatus(email, name, order?.order_number || r.order_id, "Approved", r.amount_minor, r.currency, "Your refund was approved and is being processed to your original payment method."); }
  } catch {}
  return { refund: await svc.entities.Refund.get(r.id) };
}

// Phase 2: deterministic reject path — admin records WHY a refund is refused and
// reverts the order to its prior paid state. No financial movement occurs.
export async function rejectRefund(svc: any, user: any, refundId: string, reason: string): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const r: any = await svc.entities.Refund.get(refundId).catch(() => null);
  if (!r) throw Object.assign(new Error("Refund not found"), { code: "NOT_FOUND" });
  if (!["REQUESTED", "UNDER_REVIEW"].includes(r.status)) throw Object.assign(new Error(`Refund not rejectable (${r.status})`), { code: "BAD_STATE" });
  await svc.entities.Refund.update(r.id, { status: "REJECTED", reviewer: user.id || user.email, reviewed_at: new Date().toISOString(), eligibility_notes: `${r.eligibility_notes || ""}\nRejected: ${reason}`.trim() }).catch(() => {});
  // Revert the order's REFUND_PENDING back to PAID so the customer can see it's not pending.
  const order: any = await svc.entities.Order.get(r.order_id).catch(() => null);
  if (order && order.status === "REFUND_PENDING") await svc.entities.Order.update(order.id, { status: "PAID" }).catch(() => {});
  await auditPay(svc, user, "refund.rejected", r.id, r.traveler_id, r.application_id, { refund_id: r.id, reason });
  return { refund: await svc.entities.Refund.get(r.id) };
}

// Phase 2: an admin can move a refund into under-review without deciding yet.
export async function startReviewRefund(svc: any, user: any, refundId: string): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const r: any = await svc.entities.Refund.get(refundId).catch(() => null);
  if (!r) throw Object.assign(new Error("Refund not found"), { code: "NOT_FOUND" });
  if (r.status !== "REQUESTED") throw Object.assign(new Error(`Refund not reviewable (${r.status})`), { code: "BAD_STATE" });
  await svc.entities.Refund.update(r.id, { status: "UNDER_REVIEW", reviewer: user.id || user.email }).catch(() => {});
  await auditPay(svc, user, "refund.under_review", r.id, r.traveler_id, r.application_id, { refund_id: r.id });
  try {
    const { sendRefundStatus } = await import("../../mail/templates.ts");
    const appRow: any = r.application_id ? (await svc.entities.VisaApplication.filter({ id: r.application_id }).catch(() => []))[0] : null;
    const uRows: any[] = appRow?.created_by_id ? await svc.entities.User.filter({ id: appRow.created_by_id }).catch(() => []) : [];
    const email = uRows[0]?.email || "";
    if (email) { const name = (uRows[0]?.full_name || "").split(" ")[0] || "there"; await sendRefundStatus(email, name, order?.order_number || r.order_id, "Rejected", r.amount_minor, r.currency, `This refund wasn't approved. Reason: ${reason}. You can reply to your support ticket if you disagree.`); }
  } catch {}
  return { refund: await svc.entities.Refund.get(r.id) };
}

export async function executeRefund(svc: any, user: any, refundId: string): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const r: any = await svc.entities.Refund.get(refundId).catch(() => null);
  if (!r) throw Object.assign(new Error("Refund not found"), { code: "NOT_FOUND" });
  if (!["APPROVED", "PROCESSING"].includes(r.status)) throw Object.assign(new Error(`Refund not executable (${r.status})`), { code: "BAD_STATE" });
  await svc.entities.Refund.update(r.id, { status: "PROCESSING" }).catch(() => {});
  const pay: any = await svc.entities.Payment.get(r.payment_id).catch(() => null);
  if (!pay) throw Object.assign(new Error("Payment not found"), { code: "NO_PAYMENT" });
  const provider: any = await svc.entities.Provider.get(pay.provider_id).catch(() => null);
  if (!provider) throw Object.assign(new Error("Provider not found"), { code: "NO_PROVIDER" });
  const ctx = await buildProviderContext(svc, provider);
  const adapter = getPaymentAdapter(provider.adapter_key);
  const attempt = (await svc.entities.Refund.filter({ order_id: r.order_id }).catch(() => [])).length;
  const res = await adapter.refund(ctx, { provider_payment_id: pay.provider_payment_id, amount_minor: r.amount_minor, currency: r.currency, reason: r.reason, type: r.type, idempotency_key: refundIdempotencyKey(r.order_id, r.payment_id, attempt) });
  if (!res.success) {
    await svc.entities.Refund.update(r.id, { status: "FAILED", provider_refund_id: res.provider_refund_id, metadata: { response: res.response_metadata } }).catch(() => {});
    await auditPay(svc, user, "refund.failed", r.id, r.traveler_id, r.application_id, { error_code: res.error_code });
    throw Object.assign(new Error(res.error_message || "Refund failed"), { code: res.error_code || "REFUND_FAILED" });
  }
  // Provider confirmed COMPLETED (§32) — never assume from an operator click.
  const completed_at = new Date().toISOString();
  await svc.entities.Refund.update(r.id, { status: "COMPLETED", provider_refund_id: res.provider_refund_id, completed_at, metadata: { response: res.response_metadata } }).catch(() => {});
  await applyRefundToOrder(svc, user, r);
  await auditPay(svc, user, "refund.completed", r.id, r.traveler_id, r.application_id, { order_id: r.order_id, amount_minor: r.amount_minor });
  try {
    const { sendRefundStatus } = await import("../../mail/templates.ts");
    const ord: any = await svc.entities.Order.get(r.order_id).catch(() => null);
    const appRow: any = r.application_id ? (await svc.entities.VisaApplication.filter({ id: r.application_id }).catch(() => []))[0] : null;
    const uRows: any[] = appRow?.created_by_id ? await svc.entities.User.filter({ id: appRow.created_by_id }).catch(() => []) : [];
    const email = uRows[0]?.email || "";
    if (email) { const name = (uRows[0]?.full_name || "").split(" ")[0] || "there"; await sendRefundStatus(email, name, ord?.order_number || r.order_id, "Refunded", r.amount_minor, r.currency, "Your refund has been completed to your original payment method."); }
  } catch {}
  return { refund: await svc.entities.Refund.get(r.id) };
}

async function applyRefundToOrder(svc: any, user: any, refund: any): Promise<void> {
  const order: any = await svc.entities.Order.get(refund.order_id).catch(() => null);
  if (!order) return;
  const all: any[] = await svc.entities.Refund.filter({ order_id: order.id }).catch(() => []);
  const totalRefunded = sumMinor(all.filter((r) => r.status === "COMPLETED").map((r) => r.amount_minor));
  let status: OrderStatus;
  if (totalRefunded >= order.total_minor) status = "REFUNDED";
  else status = "PARTIALLY_REFUNDED";
  await svc.entities.Order.update(order.id, { status }).catch(() => {});
  // Payment status projection.
  const pay: any = await svc.entities.Payment.get(refund.payment_id).catch(() => null);
  if (pay) await svc.entities.Payment.update(pay.id, { status: totalRefunded >= order.total_minor ? "REFUNDED" : "PARTIALLY_REFUNDED" }).catch(() => {});
  // Invoice → REFUNDED or VOID.
  const invoices: any[] = await svc.entities.Invoice.filter({ order_id: order.id }).catch(() => []);
  for (const inv of invoices) {
    if (inv.status === "PAID") await svc.entities.Invoice.update(inv.id, { status: totalRefunded >= order.total_minor ? "REFUNDED" : "ISSUED", metadata: { ...(inv.metadata || {}), total_refunded_minor: totalRefunded } }).catch(() => {});
  }
}

// ---------- Invoices / receipts ----------
async function issueInvoiceFor(svc: any, user: any, order: any, status: "PAID" | "ISSUED"): Promise<any> {
  const existing: any[] = await svc.entities.Invoice.filter({ order_id: order.id }).catch(() => []);
  const live = existing.find((i) => i.status !== "VOID");
  if (live) return live;
  const invoice_number = await nextSequence(svc, "Invoice", "INV");
  const now = new Date().toISOString();
  const invoice = await svc.entities.Invoice.create({
    order_id: order.id, traveler_id: order.traveler_id, invoice_number,
    status: status === "PAID" ? "PAID" : "ISSUED", currency: order.currency,
    subtotal_minor: order.subtotal_minor, tax_minor: order.tax_minor, discount_minor: order.discount_minor, total_minor: order.total_minor,
    issued_at: now, paid_at: status === "PAID" ? now : null, metadata: {},
  }).catch(() => null);
  if (invoice) await auditPay(svc, user, "invoice.issued", invoice.id, order.traveler_id, order.application_id, { invoice_number, order_id: order.id });
  return invoice;
}

async function issueReceiptFor(svc: any, user: any, order: any, payment: any, invoice: any): Promise<any> {
  const receipt_number = await nextSequence(svc, "Receipt", "RCT");
  const receipt = await svc.entities.Receipt.create({
    order_id: order.id, payment_id: payment?.id || null, invoice_id: invoice?.id || null, traveler_id: order.traveler_id,
    receipt_number, currency: order.currency, total_minor: order.total_minor, issued_at: new Date().toISOString(), metadata: {},
  }).catch(() => null);
  if (receipt) await auditPay(svc, user, "receipt.issued", receipt.id, order.traveler_id, order.application_id, { receipt_number, order_id: order.id });
  return receipt;
}

// ---------- Paid-service gate (§22/§23) ----------
export async function canExecutePaidService(svc: any, app: any, service: PaidService): Promise<{ allowed: boolean; reason?: string; order?: any; product?: any }> {
  const product = await resolveProduct(svc, app).catch(() => null);
  if (!product) return { allowed: true, reason: "no_product" }; // no commerce binding → unbilled (dev routes)
  const gate: PaymentGate = product.payment_gate as PaymentGate;
  if (!serviceRequiresGate(service, gate)) return { allowed: true, product };
  // Gate requires a paid order for this application+product.
  const orders: any[] = await svc.entities.Order.filter({ application_id: app.id, product_id: product.id }).catch(() => []);
  const paid = orders.find((o) => ["PAID", "COMPLETED", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.status));
  if (!paid) return { allowed: false, reason: "PAYMENT_REQUIRED", product };
  return { allowed: true, order: paid, product };
}

// ---------- Listing helpers ----------
export async function listPayments(svc: any, user: any, orderId: string): Promise<any[]> {
  const order: any = await svc.entities.Order.get(orderId).catch(() => null);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  await assertOrderOwner(svc, user, order);
  return await svc.entities.Payment.filter({ order_id: orderId }, "-created_date", 100).catch(() => []);
}

export async function listRefunds(svc: any, user: any, orderId: string): Promise<any[]> {
  const order: any = await svc.entities.Order.get(orderId).catch(() => null);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  await assertOrderOwner(svc, user, order);
  return await svc.entities.Refund.filter({ order_id: orderId }, "-created_date", 100).catch(() => []);
}

export async function listInvoices(svc: any, user: any, orderId?: string): Promise<any[]> {
  if (orderId) {
    const order: any = await svc.entities.Order.get(orderId).catch(() => null);
    if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
    await assertOrderOwner(svc, user, order);
    return await svc.entities.Invoice.filter({ order_id: orderId }, "-created_date", 100).catch(() => []);
  }
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  return await svc.entities.Invoice.filter({}, "-created_date", 100).catch(() => []);
}

export async function listAllOrders(svc: any, user: any, opts?: { status?: string }): Promise<any[]> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const q: any = {};
  if (opts?.status) q.status = opts.status;
  return await svc.entities.Order.filter(q, "-created_date", 100).catch(() => []);
}

export async function listAllPayments(svc: any, user: any, opts?: { status?: string }): Promise<any[]> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const q: any = {};
  if (opts?.status) q.status = opts.status;
  return await svc.entities.Payment.filter(q, "-created_date", 100).catch(() => []);
}

export async function listAllRefunds(svc: any, user: any): Promise<any[]> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  return await svc.entities.Refund.filter({}, "-created_date", 100).catch(() => []);
}

// ---------- Orchestrator signal (§43/§44) ----------
// Best-effort: emit a domain event the orchestrator can react to. The orchestrator
// never owns payment processing; it only advances past a WAIT_FOR_PAYMENT gate
// once this signal fires. Idempotent.
async function signalPaymentSucceeded(svc: any, user: any, app: any, order: any): Promise<void> {
  if (!app) return;
  // Update application projection fields (§21) — payment_status already set; add order #.
  try {
    const { bus } = await import("../../events/bus.ts");
    await bus.dispatch("ApplicationReadinessChanged", { actor: user?.email || "system", businessId: app.organization_id, payload: { application_id: app.id, type: "payment_succeeded", order_id: order.id, order_number: order.order_number, total_minor: order.total_minor, currency: order.currency } });
  } catch {}
}