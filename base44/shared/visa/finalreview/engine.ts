// Worldz Visa (Phase 18) — Application final-review + commercial domain.
//
// Layers the final-review sub-state, the final readiness gate, traveler
// attestation, application version/freeze, and paid-mutation protection ON TOP
// of the existing Phase 16 lifecycle + Phase 10 payment domain — WITHOUT
// duplicating them. The VisaApplication.status state machine (orchestrator-
// owned) is untouched; a separate structured `final_review` object models the
// commercial flow (§2: not_started → ready_for_review → under_user_review →
// payment_pending → paid → ready_for_submission).
//
// Separation rules enforced here (§1/§20): a successful payment only means the
// configured order was paid — it does NOT mean the application was submitted,
// the embassy accepted it, or a visa was approved. No external submission.
//
// Acyclic by design: engine → ledger + questions only. The payments engine
// imports engine (markPaymentPending/markPaid); engine never imports payments.

import { checkApplicationReadiness } from "../questions.ts";
import { recordFinancialEvent, commercialTimeline, dispatchCommercial } from "./ledger.ts";

// ---------- material fields + hash (§6) ----------
export const MATERIAL_QUESTION_CODES = [
  "personal.surname", "personal.given_names", "personal.date_of_birth", "personal.nationality",
  "passport.passport_number", "passport.expiry_date",
  "travel.purpose", "travel.departure_date", "travel.return_date",
  "employment.status", "financial.annual_income",
];

function djb(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return "mh_" + h.toString(36);
}

export function computeMaterialHash(app: any, answers: any[]): string {
  const byCode: Record<string, string> = {};
  for (const a of answers || []) if (a && a.active !== false && a.normalized_value) byCode[a.question_code] = a.normalized_value;
  const material: any = {
    destination: String(app?.destination || "").toUpperCase(),
    purpose: String(app?.purpose || "").toLowerCase(),
    visa_type_key: app?.visa_type_key || "",
    nationality: String(app?.nationality || "").toUpperCase(),
    channel: app?.channel || "",
    travel_start: app?.travel_start || byCode["travel.departure_date"] || "",
    travel_end: app?.travel_end || byCode["travel.return_date"] || "",
  };
  for (const c of MATERIAL_QUESTION_CODES) material[c] = byCode[c] || "";
  return djb(JSON.stringify(material));
}

// ---------- gate classification (§3) ----------
export function classifyGate(blockingCount: number, needsReviewCount: number): "READY" | "NOT_READY" | "NEEDS_REVIEW" {
  if (blockingCount > 0) return "NOT_READY";
  if (needsReviewCount > 0) return "NEEDS_REVIEW";
  return "READY";
}

// ---------- product lookup (avoids importing payments to keep the graph acyclic) ----------
async function lookupProduct(svc: any, app: any): Promise<any> {
  const rows: any[] = await svc.entities.VisaProduct.filter({
    country: String(app.destination || "").toUpperCase(),
    visa_type_key: app.visa_type_key, purpose: app.purpose, status: "ACTIVE",
  }).catch(() => []);
  const real = rows.filter((p) => !p.metadata?.test_route);
  return (real.length ? real : rows)[0] || null;
}

// ---------- declaration text (§5, configurable per product) ----------
const DEFAULT_DECLARATION = "I confirm that the information provided in this application is accurate and complete to the best of my knowledge.";
export function declarationTextFor(product: any): string {
  return (product && product.declaration_text && String(product.declaration_text).trim()) || DEFAULT_DECLARATION;
}
export function declarationCodeFor(product: any): string {
  return (product && product.declaration_code && String(product.declaration_code).trim()) || "DEFAULT_ATTESTATION";
}

// ---------- final readiness gate (§3) ----------
// Aggregates eligibility + required questions + documents + validation + consistency
// + completeness into READY / NOT_READY / NEEDS_REVIEW, with the explicit product
// rule exception (§3): a product with payment_gate = PAYMENT_BEFORE_APPLICATION
// intentionally allows payment before all documents are collected.
export async function finalReviewGate(svc: any, app: any): Promise<any> {
  const readiness = await checkApplicationReadiness(svc, app); // { ready, blocking_items, progress }
  const product = await lookupProduct(svc, app);
  let blocking: any[] = readiness.blocking_items || [];
  const needsReviewFindings: any[] = await svc.entities.ReviewFinding.filter({ application_id: app.id, status: "OPEN" }).catch(() => []);
  const blockingCodes = new Set(blocking.map((b) => b.code));
  const needsReview = needsReviewFindings.filter((f) => !blockingCodes.has(f.code) && (f.severity === "WARNING" || f.severity === "INFO"));

  // Explicit configurable product rule (§3): pay-before-application products
  // intentionally allow payment while documents are still being collected.
  let productException = false;
  if (product?.payment_gate === "PAYMENT_BEFORE_APPLICATION") {
    productException = true;
    blocking = blocking.filter((b) => b.type !== "DOCUMENT");
  }

  const state = classifyGate(blocking.length, needsReview.length);
  return {
    state,
    ready: state === "READY",
    blocking_count: blocking.length,
    needs_review_count: needsReview.length,
    reasons: blocking.map((b) => ({ code: b.code, message: b.message || b.code, category: b.type })),
    needs_review: needsReview.map((f) => ({ code: f.code, title: f.title, description: f.description })),
    product: product ? { id: product.id, code: product.code, name: product.name, payment_gate: product.payment_gate, refund_policy: product.refund_policy } : null,
    product_exception: productException,
    declaration: { code: declarationCodeFor(product), text: declarationTextFor(product) },
    progress: readiness.progress,
  };
}

// ---------- final-review sub-state transitions ----------
function fr(app: any): any { return app?.final_review || {}; }

export async function enterFinalReview(svc: any, app: any): Promise<any> {
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
  const hash = computeMaterialHash(app, answers);
  const cur = fr(app);
  if (cur.state === "not_started" || !cur.state) {
    const version = (app.application_version || 1);
    const final_review = { state: "ready_for_review", version, priced_version: cur.priced_version || null, confirmed_at: cur.confirmed_at || null, material_hash: hash };
    await svc.entities.VisaApplication.update(app.id, { application_version: version, final_review }).catch(() => {});
    return { ...app, application_version: version, final_review };
  }
  return app;
}

export async function startUserReview(svc: any, app: any): Promise<any> {
  const cur = fr(app);
  if (cur.state !== "ready_for_review" && cur.state !== "under_user_review") return app;
  const final_review = { ...cur, state: "under_user_review" };
  await svc.entities.VisaApplication.update(app.id, { final_review }).catch(() => {});
  return { ...app, final_review };
}

/** Traveler attestation (§5). Requires READY (respecting the product exception). Idempotent per version. */
export async function confirmApplication(svc: any, user: any, app: any): Promise<any> {
  const gate = await finalReviewGate(svc, app);
  if (gate.state === "NOT_READY") throw Object.assign(new Error("Application is not ready for confirmation"), { code: "NOT_READY", reasons: gate.reasons });
  const version = app.application_version || 1;
  // Idempotent: one confirmation per application_version.
  const existing: any[] = await svc.entities.ApplicationConfirmation.filter({ application_id: app.id, application_version: version }).catch(() => []);
  if (existing.length) {
    const cur = fr(app);
    const final_review = { ...cur, state: "under_user_review", confirmed_at: existing[0].confirmed_at };
    await svc.entities.VisaApplication.update(app.id, { final_review }).catch(() => {});
    return { confirmation: existing[0], already: true, gate };
  }
  const confirmed_at = new Date().toISOString();
  const confirmation = await svc.entities.ApplicationConfirmation.create({
    application_id: app.id, traveler_id: app.traveler_id, application_version: version,
    declaration_code: gate.declaration.code, declaration_text: gate.declaration.text,
    confirmed_at, user_id: user?.id || user?.email || "system", metadata: {},
  }).catch(() => null);
  const final_review = { state: "under_user_review", version, priced_version: fr(app).priced_version || null, confirmed_at, material_hash: fr(app).material_hash || null };
  await svc.entities.VisaApplication.update(app.id, { final_review }).catch(() => {});
  await commercialTimeline(svc, app, "FINAL_REVIEW_COMPLETED", { actor_type: "TRAVELER", source_ref: app.id });
  await dispatchCommercial("ApplicationFinalReviewed" as any, { application_id: app.id, version });
  return { confirmation, gate };
}

/** Called by the payments engine when an order is created — pins the priced version (§6). */
export async function markPaymentPending(svc: any, app: any, order: any): Promise<any> {
  const version = app.application_version || 1;
  const final_review = { state: "payment_pending", version, priced_version: version, confirmed_at: fr(app).confirmed_at || null, material_hash: fr(app).material_hash || null };
  await svc.entities.VisaApplication.update(app.id, { final_review }).catch(() => {});
  return { ...app, final_review };
}

/** Called by the payments engine on verified payment success (§16). Does NOT submit. */
export async function markPaid(svc: any, app: any, order: any): Promise<any> {
  const paid_at = new Date().toISOString();
  const cur = fr(app);
  const final_review = { state: "paid", version: cur.version || app.application_version || 1, priced_version: cur.priced_version || app.application_version || 1, confirmed_at: cur.confirmed_at || null, material_hash: cur.material_hash || null };
  await svc.entities.VisaApplication.update(app.id, { paid_at, final_review }).catch(() => {});
  await commercialTimeline(svc, app, "READY_FOR_SUBMISSION", { actor_type: "SYSTEM", source_ref: order?.id, metadata: { order_id: order?.id, order_number: order?.order_number } });
  await dispatchCommercial("ApplicationPaid" as any, { application_id: app.id, order_id: order?.id });
  await dispatchCommercial("ApplicationReadyForSubmission" as any, { application_id: app.id });
  return { ...app, paid_at, final_review };
}

// ---------- paid-mutation protection (§30) ----------
export function paidMutationImpact(app: any, newMaterialHash: string, hasPaidOrder: boolean): "none" | "revalidation" | "repricing" | "manual_review" {
  if (!hasPaidOrder) return "none";
  const priced = fr(app).material_hash;
  if (!priced || priced === newMaterialHash) return "none";
  // A material field changed after pricing → existing price is invalid (§6).
  return "repricing";
}

/** Invalidate the priced context after a material change (§6). Caller cancels the stale order. */
export async function invalidatePrice(svc: any, app: any, reason: string): Promise<any> {
  const cur = fr(app);
  const final_review = { ...cur, priced_version: null };
  await svc.entities.VisaApplication.update(app.id, { final_review }).catch(() => {});
  await recordFinancialEvent(svc, app, "PRICE_INVALIDATED", { metadata: { reason } });
  return { ...app, final_review };
}

// MATERIAL_QUESTION_CODES is exported at declaration above (contract-test import).